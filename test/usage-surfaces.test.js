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

test('cost estimates require explicit rates and complete per-model measurements, without adding reasoning again', () => {
  const state = projection.apply(projection.apply(projection.init(), header()), message('clinebot', model)).view
  const rates = { costRates: [{ model, inputPerMillion: 2, outputPerMillion: 10 }] }
  assert.equal(sessionEstimate(state, {}).amount, null)
  const estimate = sessionEstimate(state, rates)
  assert.equal(estimate.tokens, 48)
  assert.equal(estimate.amount, (40 * 2 + 8 * 10) / 1000000)
  const zero = sessionEstimate(state, { costRates: [{ model, inputPerMillion: 0, outputPerMillion: 0 }] })
  assert.equal(zero.amount, 0)
  const partial = projection.apply({ view: state, last: null }, message('clinebot', model, null, 1)).view
  assert.equal(sessionEstimate(partial, rates).amount, null)
  assert.equal(sessionEstimate(partial, rates).tokens, null)
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
