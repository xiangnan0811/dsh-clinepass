import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { Config } from '../lib/config.js'
import {
  getAllModels,
  mergeDiscovered,
  migrateConfig,
  parsePlanIncludedModels,
  selectedIds,
  upsertOverride,
} from '../lib/models.js'
import { buildProviderPayload } from '../lib/provider-payload.js'
import { activeCredentialEnv } from '../lib/account-pool.js'
import { buildPiAiProvider, explainCredentialWriteError, fetchUsageLimits, smokeChat, smokeRequestBody } from '../lib/cline-client.js'
import { migrateStoredConfig, noteUserWrite } from '../lib/provider-sync.js'
import { loadModelsDiskCache, resolveModelsCachePath, saveModelsDiskCache } from '../lib/model-cache.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PLAN = 'Includes Kimi K3, GLM 5.2, DeepSeek V4.1 Flash, and DeepSeek V4 Flash.'

test('plan names keep decimal points and use the alias table', () => {
  const found = parsePlanIncludedModels(PLAN)
  const ids = found.map((model) => model.id)
  assert.deepEqual(ids, [
    'cline-pass/kimi-k3',
    'cline-pass/glm-5.2',
    'cline-pass/deepseek-v4.1-flash',
    'cline-pass/deepseek-v4-flash',
  ])
  const flash = found.find((model) => model.id === 'cline-pass/deepseek-v4.1-flash')
  assert.equal(flash.known, true)
  assert.equal(flash.input, undefined)
})

test('plan models that the API already returned are in the maintained catalog', () => {
  const models = getAllModels({})
  const glm = models.find((model) => model.id === 'cline-pass/glm-5.3-flash')
  const muse = models.find((model) => model.id === 'cline-pass/muse-spark-1.3-contributor')
  assert.equal(glm.channelListed, true)
  assert.equal(glm.contextWindow, 1_000_000)
  assert.equal(glm.outputCapability, 131_072)
  assert.equal(glm.input.includes('image'), false)
  assert.equal(glm.vendorReasoningAvailable, true)
  assert.equal(glm.reasoningEfforts.low, 'low')
  assert.equal(glm.reasoningEfforts.max, 'max')
  assert.equal(muse.channelListed, true)
  assert.equal(muse.contextWindow, 1_048_576)
  assert.equal(muse.outputCapability, 943_718)
  assert.equal(muse.input.includes('image'), true)
  assert.equal(muse.vendorReasoningAvailable, true)
  assert.deepEqual(muse.catalogReasoningLevels, ['minimal', 'low', 'medium', 'high', 'xhigh'])
  assert.equal(muse.reasoningEfforts.xhigh, 'xhigh')
  assert.equal(muse.reasoningEfforts.max, undefined)
  assert.equal(muse.reasoningEfforts.off, undefined)
  const musePayload = buildProviderPayload({
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKeyEnv: 'CLINEBOT_API_KEY',
    models: [muse],
    displayName: 'ClineBot (ClinePass)',
  }).payload.models[0]
  assert.equal(musePayload.reasoningEfforts.minimal, 'minimal')
  assert.equal(musePayload.reasoningEfforts.max, undefined)
  assert.equal(musePayload.compat.supportsReasoningEffort, true)
  const museOff = getAllModels({
    modelOverrides: [{ id: muse.id, reasoningMode: 'off' }],
  }).find((model) => model.id === muse.id)
  assert.equal(museOff.reasoningEfforts, false)
})

test('usage limits keep monthly and smoke chat uses the configured API', async () => {
  const usage = await fetchUsageLimits('https://api.cline.bot/api/v1', `quota-${Date.now()}`, {
    bypassCache: true,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/users/me/plan/usage-limits')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              limits: [
                { type: '5-hour', percentUsed: 0, resetsAt: '2026-09-24T12:00:00Z' },
                { type: 'weekly', percentUsed: 39, resetsAt: '2026-09-25T07:06:10Z' },
                { type: 'monthly', percentUsed: 19, resetsAt: '2026-10-18T07:06:10Z' },
              ],
            },
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
    },
  })
  assert.equal(usage.windows.fiveHour.percentUsed, 0)
  assert.equal(usage.windows.weekly.percentUsed, 39)
  assert.equal(usage.windows.monthly.percentUsed, 19)

  let called = ''
  const smoke = await smokeChat('https://api.cline.bot/api/v1', 'test-key', {
    model: 'cline-pass/deepseek-v4-flash',
    fetchImpl: async (url) => {
      called = String(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'pong' } }], usage: {} }),
      }
    },
  })
  assert.equal(called, 'https://api.cline.bot/api/v1/chat/completions')
  assert.equal(smoke.upstream, called)
  assert.equal(smoke.preview, 'pong')
  const flashBody = smokeRequestBody('cline-pass/deepseek-v4.1-flash')
  assert.equal(flashBody.reasoning_effort, undefined)
  assert.equal(flashBody.max_tokens, 256)
  const museBody = smokeRequestBody('cline-pass/muse-spark-1.3-contributor')
  assert.equal(museBody.reasoning_effort, 'low')
  assert.equal(museBody.max_tokens, 1024)
  assert.equal(museBody.stream, false)
})

