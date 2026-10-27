import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import http from 'node:http'
import test from 'node:test'
import { createClineAdapter } from '../lib/native-adapter.js'
import { buildProviderPayload } from '../lib/provider-payload.js'
import { getAllModels } from '../lib/models.js'
import { createProxyServer } from '../lib/proxy-server.js'
import { createNativeAdapterController } from '../lib/native-adapter-controller.js'
import { parseConfig } from '../lib/config.js'
import { measureStream } from '../lib/stream-failover.js'
import { createModelProbe } from '../lib/model-probe.js'
import { clinepassUsageProjection } from '../lib/session-usage.js'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const pi = require('@deepseek-ai/dsh-llm-pi-ai')
const llm = require('@deepseek-ai/dsh-llm')
const { Context } = require('@deepseek-ai/cordis')
const dshLib = dirname(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const protocolUrl = execFileSync(process.execPath, ['--input-type=module', '-e', "console.log(import.meta.resolve('@earendil-works/pi-ai/api/openai-completions.lazy'))"], { cwd: dshLib, encoding: 'utf8' }).trim()
const protocol = await import(protocolUrl)
const deps = { ...pi, ...llm, ...protocol }
const model = 'cline-pass/deepseek-v4.1-flash'

async function mock(t, { reportUsage = true, provider, lateProvider = false, directProvider = false, cacheWrite, usage } = {}) {
  const calls = []
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part)
    calls.push({ body: JSON.parse(Buffer.concat(parts).toString()), headers: req.headers })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const chunk = (delta, finish_reason = null) => {
      const report = provider && (lateProvider ? finish_reason !== null : !!delta.content)
      return `data: ${JSON.stringify({ id: 'native-test', object: 'chat.completion.chunk', created: 1, model,
        ...(report && directProvider ? { provider } : {}),
        choices: [{ index: 0, delta: { ...delta, ...(report && !directProvider ? { provider_metadata: { gateway: { routing: { finalProvider: provider } } } } : {}) }, finish_reason }] })}\n\n`
    }
    res.end(chunk({ role: 'assistant', content: 'pong' }) + chunk({}, 'stop') + (reportUsage ? `data: ${JSON.stringify({ choices: [], usage: usage ?? { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: cacheWrite }, completion_tokens_details: { reasoning_tokens: 1 } } })}\n\n` : '') + 'data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, calls }
}

async function runtime(t, adapter, observe) {
  const ctx = new Context()
  await ctx.plugin(llm.default)
  let service
  await ctx.plugin({ name: 'cline-adapter-test', inject: ['llm'], apply(inner) {
    service = inner.llm; service.registerAdapter(['clinebot'], adapter)
    if (observe) inner.on('llm/stream', observe, { global: true })
  } })
  t.after(() => ctx.fiber.dispose())
  return service
}

async function dispatch(prepared, sessionId) {
  const message = Object.freeze({ role: 'user', content: Object.freeze([Object.freeze({ type: 'text', text: 'ping' })]) })
  const options = Object.freeze({ ...prepared.config, messages: Object.freeze([message]), sessionId, purpose: 'session-title' })
  const chunks = []
  for await (const chunk of prepared.stream(options)) chunks.push(chunk)
  assert.ok(chunks.some((chunk) => chunk.type === 'finish' && chunk.reason.kind !== 'error'), JSON.stringify(chunks))
  assert.equal(Object.isFrozen(options), true)
  return options
}

test('native budget guard blocks before sending and does not create unknown usage records', async t => {
  const upstream = await mock(t)
  const state = { profile: buildProviderPayload({ baseUrl: upstream.baseUrl, apiKeyEnv: 'CLINEBOT_API_KEY_TEST', models: getAllModels({}) }).payload, overrides: [] }
  const metadata = new WeakMap(), records = []
  let blocked = true
  const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => 'fake-key',
    noteDispatch: (options, route) => metadata.set(options, route),
    beforeRequest: async () => { if (blocked) throw Object.assign(new Error('Budget reached'), { code: 'BUDGET_EXCEEDED' }) } })
  const service = await runtime(t, adapter, (options, next) => measureStream(next(), options, () => metadata.get(options), record => records.push(record)))
  const prepared = await service.prepareCall({ provider: 'clinebot', model })
  const chunks = await Array.fromAsync(prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }] }))
  assert.equal(chunks.at(-1).reason.failure.code, 'BUDGET_EXCEEDED')
  assert.equal(upstream.calls.length, 0); assert.equal(records.length, 0)
  blocked = false
  await dispatch(await service.prepareCall({ provider: 'clinebot', model }))
  assert.equal(upstream.calls.length, 1); assert.equal(records.length, 1)
})

