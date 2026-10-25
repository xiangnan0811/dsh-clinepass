import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createStatsStore, statsCsv } from '../lib/stats-store.js'
import { normalizeRequest, normalizeUsage } from '../lib/request-metrics.js'
import { measureStream } from '../lib/stream-failover.js'
import { registerStatsRoutes } from '../lib/routes/stats.js'
import { smokeChat } from '../lib/cline-client.js'

async function fixture(t) {
  const base = resolve('.tmp/agent')
  await mkdir(base, { recursive: true })
  const dir = await mkdtemp(join(base, 'statistics-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, file: join(dir, 'profile', 'clinepass', 'stats.json') }
}
const event = (extra = {}) => ({ model: 'test-model', account: 'CLINEBOT_API_KEY', source: 'conversation', ok: true,
  usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 0, reasoningTokens: 5, totalTokens: 60 }, latencyMs: 100, ...extra })

test('usage counters preserve unknowns, subtract cache hits and never add reasoning twice', () => {
  const usage = normalizeUsage({ prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens_details: { reasoning_tokens: 5 } }, 'openai')
  assert.equal(usage.inputTokens, 20)
  assert.equal(usage.cacheReadTokens, 30)
  assert.equal(usage.cacheWriteTokens, null)
  assert.equal(usage.reasoningTokens, 5)
  assert.equal(usage.totalTokens, 70)
  assert.equal(normalizeUsage(undefined).outputTokens, null)
  assert.equal(normalizeUsage({ prompt_tokens: 10 }, 'openai').inputTokens, null)
  assert.equal(normalizeUsage({ prompt_tokens: 5, prompt_tokens_details: { cached_tokens: 10 } }, 'openai').inputTokens, null)
  assert.equal(normalizeUsage({ inputTokens: 0, outputTokens: '5' }).inputTokens, 0)
  const record = normalizeRequest(event({ apiKey: 'DO_NOT_STORE', messages: ['PRIVATE'], error: { message: 'PRIVATE' }, attempts: [{ account: 'CLINEBOT_API_KEY', value: 'DO_NOT_STORE' }] }))
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE|DO_NOT_STORE/)
})

test('shared metering accepts cache aliases and rejects contradictory counters', () => {
  const raw = { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, cached_tokens: 5, prompt_tokens_details: { cache_write_tokens: 0 } }
  for (const source of ['proxy', 'conversation', 'smoke']) {
    const record = normalizeRequest(event({ source, usageFormat: 'openai', usage: raw }))
    assert.equal(record.usage.cacheReadTokens, 5)
    assert.equal(record.usage.inputTokens, 15)
    const bad = normalizeRequest(event({ source, usageFormat: 'openai', usage: { ...raw, prompt_tokens: 4, total_tokens: 7 } }))
    assert.equal(bad.ok, true)
    assert.ok(Object.values(bad.usage).every(value => value === null))
  }
  for (const usage of [
    { inputTokens: 15, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0, totalTokens: 999 },
    { inputTokens: 15, promptTokens: 19, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0 },
    { inputTokens: 15, outputTokens: 3, reasoningTokens: 4 },
  ]) assert.ok(Object.values(normalizeUsage(usage)).every(value => value === null))
})

test('routing observations distinguish actual responses from settings and absent evidence', () => {
  for (const [routing, expected] of [
    [{ upstreamPin: 'deepseek', upstream: 'DeepSeek', upstreamPinAttached: true }, 'matched'],
    [{ upstreamPin: 'deepseek', upstream: 'openai-compatible-private', upstreamPinAttached: true }, 'mismatch'],
    [{ upstreamPin: 'deepseek', upstream: '', upstreamPinAttached: true }, 'unverified'],
    [{ upstreamPin: 'deepseek', upstream: '', upstreamPinAttached: false }, 'not-attached'],
    [{ upstreamPin: '', upstream: 'baseten', upstreamPinAttached: false }, 'automatic'],
    [{}, 'unrecorded'],
  ]) {
    const row = normalizeRequest(event({ ...routing, messages: ['SECRET'], apiKey: 'SECRET' }))
    assert.equal(row.upstreamPinStatus, expected)
    assert.equal(row.attempts[0].upstreamPinStatus, expected)
    assert.equal(row.upstream, routing.upstream || '')
    assert.equal(row.upstreamPin, routing.upstreamPin ?? null)
    assert.doesNotMatch(JSON.stringify(row), /SECRET/)
  }
})

