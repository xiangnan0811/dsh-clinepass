import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_BASE_URL,
  DEFAULT_API_KEY_ENV,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_SMOKE_TIMEOUT_MS,
  normalizeBaseUrl,
} from './cline-client.js'
import {
  DEFAULT_MODEL_ID,
  getAllModels,
  selectedIds,
} from './models.js'
import { resolveModelsCachePath } from './model-cache.js'

export const NS = 'dsh-clinebot'
export const LLM_PI_AI_NS = 'llm-pi-ai'

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function isVolatileRef(value) {
  return !!value && typeof value === 'object' && typeof value.get === 'function' && VOLATILE_WRITE in value
}

// 0.1.7 stores plugin settings on the loader entry and only accepts fields
// marked volatile. extra() is the 3.18.2 spelling; volatile() is 3.18.4.
function liveField(schema) {
  if (typeof schema?.volatile === 'function') return schema.volatile()
  if (typeof schema?.extra === 'function') return schema.extra('volatile', true)
  return schema
}

export function plainConfig(config) {
  if (isVolatileRef(config)) return plainConfig(config.get())
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config || {}
  const plain = {}
  for (const [key, value] of Object.entries(config)) {
    plain[key] = isVolatileRef(value) ? value.get() : value
  }
  return plain
}

const inheritOrNumber = z.union([z.number(), z.const('inherit')]).default('inherit')

const modelOverride = z.object({
  id: z.string().required(),
  contextWindow: inheritOrNumber,
  outputCapability: inheritOrNumber,
  requestOutputBudget: inheritOrNumber,
  inputMode: z.union([z.const('inherit'), z.const('text'), z.const('text+image')]).default('inherit'),
  reasoningMode: z.union([z.const('inherit'), z.const('off'), z.const('vendor')]).default('inherit'),
  defaultReasoning: z.string().default('inherit'),
})

const nativeModel = z.object({
  id: z.string().required(), name: z.string(), description: z.string(),
  contextWindow: z.number().step(1).min(1), maxTokens: z.number().step(1).min(1),
  input: z.array(z.union([z.const('text'), z.const('image')])),
  reasoningEfforts: z.union([z.const(false), z.dict(z.union([z.string(), z.const(null)]))]),
  compat: z.dict(z.any()),
})
const nativeProfile = z.object({
  displayName: z.string(), api: z.union([z.const('openai-completions')]),
  baseURL: z.string(), apiKeyEnv: z.string(), models: z.array(nativeModel),
  headers: z.dict(z.string()), compat: z.dict(z.any()), modelOverrides: z.dict(z.any()),
  defaultContextWindow: z.number().step(1).min(1), defaultMaxTokens: z.number().step(1).min(1),
  defaultInput: z.array(z.union([z.const('text'), z.const('image')])),
  reasoning: z.string(), retryPolicy: z.any(), timeoutMs: z.number(), streamIdleTimeoutMs: z.number(),
  maxRequestImageBytes: z.number(), requestImagePixelBudget: z.number(), requestImageMaxBytes: z.number(),
  thinkingBudgets: z.dict(z.number()), cacheRetention: z.string(), transport: z.string(), websocketConnectTimeoutMs: z.number(),
})