test('v4.1 flash is a standard ClinePass id even though the docs table omits it', () => {
  const model = getAllModels({}).find((item) => item.id === 'cline-pass/deepseek-v4.1-flash')
  assert.equal(model.channelListed, true)
  assert.match(model.note, /2026-09-23/)
  assert.equal(/third-party|not in the Cline/i.test(model.note), false)
})

test('historical parser stripped the version dot', () => {
  const old = execFileSync('git', ['show', '14314f83:lib/models.js'], { encoding: 'utf8' })
  const start = old.indexOf('export const CLINE_MODELS')
  const end = old.indexOf('export function getAllModels')
  const source = old.slice(start, end).replace(/^export /gm, '')
  const fn = new Function(`${source}\nreturn parsePlanIncludedModels`)()
  const legacy = fn(PLAN).map((model) => model.id)
  assert.ok(legacy.includes('cline-pass/deepseek-v41-flash'))
  assert.equal(parsePlanIncludedModels(PLAN).some((model) => model.id.includes('v41')), false)
})

test('unknown plan models do not inherit image or reasoning', () => {
  const found = parsePlanIncludedModels('Includes Some Brand New Model')
  assert.equal(found[0].id, 'cline-pass/some-brand-new-model')
  assert.equal(found[0].known, false)
  assert.deepEqual(found[0].input, ['text'])
  assert.equal(found[0].reasoning, false)
  const models = getAllModels({ customModels: [{ id: found[0].id, name: found[0].name }] })
  const model = models.find((item) => item.id === found[0].id)
  assert.equal(model.input.includes('image'), false)
  assert.equal(model.reasoningEfforts, false)
  assert.equal(model.contextKnown, false)
})

test('same id discovery does not freeze the first metadata copy', () => {
  const before = getAllModels({})
  const flash = before.find((model) => model.id === 'cline-pass/deepseek-v4-flash')
  assert.equal(flash.contextWindow, 1_000_000)
  assert.equal(flash.outputCapability, 393216)
  assert.equal(flash.requestOutputBudget, 65536)
  assert.notEqual(flash.maxTokens, flash.outputCapability)
  const again = getAllModels({ discoveredPlanIds: ['cline-pass/deepseek-v4-flash'] })
  const next = again.find((model) => model.id === flash.id)
  assert.equal(next.contextWindow, 1_000_000)
  assert.equal(next.discovered, true)
})

test('user override beats catalog and inherit removes it', () => {
  const once = upsertOverride([], 'cline-pass/deepseek-v4-flash', {
    contextWindow: 128000,
    inputMode: 'text',
    reasoningMode: 'off',
  })
  const hidden = getAllModels({ modelOverrides: once }).find((model) => model.id === 'cline-pass/deepseek-v4-flash')
  assert.equal(hidden.contextWindow, 128000)
  assert.deepEqual(hidden.input, ['text'])
  assert.equal(hidden.reasoningEfforts, false)
  const cleared = upsertOverride(once, 'cline-pass/deepseek-v4-flash', {
    contextWindow: 'inherit',
    inputMode: 'inherit',
    reasoningMode: 'inherit',
  })
  assert.equal(cleared.length, 0)
})

test('explicit empty selection is empty and disabled is not', () => {
  const models = getAllModels({})
  assert.equal(selectedIds(models, { selectionKind: 'explicit', explicitModels: [] }).length, 0)
  const disabled = selectedIds(models, { selectionKind: 'all-except-disabled', disabledModels: ['cline-pass/glm-5.2'] })
  assert.equal(disabled.includes('cline-pass/glm-5.2'), false)
  assert.ok(disabled.includes('cline-pass/deepseek-v4-flash'))
})