test('native preparation freezes per-model defaults, preserves explicit controls and serializes Off', async (t) => {
  const upstream = await mock(t)
  const state = { profile: parseConfig({ nativeProvider: buildProviderPayload({ baseUrl: upstream.baseUrl, apiKeyEnv: 'CLINEBOT_API_KEY_TEST', models: getAllModels({}) }).payload }).nativeProvider,
    overrides: [{ id: model, defaultReasoning: 'high' }] }
  const metadata = new WeakMap()
  const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => 'fake-native-adapter', getAttachments: () => undefined, getFs: () => undefined, noteDispatch: (options, route) => metadata.set(options, route) })
  const service = await runtime(t, adapter)
  const prepared = await service.prepareCall({ provider: 'clinebot', model })
  assert.equal(prepared.config.reasoningEffort, 'high')
  assert.equal(prepared.adapterDefaults.reasoningEffort, true)
  assert.equal(Object.isFrozen(prepared.config), true)
  state.overrides = [{ id: model, defaultReasoning: 'max' }]
  const dispatched = await dispatch(prepared, 'session-direct')
  assert.equal(metadata.get(dispatched).wireUsage.total_tokens, 23)
  assert.equal(metadata.get(dispatched).transport, 'direct')
  assert.equal(upstream.calls[0].body.reasoning_effort, 'high')
  assert.equal(upstream.calls[0].body.max_tokens, 65536)
  assert.equal(upstream.calls[0].headers['x-clinepass-session'], undefined)
  const explicit = await service.prepareCall({ provider: 'clinebot', model, reasoningEffort: 'low', maxTokens: 1234 })
  await dispatch(explicit)
  assert.equal(upstream.calls[1].body.reasoning_effort, 'low')
  assert.equal(upstream.calls[1].body.max_tokens, 1234)
  const off = await service.prepareCall({ provider: 'clinebot', model, reasoningEffort: 'off' })
  await dispatch(off)
  assert.deepEqual(upstream.calls[2].body.thinking, { type: 'disabled' })
  assert.equal(upstream.calls[2].body.reasoning_effort, undefined)
})

test('native 1017 pins reach the wire, survive preparation and report actual upstream through the probe', async (t) => {
  const model = 'cline-pass/deepseek-v4.1-flash-1017'
  const upstream = await mock(t, { provider: 'deepseek', lateProvider: true })
  const pins = [{ model, provider: 'deepseek' }]
  const state = { profile: buildProviderPayload({ baseUrl: upstream.baseUrl, apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels({}) }).payload, overrides: [], upstreamPins: pins }
  const dispatchMetadata = new WeakMap(), probeRequests = new WeakSet()
  const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => 'fake-pin-key', getAttachments: () => undefined, getFs: () => undefined,
    noteDispatch: (options, metadata) => dispatchMetadata.set(options, metadata) })
  const service = await runtime(t, adapter)
  const prepared = await service.prepareCall({ provider: 'clinebot', model, reasoningEffort: 'high', maxTokens: 1234 })
  state.upstreamPins = [{ model, provider: 'baseten' }]
  await dispatch(prepared, 'pinned-session')
  assert.deepEqual(upstream.calls[0].body.provider, { only: ['deepseek'], order: ['deepseek'], allow_fallbacks: false })
  assert.deepEqual(upstream.calls[0].body.providerOptions.gateway, { only: ['deepseek'], order: ['deepseek'], has: ['vision', 'implicit-caching'] })
  assert.equal(upstream.calls[0].body.reasoning_effort, 'high')
  assert.equal(upstream.calls[0].body.max_tokens, 1234)
  assert.equal(upstream.calls[0].body.model, model)
  state.upstreamPins = pins
  const probe = createModelProbe({ inject(_deps, callback) { callback({ llm: service }) } }, { live: () => ({}), probeRequests, dispatchMetadata })
  const result = await probe.run(model)
  assert.equal(result.ok, true)
  assert.equal(result.upstreamPin, 'deepseek')
  assert.equal(result.upstream, 'deepseek')
  assert.equal(result.upstreamPinAttached, true)
  assert.equal(result.upstreamPinStatus, 'matched')
  assert.deepEqual(upstream.calls[1].body.providerOptions.gateway.has, ['vision', 'implicit-caching'])
  await probe.close()
})

