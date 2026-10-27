import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import vm from 'node:vm'
import { Readable } from 'node:stream'
import { createStatsStore } from '../lib/stats-store.js'
import { createSessionRouter } from '../lib/session-router.js'
import { createPriceCatalog, parsePriceCatalog } from '../lib/price-catalog.js'
import { effectiveRate, estimateRows, budgetStatus } from '../lib/pricing.js'
import { createProxyServer } from '../lib/proxy-server.js'
import { registerAccountsRoutes } from '../lib/routes/accounts.js'
import { registerSettingsRoutes } from '../lib/routes/settings.js'
import { parseConfig } from '../lib/config.js'

async function fixture(t) {
  const base = resolve('.tmp/agent'); await mkdir(base, { recursive: true })
  const dir = await mkdtemp(join(base, 'adoption-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 0, totalTokens: 60 }
const record = extra => ({ model: 'model', account: 'CLINEBOT_API_KEY', source: 'conversation', ok: true, usage, ...extra })

test('minute analytics retain failures, retries, unknown and overflow samples across restart and retention', async t => {
  const dir = await fixture(t), file = join(dir, 'stats.json')
  let now = Date.parse('2026-10-27T01:00:00Z')
  const options = { now: () => now, readConfig: () => ({ statsRetentionDays: 1 }) }
  const store = createStatsStore(file, options)
  await store.record(record({ latencyMs: 20, ttftMs: 10 }))
  now += 60000
  await store.record(record({ ok: false, latencyMs: 150000, attempts: [{ account: 'a', ok: false, status: 429, latencyMs: 100 }, { account: 'b', ok: false, status: 500, latencyMs: 200 }] }))
  now += 60000
  await store.record(record({ usage: null, latencyMs: null }))
  const reopened = createStatsStore(file, options)
  const result = await reopened.query({ since: '2026-10-27T01:01:00.000Z', until: '2026-10-27T01:02:00.000Z', errorsOnly: true, timezoneOffsetMinutes: -480 })
  assert.equal(result.summary.requests, 1)
  assert.equal(result.attemptRows.reduce((sum, row) => sum + row.totals.requests, 0), 2)
  assert.equal(result.analytics.heatmap[1][9], 1)
  assert.equal(result.analytics.percentiles.latencyMs.p95.overflow, true)
  assert.equal(result.analytics.percentiles.ttftMs.p50.samples, 0)
  await reopened.record(record({ attempts: [{ account: 'a', ok: false, status: 429 }, { account: 'b', ok: true }] }))
  const failedOnly = await reopened.query({ errorsOnly: true })
  assert.equal(failedOnly.summary.requests, 1)
  assert.equal(failedOnly.attemptRows.reduce((sum, row) => sum + row.totals.requests, 0), 2)
  now += 2 * 86400000
  assert.equal((await reopened.query()).analytics.detailedRequests, 0)
  await reopened.record(record({ latencyMs: 50 }))
  const retained = await reopened.query()
  assert.equal(retained.summary.requests, 5)
  assert.equal(retained.analytics.detailedRequests, 1)
  assert.equal(retained.summary.measurements.totalTokens.samples, 4)
})

test('legacy aggregate migration preserves totals without fabricating minute or percentile history', async t => {
  const file = join(await fixture(t), 'stats.json')
  const first = createStatsStore(file)
  await first.record(record({ latencyMs: 100 }))
  const legacy = JSON.parse(await readFile(file, 'utf8'))
  delete legacy.timelineGroups; delete legacy.timelineAttemptGroups; delete legacy.events; delete legacy.detailSince
  for (const row of [...legacy.groups, ...legacy.attemptGroups]) delete row.totals.histograms
  await writeFile(file, JSON.stringify(legacy))
  const migrated = createStatsStore(file)
  await migrated.record(record({ latencyMs: 200 }))
  const result = await migrated.query()
  assert.equal(result.summary.requests, 2)
  assert.equal(result.analytics.detailedRequests, 1)
  assert.equal(result.analytics.percentiles.latencyMs.p50.samples, 1)
  assert.equal(result.summary.measurements.latencyMs.samples, 2)
})

test('account events are sanitized, bounded, persisted and independent of statistics reset', async t => {
  const file = join(await fixture(t), 'stats.json')
  const store = createStatsStore(file)
  for (let i = 0; i < 203; i++) await store.recordEvent({ type: 'cooldown', account: 'CLINEBOT_API_KEY', reason: 'secret bearer text', value: 'SECRET', sessionId: 'PRIVATE', at: i })
  await store.reset()
  const events = await createStatsStore(file).events()
  assert.equal(events.events.length, 200)
  assert.equal(events.events[0].reason, 'automatic')
  assert.doesNotMatch(JSON.stringify(events), /SECRET|PRIVATE|bearer/)
  const routingEvents = []; let now = 0
  const router = createSessionRouter({ now: () => now, onEvent: event => routingEvents.push(event) })
  const input = { accounts: [{ apiKeyEnv: 'a', value: 'PRIVATE', present: true }], baseUrl: 'https://example.test', sessionId: 'PRIVATE' }
  const plan = router.plan(input)
  plan.fail(input.accounts[0], { code: 'RATE_LIMIT', retryAfterMs: 100 })
  now = 101; router.status()
  assert.deepEqual(routingEvents.map(event => event.type), ['route', 'cooldown', 'recover'])
  assert.doesNotMatch(JSON.stringify(routingEvents), /PRIVATE/)
})

test('public prices retain provider identity and null rates; failed refresh retains the last complete cache', async t => {
  const source = { a: { id: 'a', models: { m: { id: 'model', cost: { input: 2, output: 10, cache_read: 0.2 } } } }, b: { id: 'b', models: { m: { id: 'model', cost: { input: 9, output: 20, cache_read: 1, cache_write: 3 } } } } }
  const rows = parsePriceCatalog(source)
  assert.equal(rows.length, 2); assert.equal(rows[0].cacheWritePerMillion, null)
  let fails = false
  const prices = createPriceCatalog(join(await fixture(t), 'prices.json'), { fetchImpl: async () => new Response(JSON.stringify(fails ? {} : source)), now: () => 1234 })
  await prices.sync()
  const config = { costCurrency: 'USD', priceBindings: [{ model: 'cline-pass/model', provider: 'b', sourceModel: 'model' }] }
  assert.equal(effectiveRate('cline-pass/model', config, prices.snapshot()).inputPerMillion, 9)
  assert.equal(effectiveRate('cline-pass/model', { ...config, costCurrency: 'CNY' }, prices.snapshot()), null)
  assert.equal(effectiveRate('cline-pass/model', { ...config, costRates: [{ model: 'cline-pass/model', inputPerMillion: 7 }] }, prices.snapshot()).inputPerMillion, 7)
  fails = true
  await assert.rejects(prices.sync())
  assert.equal(prices.snapshot().syncedAt, 1234); assert.equal(prices.snapshot().models.length, 2)
  await prices.close()
})

test('estimates and budgets never price missing measurements or missing rates as zero', async t => {
  const store = createStatsStore(join(await fixture(t), 'stats.json'))
  await store.record(record({}))
  const rows = (await store.query()).rows
  const config = { costCurrency: 'USD', costRates: [{ model: 'model', inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.2, cacheWritePerMillion: 3 }] }
  assert.equal(estimateRows(rows, config).measuredRequests, 1)
  assert.ok(Math.abs(estimateRows(rows, config).amount - 0.000226) < 1e-12)
  assert.equal(estimateRows(rows, { ...config, costRates: [{ model: 'model', inputPerMillion: 2 }] }).amount, null)
  await store.record(record({ usage: null }))
  const unknown = estimateRows((await store.query()).rows, config)
  assert.equal(unknown.amount, null)
  assert.equal(budgetStatus({ dailyBudget: 1 }, unknown, unknown).code, 'BUDGET_UNVERIFIED')
  assert.equal(budgetStatus({ monthlyBudget: 1 }, { amount: 0 }, { amount: 1 }).code, 'BUDGET_EXCEEDED')
  assert.equal(budgetStatus({}, unknown, unknown).blocked, false)
})

test('budget rejection precedes proxy network activity and is not recorded as billable unknown usage', async t => {
  let sent = 0, recorded = 0
  const proxy = createProxyServer({ snapshot: async () => ({ config: { enabled: true, proxyEnabled: true }, accounts: [] }),
    beforeRequest: async () => { throw Object.assign(new Error('blocked'), { code: 'BUDGET_EXCEEDED' }) },
    fetchImpl: async () => { sent++; throw new Error('unexpected') }, onRequest: () => recorded++ })
  await proxy.start(); t.after(() => proxy.stop())
  const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${proxy.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'model', messages: [] }) })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error.code, 'BUDGET_EXCEEDED')
  assert.equal(sent, 0); assert.equal(recorded, 0)
})

