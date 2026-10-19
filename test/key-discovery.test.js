import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import http from 'node:http'
import { Readable } from 'node:stream'
import { createKeyDiscovery } from '../lib/key-discovery.js'
import { registerKeyRoutes } from '../lib/routes/keys.js'

test('discovery limits paths, deduplicates keys, exposes handles and reports malformed files', async (t) => {
  const base = path.resolve('.tmp/agent')
  await mkdir(base, { recursive: true })
  const home = await mkdtemp(path.join(base, 'key-discovery-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const key = 'cline_fake_fixture_1234567890123456'
  await mkdir(path.join(home, '.cline'))
  await writeFile(path.join(home, '.cline/config.json'), JSON.stringify({ apiKey: key }))
  await writeFile(path.join(home, '.cline/settings.json'), '{broken')
  await writeFile(path.join(home, '.cline/unlisted-secret.json'), JSON.stringify({ apiKey: 'cline_do_not_scan_1234567890123456' }))
  let now = 1000
  const discovery = createKeyDiscovery({ home, env: { CLINE_API_KEY: key }, ttlMs: 10, now: () => now })
  const found = await discovery.discover()
  assert.equal(found.keys.length, 1)
  assert.equal(found.keys[0].sources.length, 2)
  assert.equal(JSON.stringify(found).includes(key), false)
  assert.equal(found.sources.find((source) => source.path.endsWith('.cline/settings.json')).status, 'invalid-json')
  assert.equal(discovery.resolve(found.keys[0].id), key)
  now = 1010
  assert.throws(() => discovery.resolve(found.keys[0].id), /expired/)
  const again = await discovery.discover()
  assert.notEqual(again.keys[0].id, found.keys[0].id)
  discovery.clear()
  assert.throws(() => discovery.resolve(again.keys[0].id), /expired/)
})

test('independent key validation uses the selected API without touching credentials or settings', async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-validation-key')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url.endsWith('/usage-limits') ? { limits: [] } : req.url.endsWith('/plan') ? { plan: { name: 'Fixture', includedModels: ['DeepSeek V4.1 Flash'] } } : { email: 'fixture@example.test' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  const routes = new Map()
  const ctx = {
    effect(fn) { fn() },
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
    credentials: { set() { assert.fail('validation wrote credentials') } },
    settings: { update() { assert.fail('validation wrote settings') } },
  }
  registerKeyRoutes(ctx, { live: () => ({ baseUrl: `http://127.0.0.1:${server.address().port}` }) })
  const req = Readable.from([Buffer.from(JSON.stringify({ apiKey: 'fixture-validation-key' }))])
  Object.assign(req, { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost' }, socket: { remoteAddress: '127.0.0.1' } })
  let status, body
  await routes.get('/dsh-clinebot/keys/validate').handler(req, { writeHead(value) { status = value }, end(value) { body = JSON.parse(value) } })
  assert.equal(status, 200)
  assert.equal(body.validated, true)
  assert.equal(JSON.stringify(body).includes('fixture-validation-key'), false)
})