test('native strict pins fail on ignored, absent and late mismatched routing without replay', async (t) => {
  const model = 'cline-pass/deepseek-v4.1-flash-1017'
  for (const scenario of [
    { provider: 'openai_compatible_private', code: 'UPSTREAM_PIN_MISMATCH' },
    { provider: 'baseten', lateProvider: true, code: 'UPSTREAM_PIN_MISMATCH' },
    { code: 'UPSTREAM_PIN_UNVERIFIED' },
  ]) await t.test(scenario.code + (scenario.provider || ''), async (t) => {
    const upstream = await mock(t, scenario)
    const state = { profile: buildProviderPayload({ baseUrl: upstream.baseUrl, apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels({}) }).payload, overrides: [], upstreamPins: [{ model, provider: 'deepseek' }] }
    const metadata = new WeakMap(), records = []
    const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => 'fake-key', getAttachments: () => undefined, getFs: () => undefined,
      noteDispatch: (options, value) => metadata.set(options, value) })
    const service = await runtime(t, adapter, (options, next) => measureStream(next(), options, () => metadata.get(options), (record) => records.push(record)))
    const prepared = await service.prepareCall({ provider: 'clinebot', model })
    const chunks = await Array.fromAsync(prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }] }))
    assert.equal(chunks.at(-1).type, 'finish')
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.at(-1).reason.failure.code, scenario.code)
    assert.equal(upstream.calls.length, 1)
    assert.equal(records.length, 1)
    assert.equal(records[0].ok, false)
    assert.equal(records[0].error.code, scenario.code)
    assert.equal(records[0].upstreamPin, 'deepseek')
    assert.equal(records[0].upstreamPinAttached, true)
    assert.equal(records[0].upstream, scenario.provider || '')
    assert.equal(records[0].routingEvidence.responseId, 'native-test')
    assert.equal(records[0].attempts[0].routingEvidence.responseId, 'native-test')
  })
})

test('native session and auxiliary metadata reach only the proxy, including with cache disabled', async (t) => {
  const upstream = await mock(t)
  const records = []
  const config = { enabled: true, proxyEnabled: true, baseUrl: upstream.baseUrl, accountMode: 'round-robin' }
  const proxy = createProxyServer({ snapshot: async () => ({ config, accounts: [
    { apiKeyEnv: 'CLINEBOT_API_KEY', present: true, value: 'fake-one' },
    { apiKeyEnv: 'CLINEBOT_API_KEY_2', present: true, value: 'fake-two' },
  ] }), onRequest(record) { records.push(record) } })
  await proxy.start(); t.after(() => proxy.stop())
  const state = { profile: { ...buildProviderPayload({ baseUrl: proxy.baseUrl, apiKeyEnv: `CLINEBOT_PROXY_KEY_${proxy.port}`, models: getAllModels({}) }).payload, cacheRetention: 'none', retryPolicy: { mode: 'normal', maxRetries: 0 } }, overrides: [{ id: model, defaultReasoning: 'high' }] }
  const dispatches = new WeakMap()
  const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => proxy.token, getAttachments: () => undefined, getFs: () => undefined, noteDispatch: (options, metadata) => dispatches.set(options, metadata) })
  const service = await runtime(t, adapter, (options, next) => measureStream(next(), options, () => dispatches.get(options) || { transport: 'direct' }, () => assert.fail('proxy stream was counted twice')))
  const sessionId = '会话-native-session'
  for (let index = 0; index < 2; index++) await dispatch(await service.prepareCall({ provider: 'clinebot', model }), sessionId)
  assert.equal(records.length, 2)
  assert.equal(records[0].sessionId, sessionId)
  assert.equal(records[1].sessionId, sessionId)
  assert.equal(records[0].purpose, 'session-title')
  assert.equal(records[1].account, records[0].account)
  assert.equal(upstream.calls[0].headers.authorization, 'Bearer fake-one')
  assert.equal(upstream.calls[1].headers.authorization, 'Bearer fake-one')
  assert.equal(upstream.calls[0].headers['x-clinepass-purpose'], undefined)
  assert.equal(upstream.calls[0].headers['x-clinepass-session'], undefined)
  const held = await service.prepareCall({ provider: 'clinebot', model })
  state.profile = { ...state.profile, baseURL: upstream.baseUrl, apiKeyEnv: 'CLINEBOT_API_KEY' }
  const dispatched = await dispatch(held, sessionId)
  assert.equal(dispatches.get(dispatched).transport, 'proxy')
  assert.equal(records.length, 3)
})