test('successful, ignored, missing and automatic upstream records survive restart beside legacy data', async (t) => {
  const { file } = await fixture(t)
  const store = createStatsStore(file)
  await store.record(event({ upstreamPin: 'deepseek', upstream: 'deepseek', upstreamPinAttached: true }))
  await store.record(event({ ok: false, upstreamPin: 'deepseek', upstream: 'openai-compatible-private', upstreamPinAttached: true }))
  await store.record(event({ ok: false, upstreamPin: 'deepseek', upstream: '', upstreamPinAttached: true }))
  await store.record(event({ upstreamPin: '', upstream: 'fireworks', upstreamPinAttached: false }))
  const data = JSON.parse(await readFile(file, 'utf8'))
  const legacy = structuredClone(data.recent[0])
  for (const field of ['upstream', 'upstreamPin', 'upstreamPinAttached', 'upstreamPinStatus']) delete legacy[field]
  legacy.id = 'legacy-request'
  data.recent.unshift(legacy)
  await writeFile(file, JSON.stringify(data))
  const restored = await createStatsStore(file).query()
  assert.deepEqual(restored.recent.slice(0, 4).map((row) => row.upstreamPinStatus), ['automatic', 'unverified', 'mismatch', 'matched'])
  assert.equal(restored.recent[2].ok, false)
  assert.equal(restored.recent[2].upstream, 'openai-compatible-private')
  assert.equal(restored.recent[4].upstreamPinStatus, undefined)
  assert.equal(restored.summary.requests, 4)
})

test('smoke outcomes keep absent usage unknown and reject embedded or empty successes', async () => {
  const invoke = (body, status = 200) => smokeChat('https://example.test/v1', 'fake-test-key', { fetchImpl: async () => new Response(body, { status }) })
  const missing = await invoke('{"choices":[{"message":{"content":"pong"}}]}')
  assert.equal(missing.ok, true)
  assert.equal(missing.usage, null)
  assert.equal((await invoke('{"error":{"code":"RATE_LIMIT"}}')).ok, false)
  assert.equal((await invoke('{"choices":[]}')).ok, false)
  const failed = await invoke('Unavailable', 503)
  assert.equal(failed.ok, false)
  assert.equal(failed.status, 503)
  assert.match(failed.error, /HTTP 503/)
})

test('profile statistics load before merging concurrent requests and survive a fresh instance', async (t) => {
  const { file } = await fixture(t)
  const first = createStatsStore(file)
  await first.record(event())
  const second = createStatsStore(file)
  await Promise.all(Array.from({ length: 16 }, (_, index) => (index % 2 ? first : second).record(event({ account: `CLINEBOT_API_KEY_${index % 2}`, source: index % 2 ? 'smoke' : 'proxy', usageFormat: index % 2 ? 'native' : 'openai', usage: index % 2 ? event().usage : { prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 30 } } }))))
  const restored = createStatsStore(file)
  const data = await restored.query()
  assert.equal(data.summary.requests, 17)
  assert.equal(data.summary.measurements.totalTokens.sum, 60 + 8 * 60 + 8 * 70)
  assert.equal(data.grouped.account.length, 3)
  assert.equal((await restored.query({ account: 'CLINEBOT_API_KEY_1' })).summary.requests, 8)
  assert.equal((await restored.query({ source: 'proxy' })).summary.requests, 8)
  assert.equal(data.persisted, true)
  assert.equal(data.attemptAccounts.reduce((sum, row) => sum + row.totals.requests, 0), 17)
})

