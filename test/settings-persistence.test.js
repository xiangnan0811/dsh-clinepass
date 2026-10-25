import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { Config, parseConfig } from '../lib/config.js'
import { ownSettings } from '../lib/index.js'
import { registerSettingsRoutes } from '../lib/routes/settings.js'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const { SettingsForms } = require('@deepseek-ai/dsh-settings')
const model = 'cline-pass/deepseek-v4.1-flash'

function fixture(directEditor = false) {
  let raw = { modelContextOverrides: { [model]: 123456 }, retiredPreference: { keep: true }, migrationRevision: 1, upstreamPins: [{ model, provider: 'deepseek' }] }
  const entry = { options: { id: 'dsh-clinebot' }, fiber: { runtime: { Config } } }
  const edit = async (_entry, change) => { raw = change(structuredClone(raw), {}) }
  // Use the installed host's actual write/project/volatile-validation methods.
  const settings = Object.assign(Object.create(SettingsForms.prototype), {
    ownerContext: { configEditor: { entries: () => [entry], edit } },
    describe: () => [{ ns: 'dsh-clinebot', revision: 0 }],
  })
  const scope = ownSettings(settings, parseConfig(raw), entry.options.id, directEditor ? { edit: async (_id, change) => { await edit(entry, change); return raw } } : {})
  return { scope, read: () => raw }
}

test('settings saves with retired keys pass the native volatile form and preserve old data', async (t) => {
  const { scope, read } = fixture()
  const routes = new Map()
  registerSettingsRoutes({ effect: fn => fn(), webServer: { register: route => { routes.set(route.path, route); return () => {} } } }, {
    live: () => parseConfig(scope.get()), getSettingsApi: () => scope, syncProviderState: async () => ({ ok: true }),
  })
  const server = http.createServer((req, res) => routes.get(req.url).handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const rate = { model, inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.2, cacheWritePerMillion: 2.5 }
  for (const patch of [{ showSidebarQuota: false }, { searchTimeoutMs: 9000 }, { proxyEnabled: true }, { costRates: [rate] }]) {
    const response = await fetch(`${base}/dsh-clinebot/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(patch) })
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    for (const [key, value] of Object.entries(patch)) assert.deepEqual(body.config[key], value)
  }
  assert.deepEqual(read().costRates, [rate])
  assert.equal(read().showSidebarQuota, false)
  assert.equal(read().searchTimeoutMs, 9000)
  assert.equal(read().upstreamPins[0].provider, 'deepseek')
  assert.deepEqual(read().modelContextOverrides, { [model]: 123456 })
  assert.deepEqual(read().retiredPreference, { keep: true })
})

test('patch and derived writes isolate editable fields on both host write paths', async () => {
  for (const directEditor of [false, true]) {
    const { scope, read } = fixture(directEditor)
    await scope.update({ activeAccount: 'CLINEBOT_API_KEY_2' })
    await scope.updateDerived(current => ({ ...current, costCurrency: 'CNY' }))
    await scope.replace(parseConfig({ ...scope.get(), searchTimeoutMs: 12000 }))
    assert.equal(read().activeAccount, 'CLINEBOT_API_KEY_2')
    assert.equal(read().costCurrency, 'CNY')
    assert.equal(read().searchTimeoutMs, 12000)
    assert.equal(read().upstreamPins[0].provider, 'deepseek')
    assert.deepEqual(read().modelContextOverrides, { [model]: 123456 })
    assert.deepEqual(read().retiredPreference, { keep: true })
  }
})

test('legacy prices remain incomplete and invalid cache prices are rejected', () => {
  const rate = { model, inputPerMillion: 2, outputPerMillion: 10 }
  const legacy = parseConfig({ costRates: [rate] }).costRates[0]
  assert.equal(legacy.cacheReadPerMillion, undefined)
  assert.equal(legacy.cacheWritePerMillion, undefined)
  assert.throws(() => parseConfig({ costRates: [{ ...rate, cacheReadPerMillion: -1 }] }))
  assert.throws(() => parseConfig({ costRates: [{ ...rate, cacheWritePerMillion: 'free' }] }))
})