test('native proxy probes preserve pin failures before and after first output', async (t) => {
  for (const scenario of [
    { provider: 'deepseek', lateProvider: true },
    { provider: 'baseten', configuredProvider: 'baseten', lateProvider: true },
    { provider: 'baseten', code: 'UPSTREAM_PIN_MISMATCH' },
    { provider: 'baseten', lateProvider: true, code: 'UPSTREAM_PIN_MISMATCH' },
    { code: 'UPSTREAM_PIN_UNVERIFIED' },
  ]) await t.test(`${scenario.provider}/${scenario.lateProvider}`, async (t) => {
    const upstream = await mock(t, scenario)
    const pins = [{ model, provider: 'deepseek' }]
    const records = [], dispatchMetadata = new WeakMap(), probeRequests = new WeakSet()
    const proxyPins = scenario.configuredProvider ? [{ model, provider: scenario.configuredProvider }] : pins
    const proxy = createProxyServer({ snapshot: async () => ({ config: { enabled: true, proxyEnabled: true, baseUrl: upstream.baseUrl, upstreamPins: proxyPins },
      accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY', present: true, value: 'fake-key' }] }), onRequest: (record) => records.push(record) })
    await proxy.start(); t.after(() => proxy.stop())
    const state = { profile: { ...buildProviderPayload({ baseUrl: proxy.baseUrl, apiKeyEnv: `CLINEBOT_PROXY_KEY_${proxy.port}`, models: getAllModels({}) }).payload, retryPolicy: { mode: 'normal', maxRetries: 0 } }, overrides: [], upstreamPins: pins }
    const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => proxy.token, getAttachments: () => undefined, getFs: () => undefined,
      noteDispatch: (options, metadata) => dispatchMetadata.set(options, metadata) })
    const service = await runtime(t, adapter)
    const probe = createModelProbe({ inject(_deps, callback) { callback({ llm: service }) } }, { live: () => ({}), probeRequests, dispatchMetadata })
    const result = await probe.run(model)
    assert.equal(result.ok, !scenario.code)
    assert.equal(result.error, scenario.code)
    assert.equal(result.upstream, scenario.provider || '')
    assert.equal(result.upstreamPin, scenario.configuredProvider || 'deepseek')
    assert.equal(result.upstreamPinAttached, true)
    assert.equal(result.upstreamPinStatus, scenario.code === 'UPSTREAM_PIN_MISMATCH' ? 'mismatch' : scenario.code ? 'unverified' : 'matched')
    assert.equal(result.routingEvidence.responseId, 'native-test')
    assert.equal(result.routingEvidence.responseModel, model)
    assert.equal(upstream.calls.length, 1)
    assert.equal(records[0].ok, !scenario.code)
    assert.equal(records[0].upstreamPinAttached, true)
    assert.equal(records[0].attempts[0].upstream, scenario.provider || '')
    assert.deepEqual(upstream.calls[0].body.provider.only, [scenario.configuredProvider || 'deepseek'])
    await probe.close()
  })
})

test('historical image policy uses the native logged offload and survives detached replay', async (t) => {
  const { Session } = require('@deepseek-ai/dsh-session')
  const offload = require('@deepseek-ai/dsh-compaction-image-offload')
  const handlers = new Map()
  let projection
  offload.apply({ sessions: { registerMessageProjection(value) { projection = value } }, on(name, handler) { handlers.set(name, handler) } })
  const session = Session.create('image-policy-fixture', undefined, undefined, undefined, [projection])
  const image = { type: 'image', attachment: { attachmentId: 'a'.repeat(64), mediaType: 'image/png', width: 1, height: 1, bytes: 1 } }
  const first = session.append('user/message', llm.createUserMessage({ source: { kind: 'user' }, content: [image] }), { surfaceOp: 'append' })
  const last = session.append('user/message', llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Current input remains unchanged' }] }), { surfaceOp: 'append' })
  const state = { profile: buildProviderPayload({ baseUrl: 'http://127.0.0.1:9/v1', apiKeyEnv: 'CLINEBOT_API_KEY_TEST', models: getAllModels({}) }).payload, overrides: [], imagePolicy: { enabled: true, keep: 0 } }
  const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => 'fake-key', getAttachments: () => undefined, getFs: () => undefined })
  const prepared = await adapter.prepareCall('clinebot', model)
  let failure
  assert.throws(() => prepared.stream(Object.freeze({ provider: 'clinebot', model, messages: Object.freeze(session.deriveMessages()) })), (error) => {
    failure = error.failure
    return error.code === 'IMAGE_OFFLOAD_REQUIRED' && failure.offloadImages === 1
  })
  const service = await runtime(t, adapter)
  const call = await service.prepareCall({ provider: 'clinebot', model })
  const chunks = []
  for await (const chunk of call.stream({ ...call.config, messages: session.deriveMessages() })) chunks.push(chunk)
  assert.equal(chunks.at(-1).reason.failure.offloadImages, 1)
  let decision
  const nativeSession = new Proxy(session, { get(target, key) {
    if (key === 'append') return (...args) => { decision = target.append(...args); return decision }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const result = await handlers.get('agent/request-error')({ agent: { session: nativeSession }, failure, signal: new AbortController().signal }, () => assert.fail('native offload did not recover'))
  assert.equal(result.kind, 'retry')
  assert.equal(decision.type, 'image/offload')
  assert.equal(first.data.content[0].offloaded, undefined)
  assert.equal(session.deriveMessages()[0].content[0].offloaded, true)
  assert.equal(session.deriveMessages()[0].content[0].attachment.attachmentId, image.attachment.attachmentId)
  const restored = Session.create('image-policy-fixture', JSON.parse(JSON.stringify([first, last, decision])), undefined, undefined, [projection])
  assert.equal(restored.deriveMessages()[0].content[0].offloaded, true)
  assert.equal(restored.deriveMessages()[1].content[0].text, last.data.content[0].text)
  assert.equal(first.data.content[0].attachment.bytes, 1)
})

test('absent wire usage stays absent from native settlements and their replay projection', async (t) => {
  const upstream = await mock(t, { reportUsage: false })
  const state = { profile: buildProviderPayload({ baseUrl: upstream.baseUrl, apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels({}) }).payload, overrides: [] }
  const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => 'fake-key', getAttachments: () => undefined, getFs: () => undefined })
  const service = await runtime(t, adapter)
  const prepared = await service.prepareCall({ provider: 'clinebot', model })
  const chunks = await Array.fromAsync(prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }] }))
  assert.equal(chunks.some((chunk) => chunk.type === 'usage'), false)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  const accumulator = new llm.AssistantStreamAccumulator()
  for (const chunk of chunks) accumulator.push({ time: 1, chunk })
  const { Session } = require('@deepseek-ai/dsh-session')
  const session = Session.create('absent-usage-fixture')
  const header = session.append('request/header', { header: { config: prepared.config }, reason: 'initial' })
  const settled = session.append('assistant/message', { turn: 0, step: 0, message: llm.createAssistantMessage({ source: { provider: 'clinebot', model }, content: [{ type: 'text', text: 'pong' }] }), stream: accumulator.snapshot() }, { surfaceOp: 'append' })
  const result = [header, settled].reduce((snapshot, event) => clinepassUsageProjection.apply(snapshot, event), clinepassUsageProjection.init())
  assert.equal(result.view.models[model].calls, 1)
  assert.equal(result.view.models[model].measurements.totalTokens.samples, 0)
})