export const Config = z.object({
  enabled: z.boolean().default(true)
    .description('When true, ClineBot is registered as a model provider in DSH.'),
  baseUrl: z.string().default(DEFAULT_BASE_URL)
    .description('Base API URL (default: https://api.cline.bot/api/v1).'),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV)
    .description('Credential / env name containing the ClinePass API key (never store key directly here).'),
  defaultModel: z.string().default(DEFAULT_MODEL_ID)
    .description('Default model ID for chat and smoke tests.'),
  selectionKind: z.union([z.const('all-except-disabled'), z.const('explicit')]).default('all-except-disabled')
    .description('all-except-disabled keeps new models enabled. explicit registers only explicitModels, including when that list is empty.'),
  disabledModels: z.array(z.string()).default([])
    .description('Model ids hidden from DSH while selectionKind is all-except-disabled.'),
  explicitModels: z.array(z.string()).default([])
    .description('Model ids registered while selectionKind is explicit. Empty means register none.'),
  enabledModels: z.array(z.string()).default([])
    .description('Deprecated. Read once by migration when it is the only selection signal.'),
  modelOverrides: z.array(modelOverride).default([])
    .description('Per-model user overrides. inherit restores the catalog value.'),
  batchModelDefaults: z.object({
    contextWindow: inheritOrNumber,
    outputCapability: inheritOrNumber,
    requestOutputBudget: inheritOrNumber,
  }).default({}),
  hostModelOverrides: z.array(z.object({ id: z.string(), values: z.dict(z.any()) })).default([])
    .description('Captured edits from the native Models page, retained while models are hidden.'),
  planFilterEnabled: z.boolean().default(false)
    .description('Restrict the manual selection only after this credential has a verified plan.'),
  planVerified: z.boolean().default(false),
  customModels: z.array(z.object({
    id: z.string().required(),
    name: z.string().default(''),
  })).default([])
    .description('User-declared models. Unknown capabilities stay unknown.'),
  discoveredPlanIds: z.array(z.string()).default([])
    .description('Ids named by the last successful plan read. Capabilities do not come from this list.'),
  dynamicModels: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().default(''),
    contextLength: z.number().default(200000),
    maxTokens: z.number().default(8192),
    input: z.array(z.string()).default(['text']),
    category: z.string().default('general'),
    isCustom: z.boolean().default(false),
    reasoningEfforts: z.any().default(undefined),
  })).default([])
    .description('Legacy discovered records. New discovery writes discoveredPlanIds and customModels instead.'),
  providerReasoning: z.string().default('')
    .description('Optional route-level DSH reasoning default. Empty leaves the gateway default. Applied only when every enabled model supports the level.'),
  proxyEnabled: z.boolean().default(false)
    .description('Use the authenticated loopback proxy for in-request account failover.'),
  nativeAdapterEnabled: z.boolean().default(false)
    .description('ClinePass adapter extension owns this provider after its first use.'),
  nativeProvider: z.union([nativeProfile, z.const(null)]).default(null)
    .description('Native provider profile, edited by the DSH Models page when adapter extensions are active.'),
  historyImageOffload: z.boolean().default(false),
  historyImagesToKeep: z.number().step(1).min(0).default(2),
  accountMode: z.union([z.const('least-used'), z.const('round-robin')]).default('least-used'),
  modelRoutes: z.array(z.object({ model: z.string().required(), account: z.string().required() })).default([]),
  proxyLimits: z.object({
    maxRequestBytes: z.number().step(1).min(1024).default(33554432),
    connectTimeoutMs: z.number().step(1).min(50).default(15000),
    firstOutputTimeoutMs: z.number().step(1).min(50).default(15000),
    bodyTimeoutMs: z.number().step(1).min(50).default(15000),
    idleTimeoutMs: z.number().step(1).min(50).default(30000),
    totalTimeoutMs: z.number().step(1).min(50).default(300000),
  }).default({}),
  proxyDirectControls: z.any().default(null)
    .description('Original native retry and timeout controls retained while proxy mode is active.'),
  migrationRevision: z.number().default(0),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS)
    .description('HTTP probe timeout in milliseconds.'),
  smokeTimeoutMs: z.number().default(DEFAULT_SMOKE_TIMEOUT_MS)
    .description('Timeout for smoke chat completions in milliseconds.'),
  modelsCachePath: z.string().default('')
    .description('Discovered-id cache. Empty uses $DSH_HOME/clinebot-models-cache.json, or ~/.dsh when DSH_HOME is unset.'),
  accounts: z.array(z.object({
    label: z.string().default(''),
    apiKeyEnv: z.string(),
  })).default([])
    .description('Additional accounts for multi-account failover and rate limit rotation.'),
  activeAccount: z.string().default('')
    .description('Manually pinned active account envName or empty for auto/default.'),
})

if (Config.dict) {
  for (const key of Object.keys(Config.dict)) {
    Config.dict[key] = liveField(Config.dict[key])
  }
}

// Newer Schemastery materializes volatile fields as refs. Policy and
// persistence readers must operate on the same plain snapshot on both hosts.
export function parseConfig(raw) {
  // Schema dictionaries carry parse markers and may be frozen. Detach before
  // reparsing a snapshot so nested provider profiles remain safe to update.
  return plainConfig(Config(structuredClone(plainConfig(raw))))
}

export function publicConfig(cfg) {
  cfg = plainConfig(cfg)
  const models = getAllModels(cfg || {})
  const active = selectedIds(models, cfg || {})
  return {
    enabled: cfg?.enabled !== false,
    baseUrl: normalizeBaseUrl(cfg?.baseUrl),
    apiKeyEnv: cfg?.apiKeyEnv || DEFAULT_API_KEY_ENV,
    defaultModel: cfg?.defaultModel || DEFAULT_MODEL_ID,
    selectionKind: cfg?.selectionKind === 'explicit' ? 'explicit' : 'all-except-disabled',
    disabledModels: Array.isArray(cfg?.disabledModels) ? cfg.disabledModels : [],
    explicitModels: Array.isArray(cfg?.explicitModels) ? cfg.explicitModels : [],
    enabledModels: active,
    modelOverrides: Array.isArray(cfg?.modelOverrides) ? cfg.modelOverrides : [],
    batchModelDefaults: cfg?.batchModelDefaults || {},
    hostModelOverrides: cfg?.hostModelOverrides || [],
    planFilterEnabled: cfg?.planFilterEnabled === true,
    planVerified: cfg?.planVerified === true,
    customModels: Array.isArray(cfg?.customModels) ? cfg.customModels : [],
    discoveredPlanIds: Array.isArray(cfg?.discoveredPlanIds) ? cfg.discoveredPlanIds : [],
    dynamicModels: Array.isArray(cfg?.dynamicModels) ? cfg.dynamicModels : [],
    providerReasoning: String(cfg?.providerReasoning || ''),
    proxyEnabled: cfg?.proxyEnabled === true,
    nativeAdapterEnabled: cfg?.nativeAdapterEnabled === true,
    historyImageOffload: cfg?.historyImageOffload === true,
    historyImagesToKeep: cfg?.historyImagesToKeep ?? 2,
    accountMode: cfg?.accountMode || 'least-used',
    modelRoutes: cfg?.modelRoutes || [],
    proxyLimits: cfg?.proxyLimits || {},
    migrationRevision: Number(cfg?.migrationRevision) || 0,
    timeoutMs: Number(cfg?.timeoutMs) || DEFAULT_TIMEOUT_MS,
    smokeTimeoutMs: Number(cfg?.smokeTimeoutMs) || DEFAULT_SMOKE_TIMEOUT_MS,
    modelsCachePath: resolveModelsCachePath(cfg?.modelsCachePath),
    accounts: Array.isArray(cfg?.accounts) ? cfg.accounts : [],
    activeAccount: String(cfg?.activeAccount || ''),
    availableModels: models,
  }
}