test('quota pace uses actual comparable samples and clears after account changes, failures or resets', async () => {
  const source = await readFile(new URL('../src/client/quota-forecast.js', import.meta.url), 'utf8')
  const create = vm.runInNewContext(source + '\ncreateQuotaPaceTracker', { structuredClone })
  const tracker = create(), start = Date.parse('2026-10-27T00:00:00Z')
  const sample = (minutes, used, reset = '2026-10-27T05:00:00Z') => ({ ok: true, checkedAt: start + minutes * 60000, windows: { fiveHour: { percentUsed: used, resetsAt: reset } } })
  assert.deepEqual(Object.keys(tracker.sample('a', sample(0, 10), start)), [])
  assert.deepEqual(Object.keys(tracker.sample('a', sample(0.5, 15), start + 30000)), [])
  assert.equal(tracker.sample('a', sample(1, 20), start + 60000).fiveHour.remainingMs, 480000)
  assert.equal(tracker.sample('a', sample(1, 20), start + 120000).fiveHour.remainingMs, 420000)
  assert.deepEqual(Object.keys(tracker.sample('a', sample(2, 5), start + 120000)), [])
  assert.deepEqual(Object.keys(tracker.sample('b', sample(3, 15), start + 180000)), [])
  tracker.sample('b', { ok: false }, start + 200000)
  assert.deepEqual(Object.keys(tracker.sample('b', sample(4, 25), start + 240000)), [])
  const reset = '2026-10-27T00:07:00Z'
  tracker.sample('b', sample(5, 30, reset), start + 300000)
  assert.equal(tracker.sample('b', sample(6, 31, reset), start + 360000).fiveHour.holds, true)
  assert.deepEqual(Object.keys(tracker.sample('b', sample(6, 31, reset), start + 420000)), [])
})