test('native session usage preserves measured cache writes and missing cache counts through replay', async (t) => {
  for (const cacheWrite of [undefined, 0, 4]) {
    const upstream = await mock(t, { cacheWrite })
    const state = { profile: buildProviderPayload({ baseUrl: upstream.baseUrl, apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels({}) }).payload, overrides: [] }
    const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => 'fake-key', getAttachments: () => undefined, getFs: () => undefined })
    const service = await runtime(t, adapter)
    const prepared = await service.prepareCall({ provider: 'clinebot', model })
    const chunks = await Array.fromAsync(prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }] }))
    const usage = chunks.find(chunk => chunk.type === 'usage').usage
    assert.equal(usage.cacheReadTokens, 5)
    assert.equal(usage.cacheWriteTokens, cacheWrite)
    assert.equal(usage.inputTokens, 15 - (cacheWrite ?? 0))
    assert.equal(usage.outputTokens, 3)
    const event = JSON.parse(JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, message: { source: { provider: 'clinebot', model } }, usage, stream: [] } }))
    const replay = clinepassUsageProjection.apply(clinepassUsageProjection.init(), event).view.models[model]
    assert.equal(replay.measurements.cacheWriteTokens.samples, cacheWrite === undefined ? 0 : 1)
    assert.equal(replay.measurements.cacheWriteTokens.sum, cacheWrite ?? 0)
  }
})

