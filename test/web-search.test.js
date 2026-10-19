import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { WebError } from '@deepseek-ai/dsh-web'
import { createWebSearch } from '../lib/web-search.js'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const { Context, Service } = require('@deepseek-ai/cordis')
const { WebRuntime } = require('@deepseek-ai/dsh-web')

async function fixture(t) {
  const requests = []
  let closed = 0
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part)
    const body = JSON.parse(Buffer.concat(parts).toString())
    requests.push({ url: req.url, auth: req.headers.authorization, body })
    res.on('close', () => { if (!res.writableFinished) closed++ })
    if (/^http-/.test(body.query)) { res.writeHead(Number(body.query.slice(5)), { 'Retry-After': '17' }); return res.end('secret-error-body') }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (body.query === 'stalled-body') { res.flushHeaders(); return }
    if (body.query === 'bad-json') return res.end('not json')
    if (body.query === 'bad-shape') return res.end('{}')
    if (body.query === 'bad-url') return res.end('{"results":[{"url":"javascript:alert(1)"}]}')
    if (body.query === 'embedded-error') return res.end('{"error":"no search access","results":[]}')
    if (body.query === 'empty') return res.end('{"results":[]}')
    res.end(JSON.stringify({ results: [1, 2, 3].map((i) => ({ url: `https://example.test/${i}`, title: `Result ${i}`, snippet: 'A source', publishedAt: '2026-10-18T00:00:00Z' })) }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  return { requests, closed: () => closed, baseUrl: `http://127.0.0.1:${server.address().port}/api/v1` }
}

function runtime(baseUrl, extra = {}) {
  let cfg = { enabled: true, webSearchEnabled: true, searchTimeoutMs: 1000, baseUrl, activeAccount: 'first' }
  const runtime = createWebSearch({}, { live: () => ({ ...cfg }), resolveAccount: async (_ctx, cfg) => ({ value: cfg.activeAccount }), ...extra })
  return { ...runtime, set: (patch) => { cfg = { ...cfg, ...patch }; runtime.sync() } }
}

test('native search sends the active credential, limits sources and distinguishes genuine zero results', async (t) => {
  const server = await fixture(t), rt = runtime(server.baseUrl)
  t.after(() => rt.close())
  const result = await rt.provider.search({ query: ' hello ', maxResults: 2 })
  assert.equal(result.sources.length, 2); assert.equal(result.truncated, true)
  assert.deepEqual(result.sources[0], { url: 'https://example.test/1', title: 'Result 1', snippet: 'A source', publishedAt: '2026-10-18T00:00:00Z' })
  assert.deepEqual(server.requests[0], { url: '/api/v1/alpha/web-search', auth: 'Bearer first', body: { query: 'hello', numResults: 2 } })
  rt.set({ activeAccount: 'second' })
  assert.deepEqual(await rt.provider.search({ query: 'empty' }), { sources: [], truncated: false })
  assert.equal(server.requests[1].auth, 'Bearer second')
  await rt.provider.search({ query: 'large', maxResults: 100 })
  assert.equal(server.requests[2].body.numResults, 10)
  await assert.rejects(rt.provider.search({ query: '' }), { code: 'WEB_INVALID_REQUEST' })
  await assert.rejects(rt.provider.search({ query: 'x', maxResults: 0 }), { code: 'WEB_INVALID_REQUEST' })
  assert.equal(server.requests.length, 3)
})

test('search HTTP, malformed, network and credential failures never become empty successes or leak bodies', async (t) => {
  const server = await fixture(t), rt = runtime(server.baseUrl)
  t.after(() => rt.close())
  for (const status of [401, 402, 429, 500]) {
    await assert.rejects(rt.provider.search({ query: `http-${status}` }), (error) => {
      assert.ok(error instanceof WebError)
      assert.equal(error.code, `WEB_CLINE_HTTP_${status}`); assert.equal(error.status, status); assert.equal(error.retryAfter, '17')
      assert.ok(!error.message.includes('secret-error-body')); return true
    })
  }
  for (const query of ['bad-json', 'bad-shape', 'bad-url', 'embedded-error']) await assert.rejects(rt.provider.search({ query }), { code: 'WEB_INVALID_RESPONSE' })
  const offline = runtime(server.baseUrl, { fetchImpl: async () => { throw new Error('a secret from transport') } })
  await assert.rejects(offline.provider.search({ query: 'x' }), { code: 'WEB_PROVIDER_FAILED', message: 'ClinePass search request failed' })
  const missing = runtime(server.baseUrl, { resolveAccount: async () => ({ value: '' }) })
  await assert.rejects(missing.provider.search({ query: 'x' }), { code: 'WEB_CREDENTIAL_MISSING' })
})

test('search deadlines cover bodies and caller, disable and shutdown cancellation release native work', async (t) => {
  const server = await fixture(t), rt = runtime(server.baseUrl)
  t.after(() => rt.close())
  rt.set({ searchTimeoutMs: 50 })
  await assert.rejects(rt.provider.search({ query: 'stalled-body' }), { code: 'WEB_TIMEOUT' })
  rt.set({ searchTimeoutMs: 1000 })
  for (const cancel of ['caller', 'disable', 'close']) {
    const controller = new AbortController()
    const count = server.requests.length
    const task = rt.provider.search({ query: 'stalled-body' }, controller.signal)
    const rejection = assert.rejects(task, { code: 'WEB_CANCELLED' })
    while (server.requests.length === count) await new Promise((resolve) => setImmediate(resolve))
    if (cancel === 'caller') controller.abort()
    if (cancel === 'disable') rt.set({ webSearchEnabled: false })
    if (cancel === 'close') await rt.close()
    await rejection
    assert.equal(rt.status().activeRequests, 0)
    if (cancel === 'disable') rt.set({ webSearchEnabled: true })
  }
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(server.closed(), 4)
})

test('native web registry respects opt-in, preserves the host selection, and unregisters on fiber disposal', async (t) => {
  const server = await fixture(t), ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(WebRuntime, { searchProvider: 'other' })
  await ctx.plugin({ name: 'other-search', inject: ['web'], apply(inner) {
    inner.web.registerSearchProvider({ id: 'other', available: () => true, search: async () => ({ sources: [{ url: 'https://other.test/' }], truncated: false }) })
  } })
  let cfg = { webSearchEnabled: false, baseUrl: server.baseUrl }, rt, web, resolves = 0
  const plugin = await ctx.plugin({ name: 'cline-search', inject: ['web'], apply(inner) {
    web = inner.web
    rt = createWebSearch(inner, { live: () => cfg, resolveAccount: async () => { resolves++; return { value: 'fake-key' } } })
    inner.effect(() => () => rt.close())
  } })
  assert.equal(rt.status().registered, false)
  assert.equal(rt.provider.available(), false)
  cfg = { ...cfg, webSearchEnabled: true }; rt.sync()
  assert.equal(rt.status().registered, true)
  assert.equal(rt.provider.available(), true)
  assert.equal(resolves, 0)
  assert.equal((await web.search({ query: 'x' })).sources[0].url, 'https://other.test/')
  assert.equal(resolves, 0)
  assert.equal((await rt.provider.search({ query: 'x' })).sources.length, 3)
  await plugin.dispose()
  assert.equal(rt.status().registered, false)
  assert.equal(rt.provider.available(), false)
  assert.equal((await web.search({ query: 'x' })).sources[0].url, 'https://other.test/')
})

test('native web seam executes ClinePass results, errors, enable/disable and re-registration', async (t) => {
  const server = await fixture(t), ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(WebRuntime, { searchProvider: 'clinebot' })
  let cfg = { webSearchEnabled: true, baseUrl: server.baseUrl }, rt, web
  await ctx.plugin({ name: 'cline-native-search', inject: ['web'], apply(inner) {
    web = inner.web
    rt = createWebSearch(inner, { live: () => cfg, resolveAccount: async () => ({ value: 'fake-key' }) })
    inner.effect(() => () => rt.close())
  } })
  assert.equal((await web.search({ query: 'x', maxResults: 1 })).sources.length, 1)
  await assert.rejects(web.search({ query: 'http-429' }), { code: 'WEB_CLINE_HTTP_429' })
  cfg = { ...cfg, webSearchEnabled: false }; rt.sync()
  await assert.rejects(web.search({ query: 'x' }), { code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  cfg = { ...cfg, webSearchEnabled: true }; rt.sync()
  assert.equal((await web.search({ query: 'empty' })).sources.length, 0)
})

test('a full plugin preference save registers search after legacy settings publish their volatile event', async (t) => {
  const ctx = new Context(), routes = new Map(), docs = { 'llm-pi-ai': { providers: {} } }
  t.after(() => ctx.fiber.dispose())
  class Settings extends Service {
    constructor(inner) { super(inner, 'settings') }
    get(ns) { return docs[ns] }
    describe() { return Object.entries(docs).map(([ns, value]) => ({ ns, value })) }
    async update(ns, patch) { docs[ns] = { ...docs[ns], ...structuredClone(patch) }; this.ctx.emit('loader/volatile-update') }
    async replace(ns, section) { docs[ns] = structuredClone(section); this.ctx.emit('loader/volatile-update') }
    async mutate(ns, ops) {
      const doc = docs[ns] ||= {}
      for (const op of ops) {
        let target = doc
        for (const key of op.path.slice(0, -1)) target = target[key] ||= {}
        if (op.op === 'unset') delete target[op.path.at(-1)]
        else target[op.path.at(-1)] = structuredClone(op.value)
      }
    }
  }
  class Credentials extends Service {
    constructor(inner) { super(inner, 'credentials') }
    async resolve() { return null }
  }
  class WebServer extends Service {
    constructor(inner) { super(inner, 'webServer') }
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path) }
  }
  await ctx.plugin(Settings); await ctx.plugin(Credentials); await ctx.plugin(WebServer)
  await ctx.plugin(WebRuntime, { searchProvider: 'clinebot' })
  const plugin = await import('../lib/index.js')
  await ctx.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply }, { selectionKind: 'explicit', explicitModels: [], migrationRevision: 1, apiKeyEnv: 'CLINEBOT_API_KEY_NO_SEARCH_TEST', modelsCachePath: new URL(`../.tmp/agent/search-test-${process.pid}/models.json`, import.meta.url).pathname })
  const server = http.createServer((req, res) => routes.get(req.url)?.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  let web
  await ctx.plugin({ name: 'search-consumer', inject: ['web'], apply(inner) { web = inner.web } })
  await assert.rejects(web.search({ query: 'x' }), { code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  for (const enabled of [true, false, true]) {
    const response = await fetch(`${base}/dsh-clinebot/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ webSearchEnabled: enabled }) })
    const data = await response.json()
    assert.equal(response.status, 200, JSON.stringify(data))
    assert.equal(data.config.webSearchEnabled, enabled)
    await assert.rejects(web.search({ query: 'x' }), { code: enabled ? 'WEB_CREDENTIAL_MISSING' : 'WEB_PROVIDER_CONFIGURED_MISSING' })
  }
})