test('storage failures preserve new measurements in memory and recover without counting twice', async (t) => {
  const { file } = await fixture(t)
  let failing = true
  const { writeFileAtomic } = await import('@deepseek-ai/dsh-atomic-write')
  const store = createStatsStore(file, { atomicWrite: async (...args) => {
    if (failing) throw Object.assign(new Error('disk full with PRIVATE detail'), { code: 'ENOSPC' })
    return writeFileAtomic(...args)
  } })
  assert.equal(await store.record(event()), false)
  let data = await store.query()
  assert.equal(data.summary.requests, 1)
  assert.equal(data.pendingRequests, 1)
  assert.match(data.error, /ENOSPC/)
  assert.doesNotMatch(data.error, /PRIVATE/)
  failing = false
  assert.equal(await store.record(event({ ok: false, usage: undefined })), true)
  data = await store.query()
  assert.equal(data.summary.requests, 2)
  assert.equal(data.summary.measurements.outputTokens.samples, 1)
  assert.equal(data.pendingRequests, 0)
  assert.equal(data.error, '')
  assert.equal((await createStatsStore(file).query()).summary.requests, 2)
})

test('a startup read failure does not discard new measurements when an existing reset epoch becomes readable', async (t) => {
  const { file } = await fixture(t)
  const original = createStatsStore(file)
  await original.reset(); await original.record(event())
  let blocked = true
  const store = createStatsStore(file, { fs: { mkdir, copyFile, readFile: (...args) => blocked ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })) : readFile(...args) } })
  await store.ready
  assert.equal(await store.record(event()), false)
  blocked = false
  assert.equal(await store.record(event()), true)
  assert.equal((await store.query()).summary.requests, 3)
})

test('corrupt statistics are not overwritten; explicit reset archives them and clears buffered measurements', async (t) => {
  const { dir, file } = await fixture(t)
  await mkdir(join(dir, 'profile', 'clinepass'), { recursive: true })
  const corrupt = '{bad JSON'
  await writeFile(file, corrupt)
  const store = createStatsStore(file)
  assert.equal(await store.record(event()), false)
  const data = await store.query()
  assert.equal(data.errorCode, 'STATS_CORRUPT')
  assert.equal(data.summary.requests, 1)
  assert.equal(await readFile(file, 'utf8'), corrupt)
  assert.equal((await store.reset()).archived, true)
  assert.equal((await store.query()).summary.requests, 0)
  const archive = (await readdir(join(dir, 'profile', 'clinepass'))).find((name) => name.includes('.corrupt-'))
  assert.equal(await readFile(join(dir, 'profile', 'clinepass', archive), 'utf8'), corrupt)
  await store.record(event())
  assert.equal((await store.query()).summary.requests, 1)
  await writeFile(file, JSON.stringify({ version: 99, groups: [] }))
  assert.equal((await store.query()).errorCode, 'STATS_CORRUPT')
})

test('a failed reset keeps existing counters, and another writer observes a successful reset', async (t) => {
  const { file } = await fixture(t)
  let blocked = false
  const { writeFileAtomic } = await import('@deepseek-ai/dsh-atomic-write')
  const store = createStatsStore(file, { atomicWrite: (...args) => blocked ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })) : writeFileAtomic(...args) })
  await store.record(event())
  const other = createStatsStore(file)
  await other.ready
  blocked = true
  await assert.rejects(store.reset(), /EACCES/)
  assert.equal((await store.query()).summary.requests, 1)
  blocked = false
  await store.reset()
  await other.record(event())
  assert.equal((await store.query()).summary.requests, 1)
})

test('CSV exports measurements with sample counts, unknown blanks and safe quoted text', async (t) => {
  const { file } = await fixture(t)
  const store = createStatsStore(file)
  await store.record(event({ model: '=FORMULA("x"),\nrow', usage: undefined }))
  const csv = statsCsv((await store.query()).rows)
  assert.match(csv, /"'=FORMULA\(""x""\),\nrow"/)
  assert.match(csv.split('\r\n')[0], /inputTokens,inputTokensSamples/)
  assert.match(csv, /,0,,0,/)
})