test('native cache aliases reach session estimates; contradictory wire samples do not', async (t) => {
  const estimate = vm.runInNewContext(readFileSync(new URL('../src/client/usage-surfaces.js', import.meta.url), 'utf8') + '\nsessionEstimate', { require: () => ({}) })
  const rates = { costRates: [{ model, inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.2, cacheWritePerMillion: 2.5 }] }
  const valid = { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, prompt_tokens_details: { cache_write_tokens: 0 } }
  for (const scenario of [
    { name: 'top-level cache', usage: { ...valid, cached_tokens: 5 }, input: 15, cache: 5 },
    { name: 'DeepSeek cache', usage: { ...valid, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 15 }, input: 15, cache: 5 },
    { name: 'explicit zero cache', usage: { ...valid, cached_tokens: 0 }, input: 20, cache: 0 },
    { name: 'creation alias with read', usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, cached_tokens: 5, cache_creation_input_tokens: 4 }, input: 11, cache: 5, write: 4 },
    { name: 'creation alias without read', usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, cache_creation_input_tokens: 4 }, partial: true, input: 16, write: 4 },
    { name: 'cache exceeds prompt', usage: { ...valid, prompt_tokens: 5, total_tokens: 8, cached_tokens: 10 }, invalid: true },
    { name: 'write exceeds prompt', usage: { ...valid, cached_tokens: 5, prompt_tokens_details: { cache_write_tokens: 25 } }, invalid: true },
    { name: 'explicit input contradicts prompt', usage: { ...valid, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 20 }, invalid: true },
    { name: 'contradictory total', usage: { ...valid, cached_tokens: 5, total_tokens: 999 }, invalid: true },
    { name: 'absent cache remains partial', usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 }, partial: true },
  ]) await t.test(scenario.name, async (t) => {
    const upstream = await mock(t, { usage: scenario.usage })
    const state = { profile: buildProviderPayload({ baseUrl: upstream.baseUrl, apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels({}) }).payload, overrides: [] }
    const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => 'fake-key', getAttachments: () => undefined, getFs: () => undefined })
    const service = await runtime(t, adapter)
    const prepared = await service.prepareCall({ provider: 'clinebot', model })
    const chunks = await Array.fromAsync(prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }] }))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'pong'))
    const usage = chunks.find(chunk => chunk.type === 'usage')?.usage
    const event = JSON.parse(JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, message: { source: { provider: 'clinebot', model } }, usage, stream: [] } }))
    const projected = clinepassUsageProjection.apply(clinepassUsageProjection.init(), event).view
    const result = estimate(projected, rates)
    if (scenario.invalid) {
      assert.equal(usage, undefined)
      assert.equal(result.tokens, null)
      // Contradictory samples contribute no tokens, so the reference estimate adds nothing.
      assert.equal(result.amount, 0)
    } else if (scenario.partial) {
      assert.equal(result.tokens, 23)
      // Unreported cache fields count as zero rather than hiding the whole estimate.
      assert.equal(result.reason, '')
      assert.ok(Math.abs(result.amount - ((scenario.input ?? 20) * 2 + 3 * 10 + (scenario.write ?? 0) * 2.5) / 1000000) < 1e-12)
      assert.equal(usage.cacheReadTokens, undefined)
      assert.equal(usage.cacheWriteTokens, scenario.write)
      assert.equal(usage.inputTokens, scenario.input ?? 20)
    } else {
      assert.equal(usage.inputTokens, scenario.input)
      assert.equal(usage.cacheReadTokens, scenario.cache)
      assert.equal(usage.cacheWriteTokens, scenario.write ?? 0)
      assert.equal(result.tokens, 23)
      assert.ok(Math.abs(result.amount - (scenario.input * 2 + 3 * 10 + scenario.cache * 0.2 + (scenario.write ?? 0) * 2.5) / 1000000) < 1e-12)
    }
  })
})

