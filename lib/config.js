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

const inheritOrNumber = z.union([z.number(), z.const('inherit')]).default('inherit')

const modelOverride = z.object({
  id: z.string().required(),
  contextWindow: inheritOrNumber,
  outputCapability: inheritOrNumber,
  requestOutputBudget: inheritOrNumber,
  inputMode: z.union([z.const('inherit'), z.const('text'), z.const('text+image')]).default('inherit'),
  reasoningMode: z.union([z.const('inherit'), z.const('off'), z.const('vendor')]).default('inherit'),
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

export function publicConfig(cfg) {
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
    customModels: Array.isArray(cfg?.customModels) ? cfg.customModels : [],
    discoveredPlanIds: Array.isArray(cfg?.discoveredPlanIds) ? cfg.discoveredPlanIds : [],
    dynamicModels: Array.isArray(cfg?.dynamicModels) ? cfg.dynamicModels : [],
    providerReasoning: String(cfg?.providerReasoning || ''),
    migrationRevision: Number(cfg?.migrationRevision) || 0,
    timeoutMs: Number(cfg?.timeoutMs) || DEFAULT_TIMEOUT_MS,
    smokeTimeoutMs: Number(cfg?.smokeTimeoutMs) || DEFAULT_SMOKE_TIMEOUT_MS,
    modelsCachePath: resolveModelsCachePath(cfg?.modelsCachePath),
    accounts: Array.isArray(cfg?.accounts) ? cfg.accounts : [],
    activeAccount: String(cfg?.activeAccount || ''),
    availableModels: models,
  }
}
