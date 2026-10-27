import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createServer } from 'node:http'
import { clinepassUsageProjection as projection } from '../lib/session-usage.js'
import { createModelProbe } from '../lib/model-probe.js'
import { registerModelsRoutes } from '../lib/routes/models.js'
import { buildStatus } from '../lib/provider-sync.js'
import { clearUsageCache, usageCache } from '../lib/cline-client.js'
import { parseConfig } from '../lib/config.js'
import { registerSettingsRoutes } from '../lib/routes/settings.js'

const model = 'cline-pass/deepseek-v4.1-flash'
const usage = { inputTokens: 30, cacheReadTokens: 10, cacheWriteTokens: 0, outputTokens: 8, reasoningTokens: 3, totalTokens: 48 }
const header = (provider = 'clinebot', id = model) => ({ type: 'request/header', data: { header: { config: { provider, model: id } } } })
const message = (provider, id, sample = usage, step = 0) => ({ type: 'assistant/message', data: { turn: 0, step, message: { source: { provider, model: id } }, stream: sample ? [{ type: 'chunk', time: 1, chunk: { type: 'usage', usage: sample } }] : [], ...(sample ? { usage: sample } : {}) } })
const clientSource = readFileSync(new URL('../src/client/usage-surfaces.js', import.meta.url), 'utf8')
const { sessionEstimate } = vm.runInNewContext(clientSource + '\n({sessionEstimate})', { require: () => ({}), structuredClone })

test('session usage excludes other providers, separates models and preserves unknown usage through detached replay', () => {
  const events = [header(), message('clinebot', model), header('other', 'foreign'), message('other', 'foreign'), header(), message('clinebot', model, undefined, 1)]
  // Explicitly absent usage, rather than the function's default sample.
  events[5] = message('clinebot', model, null, 1)
  const fold = (rows) => rows.reduce((state, event) => projection.apply(state, event), projection.init())
  const state = fold(events)
  assert.equal(state.view.models[model].calls, 2)
  assert.equal(state.view.models.foreign, undefined)
  assert.equal(state.view.models[model].measurements.totalTokens.sum, 48)
  assert.equal(state.view.models[model].measurements.totalTokens.samples, 1)
  assert.deepEqual(fold(JSON.parse(JSON.stringify(events))), state)
  assert.deepEqual(projection.stateSchema.parse(state), state)
  assert.strictEqual(projection.apply(state, { type: 'compaction/prune' }), state)
})

test('replacement settlements replace the prior sample, while durable retries add another attempt', () => {
  let state = projection.apply(projection.init(), header())
  state = projection.apply(state, message('clinebot', model))
  const original = structuredClone(state)
  state = projection.apply(state, message('clinebot', model, { ...usage, outputTokens: 12, totalTokens: 52 }))
  assert.equal(state.view.models[model].calls, 1)
  assert.equal(state.view.models[model].measurements.outputTokens.sum, 12)
  assert.equal(original.view.models[model].measurements.outputTokens.sum, 8)
  state = projection.apply(state, { type: 'llm/retry-started', data: { turn: 0, step: 0 } })
  state = projection.apply(state, message('clinebot', model))
  assert.equal(state.view.models[model].calls, 2)
  assert.equal(state.view.models[model].measurements.outputTokens.sum, 20)
  state = projection.apply(state, header('clinebot', '__proto__'))
  state = projection.apply(state, message('clinebot', '__proto__'))
  assert.equal(state.view.models.__proto__.calls, 1)
})

test('replay validates partial native counters before deriving prompt totals', () => {
  const partial = { inputTokens: 15, outputTokens: 3, cacheReadTokens: 5, totalTokens: 23 }
  const replay = sample => projection.apply(projection.init(), JSON.parse(JSON.stringify(message('clinebot', model, sample)))).view.models[model].measurements
  const valid = replay(partial)
  assert.deepEqual(valid.promptTokens, { sum: 20, samples: 1 })
  assert.deepEqual(valid.totalTokens, { sum: 23, samples: 1 })
  assert.equal(valid.cacheWriteTokens.samples, 0)
  for (const invalid of [
    { inputTokens: 0, outputTokens: 3, cacheReadTokens: 10, totalTokens: 8 },
    { inputTokens: 0, outputTokens: 3, totalTokens: 2 },
  ]) assert.ok(Object.values(replay(invalid)).every(value => value.samples === 0))
})

