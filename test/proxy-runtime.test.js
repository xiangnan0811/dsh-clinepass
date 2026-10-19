import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfig } from '../lib/config.js'
import { createProxyRuntime } from '../lib/proxy-runtime.js'
import { buildProviderPayload } from '../lib/provider-payload.js'
import { getAllModels } from '../lib/models.js'

const refName = (ref) => typeof ref === 'string' ? ref : ref.name

test('proxy transport persists no secret, disables host retries, restores controls and removes its owned credential', async () => {
  let cfg = parseConfig({ proxyEnabled: true, baseUrl: 'https://example.test/v1' })
  let provider = { ...buildProviderPayload({ baseUrl: cfg.baseUrl, apiKeyEnv: cfg.apiKeyEnv, models: getAllModels(cfg) }).payload,
    retryPolicy: { mode: 'normal', maxRetries: 3 }, timeoutMs: 9999, streamIdleTimeoutMs: 25000 }
  const original = structuredClone(provider)
  const credentials = new Map([['CLINEBOT_API_KEY', 'fake-real-account']])
  const ctx = { settings: { get: () => ({ providers: { clinebot: provider } }), async mutate(_ns, operations) {
    for (const operation of operations) {
      const field = operation.path.at(-1)
      if (operation.op === 'unset') delete provider[field]
      else provider[field] = operation.value
    }
  } }, credentials: {
    async set(ref, value) { credentials.set(refName(ref), value) },
    async unset(ref) { credentials.delete(refName(ref)) },
    async resolve(ref) { return { value: credentials.get(refName(ref)) || '' } },
  } }
  const runtime = createProxyRuntime(ctx, { live: () => cfg, persist: async (patch) => { cfg = { ...cfg, ...patch } } })
  try {
    const prepared = await runtime.prepare(cfg, provider)
    Object.assign(provider, prepared.transport.fields)
    assert.deepEqual(provider.retryPolicy, { mode: 'normal', maxRetries: 0 })
    assert.match(provider.baseURL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    const owned = provider.apiKeyEnv
    assert.ok(credentials.has(owned))
    assert.equal(JSON.stringify(cfg).includes(credentials.get(owned)), false)
    assert.equal(runtime.status().listening, true)
    cfg = { ...cfg, proxyEnabled: false }
    const direct = await runtime.prepare(cfg, provider)
    Object.assign(provider, direct.transport.fields)
    for (const field of direct.transport.unset) delete provider[field]
    await direct.finish()
    assert.deepEqual(provider, original)
    assert.equal(credentials.has(owned), false)
    assert.equal(credentials.get('CLINEBOT_API_KEY'), 'fake-real-account')
    assert.equal(cfg.proxyDirectControls, null)
    assert.equal(runtime.status().listening, false)
  } finally { await runtime.dispose() }
})

test('unloading an active proxy restores the provider before deleting its credential', async () => {
  let cfg = parseConfig({ proxyEnabled: true, baseUrl: 'https://example.test/v1' })
  let provider = buildProviderPayload({ baseUrl: cfg.baseUrl, apiKeyEnv: cfg.apiKeyEnv, models: getAllModels(cfg) }).payload
  const calls = []
  const ctx = { settings: { get: () => ({ providers: { clinebot: provider } }), async mutate(_ns, operations) {
    calls.push('restore')
    for (const op of operations) {
      const field = op.path.at(-1)
      if (op.op === 'unset') delete provider[field]
      else provider[field] = op.value
    }
  } }, credentials: { async set() { calls.push('store-secret') }, async unset() { calls.push('delete-secret') } } }
  const runtime = createProxyRuntime(ctx, { live: () => cfg, persist: async (patch) => { cfg = { ...cfg, ...patch } } })
  const prepared = await runtime.prepare(cfg, provider)
  provider = { ...provider, ...prepared.transport.fields }
  await runtime.dispose()
  assert.deepEqual(calls, ['store-secret', 'restore', 'delete-secret'])
  assert.equal(provider.baseURL, 'https://example.test/v1')
  assert.equal(provider.apiKeyEnv, 'CLINEBOT_API_KEY')
  assert.equal(provider.retryPolicy, undefined)
})