test('native projection restore refolds old checkpoints under current usage rules', () => {
  const { SessionProjectionRegistry } = require('@deepseek-ai/dsh-session-projection')
  const registry = Object.assign(Object.create(SessionProjectionRegistry.prototype), { registrations: new Map([[clinepassUsageProjection.key, { def: clinepassUsageProjection }]]) })
  const event = { seq: 0, type: 'assistant/message', data: { turn: 0, step: 0, message: { source: { provider: 'clinebot', model } }, stream: [], usage: { inputTokens: 15, cacheReadTokens: 5, cacheWriteTokens: 0, outputTokens: 3, totalTokens: 23 } } }
  const old = clinepassUsageProjection.apply(clinepassUsageProjection.init(), event)
  const checkpoint = { clinepassUsage: { ver: 1, seq: 0, val: old } }
  // Legacy native records omit zero cache-write counters. The authoritative
  // total still bounds every known input component when that field is absent.
  delete event.data.usage.cacheWriteTokens
  event.data.usage.totalTokens = 8
  assert.equal(registry.restoreFloor(checkpoint), 0)
  const restored = registry.restore(checkpoint, [event], 0, {}, 0)
  assert.equal(restored.snapshot.values.clinepassUsage.models[model].calls, 1)
  assert.equal(restored.snapshot.values.clinepassUsage.models[model].measurements.totalTokens.samples, 0)
  assert.equal(restored.checkpoint.clinepassUsage.ver, 2)
})