test('cost estimates use the available rate, fall back to the input price for missing cache prices and never add reasoning again', () => {
  const state = projection.apply(projection.apply(projection.init(), header()), message('clinebot', model)).view
  const rates = { costRates: [{ model, inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.2, cacheWritePerMillion: 2.5 }] }
  assert.equal(sessionEstimate(state, {}).amount, null)
  assert.equal(sessionEstimate(state, {}).reason, 'missing_rate')
  const estimate = sessionEstimate(state, rates)
  assert.equal(estimate.tokens, 48)
  assert.equal(estimate.amount, (30 * 2 + 10 * 0.2 + 8 * 10) / 1000000)
  assert.equal(estimate.reason, '')
  const zero = sessionEstimate(state, { costRates: [{ model, inputPerMillion: 0, outputPerMillion: 0, cacheReadPerMillion: 0, cacheWritePerMillion: 0 }] })
  assert.equal(zero.amount, 0)
  // Missing cache prices are charged at the input price, as with public reference rows.
  assert.equal(sessionEstimate(state, { costRates: [{ model, inputPerMillion: 2, outputPerMillion: 10 }] }).amount, (30 * 2 + 10 * 2 + 8 * 10) / 1000000)
  const written = projection.apply(projection.apply(projection.init(), header()), message('clinebot', model, { ...usage, inputTokens: 25, cacheWriteTokens: 5 })).view
  assert.ok(Math.abs(sessionEstimate(written, rates).amount - (25 * 2 + 10 * 0.2 + 5 * 2.5 + 8 * 10) / 1000000) < 1e-12)
  // Unreported usage counts as zero; total tokens stay unknown when incomplete.
  const partial = projection.apply({ view: state, last: null }, message('clinebot', model, null, 1)).view
  assert.equal(sessionEstimate(partial, rates).amount, (30 * 2 + 10 * 0.2 + 8 * 10) / 1000000)
  assert.equal(sessionEstimate(partial, rates).reason, '')
  assert.equal(sessionEstimate(partial, rates).tokens, null)
  // A model without any rate is excluded and reported, while priced models still count.
  const mixed = [header(), message('clinebot', model), header('clinebot', 'other-model'), message('clinebot', 'other-model', usage, 1)]
    .reduce((current, event) => projection.apply(current, event), projection.init()).view
  assert.equal(mixed.models['other-model'].calls, 1)
  assert.equal(sessionEstimate(mixed, rates).reason, 'cost_partial')
  assert.equal(sessionEstimate(mixed, rates).amount, estimate.amount)
})

test('composer routing records isolate sessions and ignore cancelled late responses', async () => {
  let state, effect
  const timers = [], requests = []
  const request = (_url, options) => new Promise((resolve) => requests.push({ resolve, signal: options.signal }))
  const hook = vm.runInNewContext(readFileSync(new URL('../src/client/components/upstream-observation.js', import.meta.url), 'utf8') + '\nuseRecentRouting', {
    React: { useState(initial) { state ??= initial; return [state, (value) => { state = value }] }, useEffect(callback) { effect = callback } },
    useClientRequests: () => request, ROUTE_PREFIX: '/dsh-clinebot', AbortController,
    setTimeout(callback) { timers.push(callback); return timers.length }, clearTimeout() {},
  })
  assert.equal(hook('session-a', {}, false).records.length, 0)
  const cleanupA = effect(), taskA = timers.at(-1)()
  hook('session-b', {}, false)
  cleanupA()
  const cleanupB = effect(), taskB = timers.at(-1)()
  assert.equal(requests[0].signal.aborted, true)
  requests[1].resolve({ ok: true, json: async () => ({ ok: true, recent: [
    { id: 'a', sessionId: 'session-a', upstream: 'deepseek' }, { id: 'b', sessionId: 'session-b', upstream: 'baseten' },
  ] }) })
  await taskB
  assert.equal(hook('session-b', {}, false).records[0].id, 'b')
  requests[0].resolve({ ok: true, json: async () => ({ ok: true, recent: [{ id: 'late-a', sessionId: 'session-a', upstream: 'deepseek' }] }) })
  await taskA
  assert.equal(hook('session-b', {}, false).records[0].id, 'b')
  assert.equal(hook('session-c', {}, false).records.length, 0)
  cleanupB()
  assert.equal(requests[1].signal.aborted, true)
})

