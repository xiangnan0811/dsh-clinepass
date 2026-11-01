import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { Readable } from 'node:stream'
import { isSafeDataPath, dshHome } from '../lib/path-safety.js'
import { registerSettingsRoutes } from '../lib/routes/settings.js'

test('path-safety: isSafeDataPath basic validation', () => {
  const home = '/fake/home'
  const env = { DSH_HOME: '/fake/home/.dsh' }
  const base = dshHome(env, home)
  assert.equal(base, path.resolve('/fake/home/.dsh'))

  // Empty / nullish is allowed (default value takes over)
  assert.equal(isSafeDataPath('', env, home), true)
  assert.equal(isSafeDataPath(null, env, home), true)
  assert.equal(isSafeDataPath(undefined, env, home), true)

  // Null bytes rejected
  assert.equal(isSafeDataPath('/fake/home/.dsh/test\0.json', env, home), false)

  // Outside DSH_HOME rejected
  assert.equal(isSafeDataPath('/etc/passwd', env, home), false)
  assert.equal(isSafeDataPath('/fake/home/something.json', env, home), false)
  assert.equal(isSafeDataPath('~/something.json', env, home), false)
  assert.equal(isSafeDataPath(path.join(base, '..', 'outside.json'), env, home), false)

  // Directory itself rejected
  assert.equal(isSafeDataPath(base, env, home), false)
  assert.equal(isSafeDataPath('~', env, home), false)

  // Non-JSON extensions rejected
  assert.equal(isSafeDataPath(path.join(base, 'test.txt'), env, home), false)
  assert.equal(isSafeDataPath(path.join(base, 'settings.yaml'), env, home), false)
  assert.equal(isSafeDataPath(path.join(base, 'data.csv'), env, home), false)

  // Forbidden filenames rejected
  for (const forbidden of ['package.json', 'package-lock.json', 'tsconfig.json', 'settings.json', '.credentials.json', 'settings.yaml', 'settings.yml']) {
    assert.equal(isSafeDataPath(path.join(base, forbidden), env, home), false)
    assert.equal(isSafeDataPath(`~/.dsh/${forbidden}`, env, home), false)
  }

  // Profile protection: must start with clinebot-
  assert.equal(isSafeDataPath(path.join(base, 'profiles', 'web', 'other.json'), env, home), false)
  assert.equal(isSafeDataPath(path.join(base, 'profiles', 'web', 'package.json'), env, home), false)
  assert.equal(isSafeDataPath(path.join(base, 'profiles', 'web', 'clinebot-cache.json'), env, home), true)

  // Safe JSON files inside DSH_HOME accepted
  assert.equal(isSafeDataPath(path.join(base, 'clinebot-models-cache.json'), env, home), true)
  assert.equal(isSafeDataPath(path.join(base, 'cache.json'), env, home), true)
  assert.equal(isSafeDataPath('~/.dsh/custom-cache.json', env, home), true)
})

test('path-safety: settings PUT /config rejects unsafe modelsCachePath', async () => {
  const routes = new Map()
  let saved = null
  const scope = {
    get: () => ({ enabled: true }),
    replace: async (val) => { saved = val },
  }
  registerSettingsRoutes({ effect: fn => fn(), webServer: { register: route => { routes.set(route.path, route); return () => {} } } }, {
    live: () => ({ enabled: true }),
    getSettingsApi: () => scope,
    syncProviderState: async () => ({ ok: true }),
  })
  const route = routes.get('/dsh-clinebot/config')
  assert.ok(route)

  const makeReqRes = (body) => {
    const payload = Buffer.from(JSON.stringify(body))
    const req = new Readable({
      read() {
        this.push(payload)
        this.push(null)
      },
    })
    req.method = 'PUT'
    req.headers = {
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
    }
    req.socket = { remoteAddress: '127.0.0.1' }

    let statusCode = 200
    let resData = ''
    const res = {
      writeHead(code, headers) { statusCode = code },
      end(chunk) { if (chunk) resData += chunk },
    }
    return { req, res, getStatus: () => statusCode, getBody: () => JSON.parse(resData) }
  }

  // Reject unsafe path
  const bad = makeReqRes({ modelsCachePath: '/etc/passwd' })
  await route.handler(bad.req, bad.res)
  assert.equal(bad.getStatus(), 400)
  assert.match(bad.getBody().error, /modelsCachePath/)

  // Accept safe path
  const safe = makeReqRes({ modelsCachePath: '~/.dsh/safe-cache.json' })
  await route.handler(safe.req, safe.res)
  assert.equal(safe.getStatus(), 200)
  assert.equal(safe.getBody().ok, true)
})
