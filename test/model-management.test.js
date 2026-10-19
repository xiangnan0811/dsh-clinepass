import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { Config, publicConfig } from '../lib/config.js'
import { getAllModels, selectedIds, clearPlanDiscovery, migrateConfig } from '../lib/models.js'
import { applyModelManagement } from '../lib/model-management.js'
import { buildProviderPayload } from '../lib/provider-payload.js'
import { upsertPiAiProvider, noteUserWrite } from '../lib/provider-sync.js'
import { registerModelsRoutes } from '../lib/routes/models.js'
import { fetchUsageLimits, catalogChange, catalogIdentity } from '../lib/cline-client.js'
import { preserveHostModelEdits, retainedHostFields, hostFieldsToReset, captureHostEdits, applyStoredHostEdits } from '../lib/host-model-edits.js'

const id = 'cline-pass/deepseek-v4.1-flash'

test('plan filtering intersects selections only after success and preserves explicit none', () => {
  const cfg = Config({ planFilterEnabled: true, selectionKind: 'explicit', explicitModels: [id] })
  const models = getAllModels(cfg)
  assert.deepEqual(selectedIds(models, cfg), [id])
  assert.deepEqual(selectedIds(models, { ...cfg, planVerified: true }), [])
  const verified = { ...cfg, planVerified: true, discoveredPlanIds: [id] }
  assert.deepEqual(selectedIds(models, verified), [id])
  const none = applyModelManagement(verified, { selectionAction: 'none' })
  assert.deepEqual(selectedIds(models, none), [])
  assert.deepEqual(none.discoveredPlanIds, [id])
  assert.equal(clearPlanDiscovery(verified).planVerified, false)
  const emptyPlan = { ...verified, discoveredPlanIds: [] }
  const switched = catalogChange(catalogIdentity(emptyPlan), { ...emptyPlan, activeAccount: 'CLINEBOT_API_KEY_2' })
  assert.equal(switched.reset, true)
  assert.equal(switched.config.planVerified, false)
  assert.deepEqual(selectedIds(models, clearPlanDiscovery(verified)), [id])
  assert.throws(() => applyModelManagement(cfg, { selectionAction: 'plan' }), /verified plan/)
})

test('host edits persist before hiding all models and restore under a fresh sync context', async () => {
  let provider
  let cfg = Config({})
  const settings = { get: () => ({ providers: provider ? { clinebot: provider } : {} }), async mutate(_ns, ops) {
    for (const op of ops) provider = op.op === 'unset' ? undefined : structuredClone(op.value)
  } }
  const ctx = { settings }
  const persistHostEdits = async (rows) => { cfg = { ...cfg, hostModelOverrides: rows } }
  await upsertPiAiProvider(ctx, cfg, undefined, { persistHostEdits })
  provider.models.find((model) => model.id === id).maxTokens = 2048
  cfg = { ...cfg, selectionKind: 'explicit', explicitModels: [] }
  await upsertPiAiProvider(ctx, cfg, undefined, { persistHostEdits })
  assert.equal(provider, undefined)
  assert.equal(cfg.hostModelOverrides.find((row) => row.id === id).values.maxTokens, 2048)
  cfg = JSON.parse(JSON.stringify({ ...cfg, explicitModels: [id] }))
  await upsertPiAiProvider({ settings }, cfg, undefined, { persistHostEdits })
  assert.equal(provider.models[0].maxTokens, 2048)
  assert.equal(getAllModels(cfg).find((model) => model.id === id).requestOutputBudget, 2048)
})