test('routing details show returned identifiers separately without changing the mismatch result', () => {
  const React = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }) }
  const component = vm.runInNewContext(readFileSync(new URL('../src/client/components/upstream-observation.js', import.meta.url), 'utf8') + '\nUpstreamObservation', { React })
  const t = key => key
  const view = component({ record: { upstreamPin: 'deepseek', upstream: 'openai-compatible-private', upstreamPinStatus: 'mismatch', routingEvidence: { responseModel: 'vmc/flash', resolvedProvider: 'deepseek', planningReasoning: 'SECRET_PLAN' } }, t })
  const text = JSON.stringify(view)
  assert.match(text, /routing.state_mismatch/)
  assert.match(text, /vmc\/flash/)
  assert.match(text, /routing.evidence_hint/)
  assert.doesNotMatch(text, /SECRET_PLAN|routing.state_matched/)
  assert.doesNotMatch(JSON.stringify(component({ record: {}, t })), /routing.evidence_hint/)
})

test('routing history shows ten records, pages by ten and stops at fifty', () => {
  let limit
  const React = { Fragment: 'fragment', useState(initial) { limit ??= initial; return [limit, (value) => { limit = value }] }, createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }) }
  const { RoutingHistory, RoutingRecord } = vm.runInNewContext(readFileSync(new URL('../src/client/components/upstream-observation.js', import.meta.url), 'utf8') + '\n({RoutingHistory,RoutingRecord})', { React })
  const t = (key, values) => values ? `${key}:${JSON.stringify(values)}` : key
  const records = Array.from({ length: 64 }, (_, index) => ({ id: `r${index}`, model: 'm', account: 'a', ok: index !== 1, completedAt: 0, upstreamPinStatus: 'mismatch', attempts: [{ code: index === 1 ? 'RATE_LIMIT' : '' }] }))
  const rows = (tree) => tree.children.find((child) => child?.props?.className === 'cb-routing-list').children
  const more = (tree) => tree.children.at(-2)
  let tree = RoutingHistory({ records, t })
  assert.equal(rows(tree).length, 10)
  assert.match(more(tree).children[0].children[0], /"count":40/)
  for (let page = 0; page < 4; page++) { more(tree).children[0].props.onClick(); tree = RoutingHistory({ records, t }) }
  assert.equal(rows(tree).length, 50)
  assert.equal(more(tree), null)
  assert.equal(more(RoutingHistory({ records: records.slice(0, 3), t })), null)
  // Failure state and pin result stay visible in the collapsed row; the failure code is in the expanded body.
  const [summary, body] = RoutingRecord({ row: records[1], t }).children
  assert.equal(summary.type, 'summary')
  assert.match(JSON.stringify(summary), /cb-routing-dot-bad/)
  assert.match(JSON.stringify(summary), /cb-badge-bad.*routing\.state_mismatch/)
  assert.match(JSON.stringify(body), /RATE_LIMIT/)
})

test('statistics coverage never rounds a partial share up to complete', () => {
  const { coveragePercent } = vm.runInNewContext(readFileSync(new URL('../src/client/components/stats-section.js', import.meta.url), 'utf8') + '\n({coveragePercent})')
  assert.equal(coveragePercent(14038, 14039), '99.9%')
  assert.equal(coveragePercent(14039, 14039), '100%')
  assert.equal(coveragePercent(2433, 14039), '17.3%')
  assert.equal(coveragePercent(1, 14039), '<0.1%')
  assert.equal(coveragePercent(0, 14039), '—')
  assert.equal(coveragePercent(0, 0), '—')
})

