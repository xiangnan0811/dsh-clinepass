import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import test from 'node:test'
import { createClineAdapter } from '../lib/native-adapter.js'
import { buildProviderPayload } from '../lib/provider-payload.js'
import { getAllModels } from '../lib/models.js'
import { createProxyServer } from '../lib/proxy-server.js'
import { createNativeAdapterController } from '../lib/native-adapter-controller.js'
import { parseConfig } from '../lib/config.js'
import { measureStream } from '../lib/stream-failover.js'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const pi = require('@deepseek-ai/dsh-llm-pi-ai')
const llm = require('@deepseek-ai/dsh-llm')
const { Context } = require('@deepseek-ai/cordis')
const dshLib = dirname(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const protocol = await import(pathToFileURL(join(dshLib, '../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.lazy.js')).href)
const deps = { ...pi, ...llm, ...protocol }
const model = 'cline-pass/deepseek-v4.1-flash'

async function mock(t) {
  const calls = []
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part)
    calls.push({ body: JSON.parse(Buffer.concat(parts).toString()), headers: req.headers })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'native-test', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    res.end(chunk({ role: 'assistant', content: 'pong' }) + chunk({}, 'stop') + `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 1 } } })}\n\n` + 'data: [DONE]\n\n')
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

test('adapter ownership transfers through the public registry and returns to the native provider on unload', async (t) => {
  const ctx = new Context()
  await ctx.plugin(llm.default)
  t.after(() => ctx.fiber.dispose())
  let cfg = { enabled: true, nativeAdapterEnabled: false, nativeProvider: null, proxyEnabled: false, modelOverrides: [{ id: model, defaultReasoning: 'high' }] }
  let legacy = buildProviderPayload({ baseUrl: 'https://example.test/v1', apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels({}) }).payload
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
  await controller.dispose()
  assert.equal(legacy.models[0].maxTokens, 2048)
  assert.equal(service.listProviders().some((provider) => provider.id === 'clinebot'), true)
})
