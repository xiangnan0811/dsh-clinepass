import assert from 'node:assert/strict'
import test from 'node:test'
import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../lib/access.js'
import { registerSettingsRoutes } from '../lib/routes/settings.js'
import { registerAccountsRoutes } from '../lib/routes/accounts.js'
import { registerModelsRoutes } from '../lib/routes/models.js'
import { registerAuthRoutes } from '../lib/routes/auth.js'
import { registerKeyRoutes } from '../lib/routes/keys.js'
import { registerProxyControls } from '../lib/routes/proxy.js'
import { registerNativeModelRoutes } from '../lib/routes/native-models.js'
import { registerStatsRoutes } from '../lib/routes/stats.js'
import { registerProbeRoutes } from '../lib/routes/probe.js'
import { registerPluginUpdater } from '../lib/updater.js'

function response() {
  return {
    writeHead(status) { this.status = status },
    end(body) { this.body = JSON.parse(body) },
  }
}

test('every plugin route refuses unauthenticated requests before reading or changing state', async () => {
  const routes = []
  let rejection = 401
  let admissions = 0
  const ctx = {
    get(name) {
      assert.equal(name, 'connection')
      return { requestRejection() { admissions++; return rejection } }
    },
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(fn) { fn() },
  }
  const forbidden = () => { assert.fail('unauthenticated handler reached plugin state') }
  const deps = { live: forbidden, getSettingsApi: forbidden, syncProviderState: forbidden, triggerAutoDiscover: forbidden }
  for (const register of [registerSettingsRoutes, registerAccountsRoutes, registerModelsRoutes, registerAuthRoutes, registerKeyRoutes, registerProxyControls, registerNativeModelRoutes, registerStatsRoutes, registerProbeRoutes]) register(ctx, deps)
  registerPluginUpdater(ctx, { endpoint: '/dsh-clinebot/update', manifestUrl: new URL('../package.json', import.meta.url) })
  assert.equal(routes.length, 26)
  const req = { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost' }, socket: { remoteAddress: '127.0.0.1' } }
  for (const code of [401, 403]) {
    rejection = code
    for (const route of routes) {
      const res = response()
      await route.handler(req, res)
      assert.equal(res.status, code, route.path)
      assert.equal(res.body.ok, false)
    }
  }
  assert.equal(admissions, 52)
})

test('admitted requests retain CSRF checks and legacy hosts retain their origin gate', async () => {
  for (const connection of [undefined, { requestRejection: () => undefined }]) {
    let route
    let writes = 0
    const off = () => {}
    const ctx = { connection, webServer: { register(value) { route = value; return off } } }
    assert.equal(registerAuthenticatedRoute(ctx, {
      path: '/test',
      handler(req, res) {
        if (!assertTrustedSettingsRequest(req, res)) return
        writes++
      },
    }), off)
    const req = { headers: { host: 'localhost', origin: 'http://localhost' }, socket: { remoteAddress: '127.0.0.1' } }
    await route.handler(req, response())
    assert.equal(writes, 1)
    const res = response()
    await route.handler({ ...req, headers: { ...req.headers, 'sec-fetch-site': 'cross-site' } }, res)
    assert.equal(res.status, 403)
    assert.equal(writes, 1)
  }
})

test('host authentication errors fail closed', async () => {
  let route
  registerAuthenticatedRoute({
    connection: { requestRejection() { throw new Error('closed') } },
    webServer: { register(value) { route = value } },
  }, { handler() { assert.fail('authentication failure must stop the handler') } })
  const res = response()
  await route.handler({}, res)
  assert.equal(res.status, 403)
})
