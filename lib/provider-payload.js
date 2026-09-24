import { DEFAULT_REQUEST_OUTPUT_BUDGET } from './catalog.js'
import { reasoningLevelsOf } from './model-registry.js'

export const PROVIDER_OWNED_KEYS = Object.freeze([
  'displayName',
  'api',
  'baseURL',
  'apiKeyEnv',
  'models',
  'compat',
  'defaultContextWindow',
  'defaultMaxTokens',
  'defaultInput',
  'reasoning',
])

const PRESERVE_KEYS = Object.freeze([
  'headers',
  'retryPolicy',
  'timeoutMs',
  'thinkingBudgets',
  'cacheRetention',
  'transport',
  'websocketConnectTimeoutMs',
  'streamIdleTimeoutMs',
  'maxRequestImageBytes',
  'requestImagePixelBudget',
  'requestImageMaxBytes',
])

export function buildProviderPayload({
  baseUrl,
  apiKeyEnv,
  models,
  displayName,
  existing,
  providerReasoning,
}) {
  const list = (Array.isArray(models) ? models : []).map(toPiModel)
  const preserved = {}
  if (existing && typeof existing === 'object') {
    for (const key of PRESERVE_KEYS) {
      if (existing[key] !== undefined) preserved[key] = existing[key]
    }
    for (const [key, value] of Object.entries(existing)) {
      if (PROVIDER_OWNED_KEYS.includes(key) || key in preserved || key === 'models') continue
      if (value !== undefined) preserved[key] = value
    }
  }

  const reasoning = usableRouteReasoning(providerReasoning, list)
  const payload = {
    ...preserved,
    displayName,
    api: 'openai-completions',
    baseURL: baseUrl,
    apiKeyEnv,
    defaultMaxTokens: DEFAULT_REQUEST_OUTPUT_BUDGET,
    defaultInput: ['text'],
    models: list,
  }
  delete payload.defaultContextWindow
  if (reasoning.level) payload.reasoning = reasoning.level
  else delete payload.reasoning
  if (payload.compat && payload.compat.supportsReasoningEffort === true && Object.keys(payload.compat).length === 1) {
    delete payload.compat
  }
  return { payload, reasoningWarning: reasoning.warning, modelCount: list.length }
}

function toPiModel(model) {
  const efforts = model.reasoningEfforts
  const entry = {
    id: model.id,
    name: model.name || model.id,
    description: model.description || model.name || model.id,
    maxTokens: integer(model.requestOutputBudget ?? model.maxTokens, DEFAULT_REQUEST_OUTPUT_BUDGET),
    input: Array.isArray(model.input) && model.input.includes('image') ? ['text', 'image'] : ['text'],
  }
  if (model.contextKnown && integer(model.contextWindow, 0) > 0) entry.contextWindow = integer(model.contextWindow, 0)
  if (efforts && typeof efforts === 'object' && !Array.isArray(efforts) && Object.keys(efforts).length) {
    entry.reasoningEfforts = { ...efforts }
    if (model.compat && typeof model.compat === 'object') entry.compat = { ...model.compat }
  } else {
    entry.reasoningEfforts = false
  }
  return entry
}

function usableRouteReasoning(level, models) {
  const wanted = String(level || '').trim()
  if (!wanted) return { level: '', warning: '' }
  const unsupported = models.filter((model) => !reasoningLevelsOf({ reasoningEfforts: model.reasoningEfforts }).includes(wanted))
  if (unsupported.length) {
    return {
      level: '',
      warning: `provider reasoning "${wanted}" was not applied because ${unsupported.map((model) => model.id).join(', ')} cannot take it`,
    }
  }
  return { level: wanted, warning: '' }
}

function integer(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

export function reasoningLevelsOfModelEntry(entry) {
  return reasoningLevelsOf({ reasoningEfforts: entry?.reasoningEfforts })
}