test('all rendered locales have matching keys and placeholder names', async () => {
  const source = await readFile(new URL('../src/client/locales.js', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../src/client/locales-adoption.js', import.meta.url), 'utf8')
  const { en, zh } = vm.runInNewContext(source + '\n;({en,zh})')
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const key of Object.keys(en)) assert.deepEqual([...en[key].matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort(), [...zh[key].matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort(), key)
})

test('account rename rebases on current configuration and never changes keys, pins or primary identity', async () => {
  let config = parseConfig({ accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY_2', label: 'Before' }], upstreamPins: [{ model: 'cline-pass/deepseek-v4.1-flash', provider: 'deepseek' }] })
  const routes = []
  registerAccountsRoutes({ effect: fn => fn(), webServer: { register(route) { routes.push(route) } } }, { live: () => config, getSettingsApi: () => ({ replace: async next => { config = next } }), syncProviderState: async () => ({ ok: true }) })
  const route = routes.find(row => row.path.endsWith('/rename'))
  const req = body => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } })
  const response = () => ({ writeHead(code) { this.code = code }, end(text) { this.body = JSON.parse(text) } })
  const res = response(); await route.handler(req({ apiKeyEnv: 'CLINEBOT_API_KEY_2', label: 'After' }), res)
  assert.equal(res.code, 200, JSON.stringify(res.body)); assert.equal(config.accounts[0].label, 'After'); assert.equal(config.upstreamPins[0].provider, 'deepseek')
  const denied = response(); await route.handler(req({ apiKeyEnv: 'CLINEBOT_API_KEY', label: 'Primary' }), denied)
  assert.equal(denied.code, 400); assert.equal(config.apiKeyEnv, 'CLINEBOT_API_KEY')
})

test('clearing a saved key preserves a pinned account and rejects a shadowed environment key', async t => {
  const dir = await fixture(t), env = 'CLINEBOT_API_KEY_ADOPTION'
  const original = process.env[env]
  t.after(() => { if (original === undefined) delete process.env[env]; else process.env[env] = original })
  delete process.env[env]
  let config = parseConfig({ accounts: [{ apiKeyEnv: env, label: 'Saved' }], activeAccount: env, modelsCachePath: join(dir, 'models.json'), discoveredPlanIds: ['cline-pass/deepseek-v4.1-flash'], planVerified: true, upstreamPins: [{ model: 'cline-pass/deepseek-v4.1-flash', provider: 'deepseek' }] })
  let secret = 'fixture-key', cleared = 0, synced = 0
  const routes = []
  registerAccountsRoutes({ credentials: { resolve: async () => ({ value: secret }), unset: async () => { secret = ''; cleared++ } }, effect: fn => fn(), webServer: { register: route => routes.push(route) } }, {
    live: () => config, getSettingsApi: () => ({ replace: async next => { config = next } }), syncProviderState: async () => { synced++; return { ok: true } }, keyDiscovery: { clear() {} },
  })
  const route = routes.find(row => row.path.endsWith('/key/clear'))
  async function clear() {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ apiKeyEnv: env }))]), { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } })
    const res = { writeHead(code) { this.code = code }, end(text) { this.body = JSON.parse(text) } }
    await route.handler(req, res); return res
  }
  process.env[env] = 'shadow-fixture'
  assert.equal((await clear()).code, 400); assert.equal(cleared, 0); assert.equal(config.planVerified, true)
  delete process.env[env]
  const result = await clear()
  assert.equal(result.code, 200, JSON.stringify(result.body)); assert.equal(cleared, 1); assert.equal(synced, 1)
  assert.equal(config.activeAccount, env); assert.equal(config.accounts[0].label, 'Saved'); assert.equal(config.upstreamPins[0].provider, 'deepseek'); assert.equal(config.planVerified, false)
  assert.equal((await clear()).code, 200)
})

test('saving a key reports success when the budget prevents only the subsequent smoke validation', async () => {
  const routes = [], config = parseConfig({ apiKeyEnv: 'ADOPTION_SAVED_KEY' })
  let saved = 0, recorded = 0
  registerSettingsRoutes({ credentials: { set: async () => saved++ }, effect: fn => fn(), webServer: { register: route => routes.push(route) } }, {
    live: () => config, syncProviderState: async () => ({ ok: true }), triggerAutoDiscover() {}, recordMetrics: () => recorded++,
    economy: { guard: async () => { throw Object.assign(new Error('Budget reached'), { code: 'BUDGET_EXCEEDED' }) } },
  })
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ apiKey: 'fixture-value' }))]), { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } })
  const res = { writeHead(code) { this.code = code }, end(text) { this.body = JSON.parse(text) } }
  await routes.find(row => row.path.endsWith('/save-key')).handler(req, res)
  assert.equal(res.code, 200); assert.equal(res.body.ok, true); assert.equal(res.body.validated, false)
  assert.equal(res.body.validationError, 'Budget reached'); assert.equal(saved, 1); assert.equal(recorded, 0)
})