test('native streaming probes are metered once as diagnostics and their metadata stays local', async (t) => {
  const upstream = await mock(t)
  const records = [], probeRequests = new WeakSet(), metadata = new WeakMap()
  const proxy = createProxyServer({ snapshot: async () => ({ config: { enabled: true, proxyEnabled: true, baseUrl: upstream.baseUrl }, accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY', present: true, value: 'fake-key' }] }), onRequest: (record) => records.push(record) })
  await proxy.start(); t.after(() => proxy.stop())
  const state = { profile: buildProviderPayload({ baseUrl: proxy.baseUrl, apiKeyEnv: `CLINEBOT_PROXY_KEY_${proxy.port}`, models: getAllModels({}) }).payload, overrides: [] }
  const adapter = createClineAdapter(deps, { state: () => state, resolveKey: async () => proxy.token, getAttachments: () => undefined, getFs: () => undefined,
    noteDispatch: (options, value) => { value.source = probeRequests.has(options) ? 'probe' : 'conversation'; metadata.set(options, value) } })
  const service = await runtime(t, adapter, (options, next) => measureStream(next(), options, () => metadata.get(options), () => assert.fail('duplicate native metric')))
  const probe = createModelProbe({ inject(_deps, callback) { callback({ llm: service }) } }, { live: () => ({}), probeRequests })
  const result = await probe.run(model)
  assert.equal(result.ok, true)
  assert.equal(records.length, 1)
  assert.equal(records[0].source, 'probe')
  assert.equal(records[0].transport, 'proxy')
  assert.equal(records[0].usageFormat, 'openai')
  assert.equal(records[0].sessionId, '')
  assert.equal(upstream.calls[0].headers['x-clinepass-source'], undefined)
  await probe.close()
})

test('standalone registry ownership preserves hidden provider settings and returns them outside HMR', async (t) => {
  const ctx = new Context()
  await ctx.plugin(llm.default)
  t.after(() => ctx.fiber.dispose())
  let cfg = { enabled: true, nativeAdapterEnabled: false, nativeProvider: null, proxyEnabled: false, modelOverrides: [{ id: model, defaultReasoning: 'high' }] }
  let legacy = buildProviderPayload({ baseUrl: 'https://example.test/v1', apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels({}) }).payload
  legacy.headers = { 'X-User': 'preserved' }
  const original = structuredClone(legacy)
  let nativeRegistration, service, controller
  const settings = { get: () => ({ providers: legacy ? { clinebot: legacy } : {} }), describe: () => [], async mutate(_ns, operations) {
    for (const operation of operations) legacy = operation.op === 'unset' ? undefined : operation.value
    nativeRegistration.replace(legacy ? ['clinebot'] : [])
  } }
  await ctx.plugin({ name: 'legacy-owner', inject: ['llm'], apply(inner) {
    service = inner.llm
    nativeRegistration = service.registerAdapter(['clinebot'], createClineAdapter(deps, { state: () => ({ profile: legacy, overrides: [] }), resolveKey: async () => 'fake-key' }))
  } })
  await ctx.plugin({ name: 'new-owner', inject: ['llm'], apply(inner) {
    const fake = { settings, credentials: {}, get: (name) => name === 'settings' ? settings : undefined,
      inject(_names, callback) { callback({ llm: inner.llm, get: () => undefined, effect() {} }) } }
    controller = createNativeAdapterController(fake, { live: () => cfg, persist: async (patch) => { cfg = { ...cfg, ...(typeof patch === 'function' ? patch(cfg) : patch) } }, nativeLoader: async () => deps })
  } })
  const store = await controller.prepare(cfg)
  assert.equal(legacy, undefined)
  assert.equal(cfg.nativeAdapterEnabled, true)
  assert.equal((await service.resolveModelInfo('clinebot', model)).reasoning.defaultEffort, 'high')
  const moved = structuredClone(cfg.nativeProvider)
  moved.models[0].maxTokens = 2048
  await store.write(moved, { expected: cfg.nativeProvider })
  assert.equal((await service.prepareCall({ provider: 'clinebot', model })).config.maxTokens, 2048)
  await assert.rejects(store.write(original, { expected: original }), /settings changed/)
  await store.remove()
  assert.equal(service.listProviders().some((provider) => provider.id === 'clinebot'), false)
  cfg = parseConfig(JSON.parse(JSON.stringify(cfg)))
  assert.deepEqual(cfg.nativeProvider.headers, original.headers)
  assert.deepEqual(cfg.nativeProvider.models, [])
  await store.write(moved, { expected: cfg.nativeProvider })
  assert.equal((await service.prepareCall({ provider: 'clinebot', model })).config.maxTokens, 2048)
  await controller.dispose()
  assert.equal(legacy.models[0].maxTokens, 2048)
  assert.equal(service.listProviders().some((provider) => provider.id === 'clinebot'), true)
})