test('legacy dot-stripped id migrates once and then stays', () => {
  const first = migrateConfig({
    migrationRevision: 0,
    defaultModel: 'cline-pass/deepseek-v41-flash',
    disabledModels: ['cline-pass/deepseek-v41-flash'],
    enabledModels: [],
  })
  assert.equal(first.changed, true)
  assert.equal(first.config.defaultModel, 'cline-pass/deepseek-v4.1-flash')
  assert.deepEqual(first.config.disabledModels, ['cline-pass/deepseek-v4.1-flash'])
  const second = migrateConfig({ ...first.config, migrationRevision: 1 })
  assert.equal(second.changed, false)
})

test('legacy enabledModels becomes an explicit selection', () => {
  const migrated = migrateConfig({
    enabledModels: ['cline-pass/deepseek-v4-flash'],
    disabledModels: [],
  })
  assert.equal(migrated.config.selectionKind, 'explicit')
  assert.deepEqual(migrated.config.explicitModels, ['cline-pass/deepseek-v4-flash'])
})

test('provider payload keeps foreign fields and does not use the output cap as max_tokens', () => {
  const models = getAllModels({}).filter((model) => model.id === 'cline-pass/deepseek-v4-flash')
  const built = buildProviderPayload({
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKeyEnv: 'CLINEBOT_API_KEY',
    models,
    displayName: 'ClineBot (ClinePass)',
    existing: {
      headers: { 'X-User': 'kept' },
      retryPolicy: { mode: 'off' },
      compat: { supportsReasoningEffort: true },
    },
    providerReasoning: '',
  })
  assert.equal(built.payload.headers['X-User'], 'kept')
  assert.equal(built.payload.retryPolicy.mode, 'off')
  assert.equal(built.payload.defaultContextWindow, undefined)
  assert.equal(built.payload.compat, undefined)
  const entry = built.payload.models[0]
  assert.equal(entry.maxTokens, 65536)
  assert.equal(entry.contextWindow, 1_000_000)
  assert.equal(entry.reasoningEfforts.high, 'high')
  assert.equal(entry.reasoningEfforts.off, undefined)
  assert.equal(entry.reasoningEfforts.medium, undefined)
  assert.equal(entry.compat.thinkingFormat, 'deepseek')
  assert.equal(entry.input.includes('image'), true)
  const plain = built.payload.models.find((model) => model.id === 'cline-pass/qwen3.7-plus')
  assert.equal(plain, undefined)
})

test('route reasoning is omitted when any selected model cannot take it', () => {
  const models = getAllModels({})
  const built = buildProviderPayload({
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKeyEnv: 'CLINEBOT_API_KEY',
    models,
    displayName: 'ClineBot (ClinePass)',
    providerReasoning: 'high',
  })
  assert.equal(built.payload.reasoning, undefined)
  assert.match(built.reasoningWarning, /was not applied/)
})

test('discovery merge updates ids without dropping custom models', () => {
  const merged = mergeDiscovered({
    discoveredPlanIds: ['cline-pass/glm-5.2'],
    customModels: [{ id: 'cline-pass/mine', name: 'Mine' }],
  }, [
    { id: 'cline-pass/glm-5.2', known: true },
    { id: 'cline-pass/deepseek-v4-flash', known: true },
    { id: 'cline-pass/some-brand-new-model', name: 'Some Brand New Model', known: false },
  ])
  assert.equal(merged.changed, true)
  assert.ok(merged.discoveredPlanIds.includes('cline-pass/deepseek-v4-flash'))
  assert.ok(merged.customModels.some((model) => model.id === 'cline-pass/mine'))
  assert.ok(merged.customModels.some((model) => model.id === 'cline-pass/some-brand-new-model'))
})