test('credential source identifiers are translated when a label exists', () => {
  const { sourceLabel } = vm.runInNewContext(readFileSync(new URL('../src/client/settings-page.js', import.meta.url), 'utf8') + '\n({sourceLabel})')
  const t = (key) => ({ 'source.credentials': '凭据库' })[key] || key
  assert.equal(sourceLabel('credentials', t), '凭据库')
  assert.equal(sourceLabel('custom-store', t), 'custom-store')
})

test('reset countdown distinguishes a future reset, reset in progress, and missing time', () => {
  const reset = vm.runInNewContext(readFileSync(new URL('../src/client/progress-bar.js', import.meta.url), 'utf8') + '\nresetCountdown')
  assert.equal(reset('2026-10-19T00:01:01Z', Date.parse('2026-10-19T00:00:00Z')).time, '1m 1s')
  assert.equal(reset('2026-10-19T00:00:00Z', Date.parse('2026-10-19T00:00:00Z')).kind, 'resetting')
  assert.equal(reset('', 0).kind, 'unknown')
  assert.equal(reset('invalid', 0).kind, 'unknown')
})

test('quota observers cancel obsolete identities, preserve unknown/error states and stop without subscribers', async () => {
  const timers = new Map(), visibility = new Set(), scopeListeners = new Set(), requests = []
  let sequence = 0, config = { baseUrl: 'https://first.test', apiKeyEnv: 'KEY', activeAccount: '' }
  const document = { visibilityState: 'visible', addEventListener(_name, listener) { visibility.add(listener) }, removeEventListener(_name, listener) { visibility.delete(listener) } }
  const scope = { getSnapshot: () => ({ value: config }), subscribe(listener) { scopeListeners.add(listener); return () => scopeListeners.delete(listener) } }
  const { createQuotaResource, quotaPercent } = vm.runInNewContext(clientSource + '\n({createQuotaResource,quotaPercent})', {
    require: () => ({}), AbortController, document, ROUTE_PREFIX: '/dsh-clinebot',
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) },
    fetchJson(_url, options) { return new Promise((resolve) => requests.push({ signal: options.signal, resolve })) },
  })
  const resource = createQuotaResource(scope)
  assert.equal(requests.length, 0)
  const off = resource.subscribe(() => {})
  assert.equal(requests.length, 1)
  config = { ...config, activeAccount: 'KEY_2' }
  for (const listener of scopeListeners) listener()
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests.length, 2)
  requests[1].resolve({ ok: true, json: async () => ({ ok: true, windows: { fiveHour: { percentUsed: 0 } } }) })
  await new Promise((resolve) => setImmediate(resolve))
  requests[0].resolve({ ok: true, json: async () => ({ ok: true, windows: { fiveHour: { percentUsed: 99 } } }) })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(resource.snapshot().data.windows.fiveHour.percentUsed, 0)
  assert.equal(quotaPercent(resource.snapshot().data.windows.weekly), null)
  assert.equal(quotaPercent(resource.snapshot().data.windows.fiveHour), 0)
  document.visibilityState = 'hidden'
  for (const listener of visibility) listener()
  assert.equal(timers.size, 0)
  off(); resource.dispose()
  assert.equal(visibility.size, 0)
  assert.equal(scopeListeners.size, 0)
  assert.equal(requests[1].signal.aborted, true)
})

test('streaming probes measure actual output, preserve options and recognize empty/error finishes', async () => {
  let time = 0, finish = 'stop', output = true, captured
  const probeRequests = new WeakSet()
  const ctx = { inject(_deps, fn) { fn({ llm: { async prepareCall(config) { return { config, async *stream(options) {
    captured = options; assert.equal(probeRequests.has(options), true)
    yield { type: 'block-start', blockType: 'reasoning' }
    time = 20
    if (output) yield { type: 'reasoning-delta', text: 'thinking' }
    time = 35
    yield { type: 'finish', reason: { kind: finish, failure: { code: 'RATE_LIMIT' } } }
  } } } } }) } }
  const probe = createModelProbe(ctx, { live: () => ({}), probeRequests, now: () => time })
  const result = await probe.run(model)
  assert.equal(result.ok, true)
  assert.equal(result.ttftMs, 20)
  assert.equal(result.totalMs, 35)
  assert.equal(Object.isFrozen(captured), true)
  assert.equal(captured.maxTokens, 1024)
  output = false; time = 0
  assert.equal((await probe.run(model)).error, 'EMPTY_RESPONSE')
  finish = 'error'
  assert.equal((await probe.run(model)).error, 'RATE_LIMIT')
  await assert.rejects(probe.run('unregistered'), /Unknown model/)
  await probe.close()
})

