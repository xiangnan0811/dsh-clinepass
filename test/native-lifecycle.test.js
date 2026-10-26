import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createNativeLifecycle } from '../lib/native-lifecycle.js'
import { registerAuthenticatedRoute } from '../lib/access.js'
import { createProxyRuntime } from '../lib/proxy-runtime.js'
import { parseConfig } from '../lib/config.js'
import { getAllModels } from '../lib/models.js'
import { buildProviderPayload } from '../lib/provider-payload.js'
import { apply } from '../lib/index.js'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const nativePi = require('@deepseek-ai/dsh-llm-pi-ai')

function host(t) {
  const execution = new AsyncLocalStorage(), cleanups = [], writes = []
  let operations = Promise.resolve()
  const hmr = {
    runExclusive(operation) {
      if (execution.getStore()) return Promise.reject(new Error('HMR transactions cannot be nested'))
      const task = operations.then(() => execution.run(true, operation))
      operations = task.catch(() => {})
      return task
    },
  }
  const values = { 'dsh-clinebot': {}, 'llm-pi-ai': { providers: { foreign: { apiKeyEnv: 'FOREIGN_REF' } } } }
  const entries = Object.keys(values).map(id => ({ options: { id } }))
  const editor = {
    entries: () => entries,
    edit(entry, change) {
      return hmr.runExclusive(async () => {
        const id = entry.options.id
        values[id] = change(structuredClone(values[id]), {})
        writes.push(id)
      })
    },
  }
  const root = { effect(run) { cleanups.push(run()) } }
  const ctx = { root, get: name => ({ hmr, configEditor: editor })[name] }
  t.after(async () => { for (const cleanup of cleanups) await cleanup() })
  return { ctx, hmr, values, writes, execution }
}

test('native lifecycle crosses HMR through the host queue and restores only the released owner', { timeout: 3000 }, async t => {
  const { ctx, hmr, values, execution } = host(t)
  const old = createNativeLifecycle(ctx)
  await old.initialize(() => old.edit('dsh-clinebot', current => ({ ...current, generation: 1 })))
  let next, initialized, oldRestore
  await hmr.runExclusive(async () => {
    old.release()
    oldRestore = old.restore({ apiKeyEnv: 'CLINEBOT_API_KEY', models: [] }).then(() => null, error => error)
    next = createNativeLifecycle(ctx)
    initialized = next.initialize(async () => {
      assert.equal(execution.getStore(), undefined)
      await next.edit('dsh-clinebot', current => ({ ...current, generation: 2 }))
    })
  })
  await initialized
  assert.equal((await oldRestore).name, 'AbortError')
  assert.equal(values['llm-pi-ai'].providers.clinebot, undefined)
  assert.equal(values['dsh-clinebot'].generation, 2)
  let restored
  const profile = { apiKeyEnv: 'CLINEBOT_API_KEY', baseURL: 'https://example.test/v1', models: [{ id: 'kept' }] }
  await hmr.runExclusive(async () => { next.release(); restored = next.restore(profile) })
  await restored
  assert.deepEqual(values['llm-pi-ai'].providers.clinebot, profile)
  assert.deepEqual(values['llm-pi-ai'].providers.foreign, { apiKeyEnv: 'FOREIGN_REF' })
})

test('restored profile is raw configuration accepted by the native provider schema', { timeout: 3000 }, async t => {
  const { ctx, values } = host(t)
  const lifecycle = createNativeLifecycle(ctx)
  const profile = buildProviderPayload({ baseUrl: 'https://example.test/v1', apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels({}) }).payload
  const parsed = parseConfig({ nativeProvider: profile }).nativeProvider
  lifecycle.release()
  await lifecycle.restore(parsed)
  assert.doesNotThrow(() => nativePi.Config({ providers: values['llm-pi-ai'].providers }))
  assert.deepEqual(JSON.parse(JSON.stringify(values['llm-pi-ai'].providers.clinebot)), JSON.parse(JSON.stringify(parsed)))
})

test('authenticated HTTP bootstraps a first live install without admitting unauthenticated work', { timeout: 3000 }, async t => {
  const { ctx, hmr, values } = host(t)
  let route, initialized
  ctx.webServer = { register(value) { route = value; return () => {} } }
  const get = ctx.get
  ctx.get = name => name === 'connection' ? { requestRejection: req => req.headers['x-fixture-auth'] ? undefined : 401 } : get(name)
  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  await hmr.runExclusive(async () => {
    const lifecycle = createNativeLifecycle(ctx)
    initialized = lifecycle.initialize(() => lifecycle.edit('dsh-clinebot', current => ({ ...current, ready: true })))
    registerAuthenticatedRoute(ctx, { handler(_req, res) { res.end(JSON.stringify(values['dsh-clinebot'])) } })
  })
  const url = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(url)).status, 401)
  assert.equal(values['dsh-clinebot'].ready, undefined)
  const response = await fetch(url, { headers: { 'x-fixture-auth': '1' } })
  assert.equal((await response.json()).ready, true)
  await initialized
})