test('cache keeps a version and a failed read does not invent an empty catalog', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clinebot-cache-'))
  const file = path.join(dir, 'models.json')
  try {
    assert.equal(await loadModelsDiskCache(file), null)
    await writeFile(file, '{"savedAt":1,"models":[{"id":"old"}]}')
    const stale = await loadModelsDiskCache(file)
    assert.equal(stale.stale, true)
    assert.deepEqual(stale.discoveredIds, [])
    const raw = await readFile(file, 'utf8')
    assert.match(raw, /old/)
    assert.equal(await saveModelsDiskCache(file, { discoveredIds: [], unknownModels: [] }), false)
    assert.equal(await saveModelsDiskCache(file, { discoveredIds: ['cline-pass/glm-5.2'], unknownModels: [] }), true)
    const fresh = await loadModelsDiskCache(file)
    assert.equal(fresh.version, 2)
    assert.deepEqual(fresh.discoveredIds, ['cline-pass/glm-5.2'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the default cache follows DSH_HOME instead of the interactive home', () => {
  const isolated = resolveModelsCachePath('', { DSH_HOME: '/tmp/dsh-clinebot-accept/home' }, '/home/murray')
  assert.equal(isolated, '/tmp/dsh-clinebot-accept/home/clinebot-models-cache.json')
  const legacy = resolveModelsCachePath('~/.dsh/clinebot-models-cache.json', { DSH_HOME: '/tmp/dsh-clinebot-accept/home' }, '/home/murray')
  assert.equal(legacy, isolated)
  const custom = resolveModelsCachePath('/var/tmp/mine.json', { DSH_HOME: '/tmp/dsh-clinebot-accept/home' }, '/home/murray')
  assert.equal(custom, '/var/tmp/mine.json')
})

test('a pinned account is the provider credential, and an empty model list is empty', () => {
  assert.equal(activeCredentialEnv({ apiKeyEnv: 'CLINEBOT_API_KEY', activeAccount: 'CLINEBOT_API_KEY_2', accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY_2' }] }), 'CLINEBOT_API_KEY_2')
  const empty = buildPiAiProvider({ models: [], baseUrl: 'http://127.0.0.1:9/v1' })
  assert.equal(empty.models.length, 0)
})

test('vendor reasoning is absent unless the catalog has an effort list, and unknown context is omitted', () => {
  const qwen = getAllModels({ modelOverrides: [{ id: 'cline-pass/qwen3.7-plus', reasoningMode: 'vendor' }] })
    .find((model) => model.id === 'cline-pass/qwen3.7-plus')
  assert.equal(qwen.vendorReasoningAvailable, false)
  assert.equal(qwen.reasoningEfforts, false)
  assert.equal(qwen.contextWindow, 1_000_000)
  assert.equal(qwen.outputCapability, 131_072)
  assert.equal(qwen.input.includes('image'), true)
  const mimo = getAllModels({ modelOverrides: [{ id: 'cline-pass/mimo-v2.5', reasoningMode: 'vendor' }] })
    .find((model) => model.id === 'cline-pass/mimo-v2.5')
  assert.equal(mimo.reasoningEfforts, false)
  const glm = getAllModels({ modelOverrides: [{ id: 'cline-pass/glm-5.2', reasoningMode: 'vendor' }] })
    .find((model) => model.id === 'cline-pass/glm-5.2')
  const built = buildProviderPayload({
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKeyEnv: 'CLINEBOT_API_KEY',
    models: [glm, qwen],
    displayName: 'ClineBot (ClinePass)',
  })
  const glmEntry = built.payload.models.find((model) => model.id === 'cline-pass/glm-5.2')
  const qwenEntry = built.payload.models.find((model) => model.id === 'cline-pass/qwen3.7-plus')
  assert.equal(glmEntry.compat.maxTokensField, 'max_tokens')
  assert.equal(glmEntry.compat.thinkingFormat, undefined)
  assert.equal(glmEntry.reasoningEfforts.high, 'high')
  assert.equal(qwenEntry.reasoningEfforts, false)
  assert.equal(qwenEntry.contextWindow, 1_000_000)
})

test('migration does not replace config after a newer write starts', async () => {
  let replaced = false
  const pending = migrateStoredConfig({ get() { return { get() { return { providers: {} } } } } }, {
    migrationRevision: 0,
    selectionKind: 'all-except-disabled',
  }, {
    replace() { replaced = true },
  })
  noteUserWrite()
  const result = await pending
  assert.equal(result.skipped, 'stale')
  assert.equal(replaced, false)
})

test('an environment-shadowed credential write explains how to unset it', () => {
  const message = explainCredentialWriteError(new Error('credentials-local: "CLINEBOT_API_KEY" is supplied read-only by the launching environment, so set would be shadowed'), 'CLINEBOT_API_KEY')
  assert.match(message, /unset CLINEBOT_API_KEY/)
})

test('config schema accepts an explicit empty selection', () => {
  const parsed = Config({ selectionKind: 'explicit', explicitModels: [] })
  assert.equal(parsed.selectionKind, 'explicit')
  assert.deepEqual(parsed.explicitModels, [])
  assert.equal(selectedIds(getAllModels(parsed), parsed).length, 0)
})
