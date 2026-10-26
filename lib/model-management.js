import { getAllModels, upsertOverride } from './models.js'
import { blankOverride } from './model-registry.js'
import { catalogById } from './catalog.js'
import { hostFieldsToReset } from './host-model-edits.js'
import { validateUpstreamPins } from './upstream-pin.js'

const numberFields = ['contextWindow', 'outputCapability', 'requestOutputBudget']

function counts(patch) {
  const next = {}
  for (const field of numberFields) {
    if (patch[field] === undefined) continue
    const value = patch[field]
    if (value !== 'inherit' && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`${field}: positive integer or inherit required`)
    next[field] = value
  }
  return next
}

function overridePatch(patch) {
  const next = counts(patch)
  for (const [key, choices] of Object.entries({ inputMode: ['inherit', 'text', 'text+image'], reasoningMode: ['inherit', 'off', 'vendor'] })) {
    if (patch[key] === undefined) continue
    if (!choices.includes(patch[key])) throw new Error(`Invalid ${key}`)
    next[key] = patch[key]
  }
  if (patch.defaultReasoning !== undefined) {
    if (typeof patch.defaultReasoning !== 'string') throw new Error('Invalid defaultReasoning')
    next.defaultReasoning = patch.defaultReasoning
  }
  return next
}

// Compute from the fresh configuration inside the existing settings write queue.
export function applyModelManagement(cfg, body) {
  const next = { ...cfg }
  const ids = new Set(getAllModels(cfg).map((model) => model.id))
  if (body.selectionKind !== undefined) {
    if (!['explicit', 'all-except-disabled'].includes(body.selectionKind)) throw new Error('Invalid selectionKind')
    next.selectionKind = body.selectionKind
  }
  for (const field of ['explicitModels', 'disabledModels', 'enabledModels']) {
    if (body[field] === undefined) continue
    if (!Array.isArray(body[field]) || body[field].some((id) => typeof id !== 'string')) throw new Error(`Invalid ${field}`)
    if (field === 'enabledModels') {
      next.selectionKind = 'explicit'
      next.explicitModels = [...new Set(body[field])]
    } else next[field] = [...new Set(body[field])]
  }
  if (body.disabledModels !== undefined && body.selectionKind === undefined) next.selectionKind = 'all-except-disabled'
  if (body.selectionAction === 'all') {
    next.selectionKind = 'all-except-disabled'
    next.disabledModels = []
    next.explicitModels = [...ids].filter((id) => catalogById(id)?.legacy)
  } else if (body.selectionAction === 'current') {
    next.selectionKind = 'all-except-disabled'
    next.disabledModels = []
    next.explicitModels = []
  } else if (body.selectionAction === 'none') {
    next.selectionKind = 'explicit'
    next.explicitModels = []
  } else if (body.selectionAction === 'plan') {
    if (!cfg.planVerified) throw new Error('Sync a verified plan first')
    next.selectionKind = 'explicit'
    next.explicitModels = (cfg.discoveredPlanIds || []).filter((id) => ids.has(id))
  } else if (body.selectionAction === 'clean') {
    for (const field of ['disabledModels', 'explicitModels']) next[field] = (cfg[field] || []).filter((id) => ids.has(id))
  } else if (body.selectionAction !== undefined) throw new Error('Invalid selectionAction')
  if (body.planFilterEnabled !== undefined) {
    if (typeof body.planFilterEnabled !== 'boolean') throw new Error('Invalid planFilterEnabled')
    next.planFilterEnabled = body.planFilterEnabled
  }
  if (body.defaultModel !== undefined) next.defaultModel = String(body.defaultModel)
  if (body.providerReasoning !== undefined) next.providerReasoning = String(body.providerReasoning || '')
  if (body.upstreamPin !== undefined) {
    const { model, provider } = body.upstreamPin || {}
    if (!ids.has(model)) throw new Error('Model not found')
    if (typeof provider !== 'string') throw new Error('Invalid upstream provider ID')
    next.upstreamPins = (cfg.upstreamPins || []).filter((row) => row.model !== model)
    if (provider) next.upstreamPins.push({ model, provider })
    validateUpstreamPins(next.upstreamPins)
  }
  if (body.batchModelDefaults) next.batchModelDefaults = { ...cfg.batchModelDefaults, ...counts(body.batchModelDefaults) }
  if (body.customModel) {
    const { id, name = '' } = body.customModel
    if (typeof id !== 'string' || !id.trim() || id !== id.trim() || /[\s\x00-\x1f]/.test(id)) throw new Error('Invalid model id')
    if (catalogById(id)) throw new Error('A catalog model cannot be replaced by a custom model')
    if (typeof name !== 'string') throw new Error('Invalid model name')
    next.customModels = [...(cfg.customModels || []).filter((model) => model.id !== id), { id, name: name.trim() || id, userDeclared: true }]
    if (body.customModel.parameters) next.modelOverrides = upsertOverride(next.modelOverrides, id, overridePatch(body.customModel.parameters))
  }
  if (body.enableModel !== undefined) {
    const id = body.enableModel
    if (!getAllModels(next).some((model) => model.id === id)) throw new Error('Model not found')
    next.disabledModels = (next.disabledModels || []).filter((value) => value !== id)
    next.explicitModels = [...new Set([...(next.explicitModels || []), id])]
  }
  if (body.deleteCustomModel !== undefined) {
    const id = body.deleteCustomModel
    if (!(cfg.customModels || []).some((model) => model.id === id)) throw new Error('Custom model not found')
    next.customModels = (next.customModels || []).filter((model) => model.id !== id)
    next.modelOverrides = (next.modelOverrides || []).filter((model) => model.id !== id)
    next.upstreamPins = (next.upstreamPins || []).filter((row) => row.model !== id)
    // Plan membership may still advertise the model; deletion removes only the
    // user declaration and its overrides, never alters verified plan facts.
    next.explicitModels = (next.explicitModels || []).filter((value) => value !== id)
  }
  if (body.modelOverride) {
    const { id } = body.modelOverride
    if (!ids.has(id)) throw new Error('Model not found')
    next.modelOverrides = upsertOverride(next.modelOverrides, id, overridePatch(body.modelOverride))
    const requested = body.modelOverride.defaultReasoning
    const resolved = getAllModels(next).find((model) => model.id === id)
    const allowedOff = requested === 'off' && resolved?.reasoningEfforts && resolved?.compat?.thinkingFormat === 'deepseek'
    if (requested && requested !== 'inherit' && !allowedOff && !resolved?.reasoningLevelIds?.includes(requested)) throw new Error('Default reasoning effort is not supported by this model')
  }
  if (body.restoreModelCapabilities) {
    const id = body.restoreModelCapabilities
    if (!ids.has(id)) throw new Error('Model not found')
    const { requestOutputBudget, ...capabilities } = blankOverride(id)
    void requestOutputBudget
    next.modelOverrides = upsertOverride(next.modelOverrides, id, capabilities)
  }
  const resets = hostFieldsToReset(body)
  next.hostModelOverrides = (cfg.hostModelOverrides || []).map((row) => ({
    ...row, values: Object.fromEntries(Object.entries(row.values).filter(([field]) => !resets[row.id]?.includes(field))),
  })).filter((row) => Object.keys(row.values).length && row.id !== body.deleteCustomModel)
  return next
}