test('a released instance cannot commit a queued write or overwrite a foreign provider', { timeout: 3000 }, async t => {
  const { ctx, hmr, values, writes } = host(t)
  const lifecycle = createNativeLifecycle(ctx)
  await lifecycle.initialize(() => lifecycle.edit('dsh-clinebot', current => ({ ...current, kept: true })))
  let rejected, restored
  await hmr.runExclusive(async () => {
    rejected = lifecycle.edit('dsh-clinebot', () => ({ stale: true })).then(() => null, error => error)
    lifecycle.release()
    values['llm-pi-ai'].providers.clinebot = { apiKeyEnv: 'USER_NEW_REF' }
    restored = lifecycle.restore({ apiKeyEnv: 'STALE_REF' }).then(() => null, error => error)
  })
  assert.equal((await rejected).name, 'AbortError')
  assert.equal((await restored).name, 'AbortError')
  assert.deepEqual(values['dsh-clinebot'], { kept: true })
  assert.deepEqual(values['llm-pi-ai'].providers.clinebot, { apiKeyEnv: 'USER_NEW_REF' })
  assert.deepEqual(writes, ['dsh-clinebot'])
})

test('cold hosts without HMR wait for initialization before admitting authenticated requests', { timeout: 3000 }, async t => {
  let route, release, arrived, ready = false, invoked = 0
  const blocked = new Promise(resolve => { release = resolve })
  const requested = new Promise(resolve => { arrived = resolve })
  const ctx = {
    root: {},
    get: name => name === 'connection' ? { requestRejection() { arrived(); return undefined } } : undefined,
    webServer: { register(value) { route = value; return () => {} } },
  }
  const lifecycle = createNativeLifecycle(ctx)
  const initialized = lifecycle.initialize(async () => { await blocked; ready = true })
  registerAuthenticatedRoute(ctx, { handler(_req, res) { invoked++; res.end(JSON.stringify({ ready })) } })
  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { release(); lifecycle.release(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const response = fetch(`http://127.0.0.1:${server.address().port}`)
  await requested
  assert.equal(invoked, 0)
  release(); await initialized
  assert.deepEqual(await (await response).json(), { ready: true })
  assert.equal(invoked, 1)
})

test('disconnect during native initialization does not run the abandoned request handler', { timeout: 3000 }, async t => {
  const { ctx, hmr, values } = host(t)
  let route, initialized, entered, release, closed, invoked = 0
  const started = new Promise(resolve => { entered = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const disconnected = new Promise(resolve => { closed = resolve })
  const get = ctx.get
  ctx.get = name => name === 'connection' ? { requestRejection: () => undefined } : get(name)
  ctx.webServer = { register(value) { route = value; return () => {} } }
  const server = http.createServer((req, res) => { res.once('close', closed); route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { release(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  await hmr.runExclusive(async () => {
    const lifecycle = createNativeLifecycle(ctx)
    initialized = lifecycle.initialize(async () => { entered(); await blocked; await lifecycle.edit('dsh-clinebot', current => ({ ...current, ready: true })) })
    registerAuthenticatedRoute(ctx, { handler(_req, res) { invoked++; res.end('unexpected') } })
  })
  const controller = new AbortController()
  const request = fetch(`http://127.0.0.1:${server.address().port}`, { signal: controller.signal })
  const rejected = assert.rejects(request, { name: 'AbortError' })
  await started
  controller.abort(); await rejected; await disconnected
  release(); await initialized
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(values['dsh-clinebot'].ready, true)
  assert.equal(invoked, 0)
})

test('proxy disposal during a pending credential write closes the late socket and removes its key', { timeout: 3000 }, async () => {
  let entered, release, ref
  const started = new Promise(resolve => { entered = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const values = new Map()
  const credentials = {
    async set(name, value) { ref = name; values.set(name, value); entered(); await blocked },
    async unset(name) { values.delete(name) },
  }
  const cfg = parseConfig({ proxyEnabled: true, proxyDirectControls: {} })
  const settings = { get: () => ({ providers: {} }), mutate() { throw new Error('No provider restoration should be needed') } }
  const runtime = createProxyRuntime({ settings, credentials }, { live: () => cfg, persist() { throw new Error('Controls already captured') } })
  const prepared = runtime.prepare(cfg)
  const rejection = assert.rejects(prepared, { name: 'AbortError' })
  await started
  await runtime.dispose()
  release(); await rejection
  assert.equal(values.size, 0)
  assert.equal(runtime.status().listening, false)
  const port = ref.slice('CLINEBOT_PROXY_KEY_'.length)
  await assert.rejects(fetch(`http://127.0.0.1:${port}/v1/chat/completions`))
})

test('a failed provider synchronization remains visible in the full plugin status', { timeout: 3000 }, async t => {
  const scratch = new URL('../.tmp/agent/', import.meta.url)
  await mkdir(scratch, { recursive: true })
  const dir = await mkdtemp(join(scratch.pathname, 'sync-failure-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const cleanups = []
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"limits":[]}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const cfg = parseConfig({ migrationRevision: 1, selectionKind: 'explicit', explicitModels: ['cline-pass/deepseek-v4.1-flash'], baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelsCachePath: join(dir, 'models.json') })
  const settings = {
    register() { return { get: () => cfg, watch: () => () => {} } },
    get: () => ({ providers: {} }),
    mutate() { throw new Error('Fixture provider configuration is locked') },
  }
  const ctx = {
    settings, credentials: { resolve: async () => ({ value: 'fake-lifecycle-test' }) },
    get(name) { return this[name] },
    inject(names, fn) { if (names.every(name => this[name])) fn(this) },
    effect(run) { const cleanup = run(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  const api = apply(ctx, cfg)
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup() })
  await api.registerProvider()
  const status = await api.getStatus()
  assert.equal(status.sync.ok, false)
  assert.equal(status.sync.error, 'Fixture provider configuration is locked')
})