test('a usage read without plan metadata cannot verify an empty plan', async () => {
  const usage = await fetchUsageLimits('https://example.test/no-plan', 'fake-key', {
    remember: false,
    fetchImpl: async (url) => new Response(JSON.stringify(url.endsWith('/usage-limits') ? { limits: [] } : { error: 'unavailable' }), { status: url.endsWith('/usage-limits') ? 200 : 503 }),
  })
  assert.equal(usage.ok, true)
  assert.equal(usage.planModelsVerified, false)
  const missingPercent = await fetchUsageLimits('https://example.test/unknown', 'fake-key', {
    remember: false,
    fetchImpl: async () => new Response(JSON.stringify({ limits: [{ type: '5-hour' }] })),
  })
  assert.equal(missingPercent.windows.fiveHour.percentUsed, null)
  assert.equal(missingPercent.windows.fiveHour.remainingPercent, null)
  const malformed = await fetchUsageLimits('https://example.test/malformed', 'fake-key', {
    remember: false, fetchImpl: async () => new Response('<html>not JSON'),
  })
  assert.equal(malformed.ok, false)
})

test('manual plan sync refuses a result after the active account changes', async (t) => {
  let release, started
  const began = new Promise((resolve) => { started = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  const server = http.createServer(async (req, res) => {
    if (req.url.endsWith('/usage-limits')) { started(); await gate }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url.endsWith('/usage-limits') ? { limits: [] } : req.url.endsWith('/plan') ? { includedModels: ['DeepSeek V4.1 Flash'] } : {}))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  let cfg = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKeyEnv: 'CLINEBOT_API_KEY' }
  const routes = new Map()
  const forbidden = () => assert.fail('stale discovery wrote settings')
  registerModelsRoutes({
    effect(fn) { fn() }, credentials: { async resolve() { return { value: 'fixture-key' } } },
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
  }, { live: () => cfg, getSettingsApi: () => ({ replace: forbidden, update: forbidden }), syncProviderState: forbidden })
  const req = { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost' }, socket: { remoteAddress: '127.0.0.1' } }
  let status
  const pending = routes.get('/dsh-clinebot/models/sync').handler(req, { writeHead(code) { status = code }, end() {} })
  await began
  cfg = { ...cfg, activeAccount: 'CLINEBOT_API_KEY_2', discoveredPlanIds: [] }
  noteUserWrite()
  release()
  await pending
  assert.equal(status, 409)
  assert.deepEqual(cfg.discoveredPlanIds, [])
})

test('single model overrides beat batch defaults and restoring capability leaves budget intact', () => {
  let cfg = applyModelManagement(Config({}), { batchModelDefaults: { contextWindow: 123000, outputCapability: 8000 } })
  cfg = applyModelManagement(cfg, { modelOverride: { id, contextWindow: 64000, requestOutputBudget: 4096 } })
  let model = getAllModels(cfg).find((model) => model.id === id)
  assert.equal(model.contextWindow, 64000)
  assert.equal(model.outputCapability, 8000)
  assert.equal(model.requestOutputBudget, 4096)
  cfg = applyModelManagement(cfg, { restoreModelCapabilities: id })
  model = getAllModels(cfg).find((model) => model.id === id)
  assert.equal(model.contextWindow, 123000)
  assert.equal(model.requestOutputBudget, 4096)
  cfg = applyModelManagement(cfg, { batchModelDefaults: { contextWindow: 'inherit', outputCapability: 'inherit' } })
  assert.notEqual(getAllModels(cfg).find((model) => model.id === id).contextWindow, 123000)
})

test('custom model creation, rename, parameter update and deletion do not invent capability', () => {
  let cfg = applyModelManagement(Config({}), { customModel: { id: 'custom/test', name: 'Test' } })
  let model = getAllModels(cfg).find((model) => model.id === 'custom/test')
  assert.equal(model.contextKnown, false)
  assert.deepEqual(model.input, ['text'])
  assert.equal(model.reasoningEfforts, false)
  cfg = applyModelManagement(cfg, { customModel: { id: 'custom/test', name: 'Renamed', parameters: { contextWindow: 1000 } } })
  model = getAllModels(cfg).find((model) => model.id === 'custom/test')
  assert.equal(model.name, 'Renamed')
  assert.equal(model.contextWindow, 1000)
  cfg = applyModelManagement(cfg, { deleteCustomModel: 'custom/test' })
  assert.equal(getAllModels(cfg).some((model) => model.id === 'custom/test'), false)
  assert.equal(cfg.modelOverrides.length, 0)
  assert.throws(() => applyModelManagement(cfg, { customModel: { id } }), /catalog model/)
  assert.throws(() => applyModelManagement(cfg, { batchModelDefaults: { contextWindow: -1 } }), /positive integer/)
})

test('selection cleanup drops only absent ids and migration retains new configuration', () => {
  const original = { migrationRevision: 1, selectionKind: 'explicit', explicitModels: [id, 'gone'], disabledModels: ['gone'], planFilterEnabled: true, batchModelDefaults: { contextWindow: 2000 } }
  const cleaned = applyModelManagement(original, { selectionAction: 'clean' })
  assert.deepEqual(cleaned.explicitModels, [id])
  assert.deepEqual(cleaned.disabledModels, [])
  assert.equal(cleaned.planFilterEnabled, true)
  const migrated = migrateConfig(cleaned).config
  assert.deepEqual(migrateConfig(migrated).config, migrated)
  assert.equal(publicConfig(Config(migrated)).batchModelDefaults.contextWindow, 2000)
})

test('host model edits survive repeated sync and restart; explicit plugin edits and restore win', () => {
  const cfg = Config({})
  const configured = buildProviderPayload({ baseUrl: 'https://example.test', apiKeyEnv: 'CLINEBOT_API_KEY', models: getAllModels(cfg) }).payload
  const previous = { payload: configured, config: cfg, hostFields: {} }
  const edited = structuredClone(configured)
  edited.models.find((model) => model.id === id).maxTokens = 2000
  let payload = preserveHostModelEdits(configured, edited, previous, cfg)
  assert.equal(payload.models.find((model) => model.id === id).maxTokens, 2000)
  payload = preserveHostModelEdits(configured, payload, { payload, config: cfg, hostFields: retainedHostFields(payload, configured) }, cfg)
  assert.equal(payload.models.find((model) => model.id === id).maxTokens, 2000)
  assert.equal(preserveHostModelEdits(configured, payload, undefined, cfg).models.find((model) => model.id === id).maxTokens, 2000)
  const manualLegacySized = structuredClone(edited)
  Object.assign(manualLegacySized.models.find((model) => model.id === id), { contextWindow: 200000, maxTokens: 8192 })
  const restoredLegacySized = preserveHostModelEdits(configured, manualLegacySized, undefined, cfg).models.find((model) => model.id === id)
  assert.equal(restoredLegacySized.contextWindow, 200000)
  assert.equal(restoredLegacySized.maxTokens, 8192)
  const next = applyModelManagement(cfg, { modelOverride: { id, requestOutputBudget: 4000 } })
  const updated = buildProviderPayload({ models: getAllModels(next) }).payload
  assert.equal(preserveHostModelEdits(updated, edited, previous, next).models.find((model) => model.id === id).maxTokens, 4000)
  const reset = hostFieldsToReset({ modelOverride: { id, requestOutputBudget: 'inherit' } })
  assert.equal(preserveHostModelEdits(configured, edited, previous, cfg, reset).models.find((model) => model.id === id).maxTokens, 65536)
  const stored = captureHostEdits(edited, configured)
  assert.equal(applyStoredHostEdits(configured, stored).models.find((model) => model.id === id).maxTokens, 2000)
  const afterRestart = Config(JSON.parse(JSON.stringify({ ...cfg, hostModelOverrides: stored, selectionKind: 'explicit', explicitModels: [] })))
  assert.equal(getAllModels(afterRestart).find((model) => model.id === id).requestOutputBudget, 2000)
  const restored = applyModelManagement(afterRestart, { modelOverride: { id, requestOutputBudget: 'inherit' } })
  assert.equal(restored.hostModelOverrides.length, 0)
})