test('probe caller cancellation, deadline and plugin shutdown release the native request', async () => {
  let aborted = 0
  const ctx = { inject(_deps, fn) { fn({ llm: { async prepareCall(config) { return { config, async *stream(options) {
    options.signal.throwIfAborted()
    await new Promise((_, reject) => options.signal.addEventListener('abort', () => { aborted++; reject(options.signal.reason) }, { once: true }))
  } } } } }) } }
  const probe = createModelProbe(ctx, { live: () => ({}), probeRequests: new WeakSet() })
  assert.equal((await probe.run(model, { timeoutMs: 10 })).error, 'PROBE_TIMEOUT')
  const controller = new AbortController()
  const task = probe.run(model, { signal: controller.signal })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  assert.equal((await task).error, 'CANCELLED')
  const last = probe.run(model)
  await new Promise((resolve) => setImmediate(resolve))
  await probe.close()
  assert.equal((await last).error, 'CANCELLED')
  assert.equal(aborted, 3)
})

test('quota display routes and status reads do not populate the account routing cache', async (t) => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url.endsWith('/usage-limits') ? { limits: [{ type: 'five_hour', percentUsed: 12 }] } : req.url.endsWith('/users/me/plan') ? { plan: { name: 'Display fixture' } } : {}))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  clearUsageCache(); t.after(clearUsageCache)
  const cfg = parseConfig({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  const routes = []
  const credentials = { resolve: async () => ({ value: 'fake-display-key' }) }
  const ctx = { credentials, get: (name) => name === 'credentials' ? credentials : undefined, effect: (fn) => fn(), webServer: { register(route) { routes.push(route); return () => {} } } }
  registerModelsRoutes(ctx, { live: () => cfg })
  const res = { writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
  await routes.find((route) => route.path === '/dsh-clinebot/usage').handler({ method: 'GET', url: '/dsh-clinebot/usage', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } }, res)
  assert.equal(res.status, 200)
  assert.equal(res.body.windows.fiveHour.percentUsed, 12)
  assert.equal(usageCache.size, 0)
  const status = await buildStatus(ctx, cfg)
  assert.equal(status.usage.windows.fiveHour.percentUsed, 12)
  assert.equal(usageCache.size, 0)
})

test('concurrent preference patches merge after the preceding write commits', async () => {
  let cfg = parseConfig({}), release, entered
  const barrier = new Promise((resolve) => { release = resolve })
  const firstEntered = new Promise((resolve) => { entered = resolve })
  let writes = 0
  const routes = []
  registerSettingsRoutes({ effect: (fn) => fn(), webServer: { register(route) { routes.push(route); return () => {} } } }, {
    live: () => cfg, syncProviderState: async () => ({ ok: true }),
    getSettingsApi: () => ({ async replace(next) { if (!writes++) { entered(); await barrier }; cfg = next } }),
  })
  const route = routes.find((row) => row.path === '/dsh-clinebot/config')
  const { Readable } = await import('node:stream')
  const call = (body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method: 'PUT', headers: { host: 'localhost', origin: 'http://localhost' }, socket: { remoteAddress: '127.0.0.1' } })
    const res = { writeHead(status) { this.status = status }, end() {} }
    return route.handler(req, res).then(() => assert.equal(res.status, 200))
  }
  const first = call({ showSidebarQuota: false })
  await firstEntered
  const second = call({ costCurrency: 'CNY' })
  await new Promise((resolve) => setImmediate(resolve))
  release(); await Promise.all([first, second])
  assert.equal(cfg.showSidebarQuota, false)
  assert.equal(cfg.costCurrency, 'CNY')
})