test('failed retry attempts retain their own account after recent records expire', async (t) => {
  const { file } = await fixture(t)
  const store = createStatsStore(file)
  await store.record(event({ source: 'proxy', account: 'CLINEBOT_API_KEY_2', usageFormat: 'openai', usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }, attempts: [
    { account: 'CLINEBOT_API_KEY', status: 429, code: 'RATE_LIMIT', ok: false }, { account: 'CLINEBOT_API_KEY_2', status: 200, ok: true },
  ] }))
  await Promise.all(Array.from({ length: 101 }, () => store.record(event())))
  const restored = await createStatsStore(file).query()
  assert.equal(restored.recent.length, 100)
  assert.equal(restored.summary.requests, 102)
  const primary = restored.attemptAccounts.find((row) => row.value === 'CLINEBOT_API_KEY').totals
  const secondary = restored.attemptAccounts.find((row) => row.value === 'CLINEBOT_API_KEY_2').totals
  assert.equal(primary.failure, 1)
  assert.equal(primary.rateLimits, 1)
  assert.equal(secondary.success, 1)
  assert.equal(secondary.rateLimits, 0)
})

test('native stream metering records usage, tool TTFT, frozen route identity and cancellation once', async () => {
  const records = []
  const options = Object.freeze({ model: 'model', sessionId: 'session' })
  const metadata = { transport: 'direct', account: 'CLINEBOT_API_KEY_2' }
  const chunks = [{ type: 'tool-call-delta', name: 'tool', argumentsDelta: '' }, { type: 'usage', usage: event().usage }, { type: 'finish', reason: { kind: 'tool-calls' } }]
  async function* source() { yield* chunks }
  assert.deepEqual(await Array.fromAsync(measureStream(source(), options, () => metadata, (record) => records.push(record))), chunks)
  assert.equal(records.length, 1)
  assert.equal(records[0].account, metadata.account)
  assert.equal(records[0].usage.totalTokens, 60)
  assert.ok(records[0].ttftMs >= 0)
  // Dispatch metadata takes precedence over a settings toggle during a call.
  metadata.transport = 'proxy'
  await Array.fromAsync(measureStream(source(), options, () => metadata, () => assert.fail('proxy was counted twice')))
  metadata.transport = 'direct'
  const stream = measureStream(source(), options, () => metadata, (record) => records.push(record))
  await stream.next(); await stream.return()
  assert.equal(records.length, 2)
  assert.equal(records[1].cancelled, true)
  assert.equal(records[1].ok, false)
})

test('statistics endpoints validate filters, keep reset CSRF protection and export authenticated data', async () => {
  const routes = []
  let resets = 0
  registerStatsRoutes({ effect: (fn) => fn(), webServer: { register: (route) => { routes.push(route); return () => {} } } }, {
    statistics: { query: async () => ({ available: true, rows: [], attemptRows: [], error: '' }), reset: async () => { resets++; return { ok: true } } },
  })
  const response = () => ({ headers: {}, writeHead(code, headers) { this.code = code; this.headers = headers }, end(body) { this.body = body } })
  const req = { method: 'GET', url: '/dsh-clinebot/stats?from=2026-02-31', headers: { host: 'localhost', origin: 'http://localhost' }, socket: { remoteAddress: '127.0.0.1' } }
  const invalid = response(); await routes[0].handler(req, invalid); assert.equal(invalid.code, 400)
  const exported = response(); await routes[1].handler({ ...req, url: '/dsh-clinebot/stats/export' }, exported); assert.equal(exported.code, 200); assert.match(exported.headers['Content-Type'], /text\/csv/)
  const denied = response(); await routes[2].handler({ ...req, method: 'POST', headers: { ...req.headers, origin: 'https://elsewhere.test' } }, denied); assert.equal(denied.code, 403); assert.equal(resets, 0)
})
