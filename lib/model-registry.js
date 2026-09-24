import {
  CATALOG,
  DEFAULT_REQUEST_OUTPUT_BUDGET,
  catalogById,
  legacyTarget,
  resolveAlias,
  slugModelName,
} from './catalog.js'

export const MIGRATION_REVISION = 1
const LEGACY_CONTEXT = 200_000
const LEGACY_OUTPUT = 8192

const INHERIT = 'inherit'
const EFFORT_MAX_TOKENS_COMPAT = Object.freeze({
  supportsReasoningEffort: true,
  maxTokensField: 'max_tokens',
})

export function blankOverride(id) {
  return {
    id,
    contextWindow: INHERIT,
    outputCapability: INHERIT,
    requestOutputBudget: INHERIT,
    inputMode: INHERIT,
    reasoningMode: INHERIT,
  }
}

export function overridesById(list) {
  const out = new Map()
  if (!Array.isArray(list)) return out
  for (const item of list) {
    if (item && typeof item.id === 'string' && item.id) out.set(item.id, { ...blankOverride(item.id), ...item, id: item.id })
  }
  return out
}

function isLegacyPlaceholder(record) {
  if (!record || typeof record !== 'object') return false
  const context = Number(record.contextLength ?? record.contextWindow)
  const output = Number(record.maxTokens ?? record.outputCapability)
  return context === LEGACY_CONTEXT && output === LEGACY_OUTPUT
}

export function parsePlanIncludedModels(includedInput) {
  const text = includedText(includedInput)
  if (!text) return []
  const clean = text
    .replace(/^includes\s+/i, '')
    .replace(/\band\b/gi, ',')
    .trim()
  const parts = clean.split(',').map((part) => part.trim()).filter(Boolean)
  const matched = []
  const seen = new Set()
  for (const name of parts) {
    const aliased = resolveAlias(name)
    const id = aliased || `cline-pass/${slugModelName(name)}`
    if (!id || id === 'cline-pass/' || seen.has(id)) continue
    seen.add(id)
    const known = catalogById(id)
    matched.push(known
      ? { id, name: known.name, discovered: true, known: true }
      : {
          id,
          name,
          discovered: true,
          known: false,
          contextWindow: null,
          outputCapability: null,
          input: ['text'],
          reasoning: false,
        })
  }
  return matched
}

function includedText(includedInput) {
  if (!includedInput) return ''
  if (Array.isArray(includedInput)) {
    const found = includedInput.find((item) => typeof item === 'string' && /includes\s+/i.test(item))
    if (found) return found
    return includedInput.filter((item) => typeof item === 'string').join(', ')
  }
  return typeof includedInput === 'string' ? includedInput : ''
}

export function mapLegacyId(id, occupied) {
  const target = legacyTarget(id)
  if (!target || target === id) return { id, mapped: false, conflict: false }
  if (occupied.has(target) && occupied.get(target) !== 'legacy') {
    return { id, mapped: false, conflict: true, target }
  }
  return { id: target, mapped: true, conflict: false, from: id, target }
}

export function migrateConfig(raw, existingProvider = null) {
  const cfg = raw && typeof raw === 'object' ? { ...raw } : {}
  const notes = []
  if (Number(cfg.migrationRevision) >= MIGRATION_REVISION) {
    return { config: cfg, notes, changed: false }
  }

  const occupied = new Map()
  for (const id of collectIds(cfg)) occupied.set(id, 'present')

  const rewrite = (id) => {
    const result = mapLegacyId(id, occupied)
    if (result.conflict) {
      notes.push(`left ${id} in place because ${result.target} is already present`)
      return id
    }
    if (result.mapped) {
      notes.push(`mapped ${result.from} → ${result.target}`)
      occupied.set(result.target, 'legacy')
    }
    return result.id
  }

  if (Array.isArray(cfg.disabledModels)) cfg.disabledModels = unique(cfg.disabledModels.map(rewrite))
  if (Array.isArray(cfg.explicitModels)) cfg.explicitModels = unique(cfg.explicitModels.map(rewrite))
  if (Array.isArray(cfg.discoveredPlanIds)) cfg.discoveredPlanIds = unique(cfg.discoveredPlanIds.map(rewrite))
  if (typeof cfg.defaultModel === 'string') cfg.defaultModel = rewrite(cfg.defaultModel)
  if (Array.isArray(cfg.modelOverrides)) {
    cfg.modelOverrides = cfg.modelOverrides.map((item) => item && item.id ? { ...item, id: rewrite(item.id) } : item)
  }
  if (Array.isArray(cfg.customModels)) {
    cfg.customModels = cfg.customModels.map((item) => item && item.id ? { ...item, id: rewrite(item.id) } : item)
  }

  const enabled = Array.isArray(cfg.enabledModels) ? cfg.enabledModels.map(rewrite).filter(Boolean) : []
  const disabled = Array.isArray(cfg.disabledModels) ? cfg.disabledModels : []
  if (!cfg.selectionKind) {
    if (enabled.length > 0 && disabled.length === 0) {
      cfg.selectionKind = 'explicit'
      cfg.explicitModels = unique(enabled)
      notes.push('imported legacy enabledModels as an explicit selection')
    } else {
      cfg.selectionKind = 'all-except-disabled'
    }
  }

  const custom = Array.isArray(cfg.customModels) ? [...cfg.customModels] : []
  const customIds = new Set(custom.map((item) => item?.id).filter(Boolean))
  if (Array.isArray(cfg.dynamicModels)) {
    for (const item of cfg.dynamicModels) {
      if (!item?.id || !item.isCustom || customIds.has(item.id)) continue
      custom.push({ id: rewrite(item.id), name: item.name || item.id })
      customIds.add(item.id)
    }
  }
  cfg.customModels = custom

  const imported = importProviderDivergences(existingProvider, overridesById(cfg.modelOverrides))
  if (imported.overrides.length) {
    const merged = overridesById(cfg.modelOverrides)
    for (const item of imported.overrides) merged.set(item.id, item)
    cfg.modelOverrides = [...merged.values()]
    notes.push(...imported.notes)
  }

  cfg.migrationRevision = MIGRATION_REVISION
  return { config: cfg, notes, changed: true }
}

function collectIds(cfg) {
  const ids = []
  for (const key of ['disabledModels', 'explicitModels', 'enabledModels', 'discoveredPlanIds']) {
    if (Array.isArray(cfg[key])) ids.push(...cfg[key])
  }
  if (typeof cfg.defaultModel === 'string') ids.push(cfg.defaultModel)
  if (Array.isArray(cfg.customModels)) ids.push(...cfg.customModels.map((item) => item?.id))
  return ids.filter(Boolean)
}

function unique(list) {
  return [...new Set(list.filter((id) => typeof id === 'string' && id))]
}

export function importProviderDivergences(provider, existingOverrides) {
  const models = provider?.models
  if (!Array.isArray(models)) return { overrides: [], notes: [] }
  const notes = []
  const overrides = []
  for (const model of models) {
    if (!model?.id || existingOverrides.has(model.id)) continue
    const catalog = catalogById(model.id)
    const patch = { ...blankOverride(model.id) }
    let touched = false
    if (isUserNumber(model.contextWindow, catalog?.contextWindow)) {
      patch.contextWindow = model.contextWindow
      touched = true
    }
    if (isUserNumber(model.maxTokens, null) && model.maxTokens !== DEFAULT_REQUEST_OUTPUT_BUDGET && model.maxTokens !== LEGACY_OUTPUT) {
      patch.requestOutputBudget = model.maxTokens
      touched = true
    }
    if (Array.isArray(model.input) && model.input.length) {
      const image = model.input.includes('image')
      const catalogImage = !!(catalog?.effectiveImage)
      if (image !== catalogImage) {
        patch.inputMode = image ? 'text+image' : 'text'
        touched = true
      }
    }
    if (touched) {
      overrides.push(patch)
      notes.push(`imported provider edits for ${model.id}`)
    }
  }
  return { overrides, notes }
}

function isUserNumber(value, catalogValue) {
  if (!Number.isInteger(value) || value <= 0) return false
  if (value === LEGACY_CONTEXT || value === LEGACY_OUTPUT) return false
  if (catalogValue != null && value === catalogValue) return false
  return true
}

export function selectedIds(models, cfg) {
  const ids = models.map((model) => model.id)
  if (cfg?.selectionKind === 'explicit') {
    const wanted = new Set(Array.isArray(cfg.explicitModels) ? cfg.explicitModels : [])
    return ids.filter((id) => wanted.has(id))
  }
  const disabled = new Set(Array.isArray(cfg?.disabledModels) ? cfg.disabledModels : [])
  return ids.filter((id) => !disabled.has(id))
}

export function assembleModels(cfg) {
  const overrides = overridesById(cfg?.modelOverrides)
  const discovered = new Set(Array.isArray(cfg?.discoveredPlanIds) ? cfg.discoveredPlanIds : [])
  const models = []
  const seen = new Set()

  for (const catalog of CATALOG) {
    models.push(materialize(catalog, null, overrides.get(catalog.id), discovered.has(catalog.id)))
    seen.add(catalog.id)
  }

  const extras = [
    ...(Array.isArray(cfg?.customModels) ? cfg.customModels.map((item) => ({ ...item, isCustom: true })) : []),
    ...(Array.isArray(cfg?.dynamicModels) ? cfg.dynamicModels : []),
  ]
  for (const extra of extras) {
    if (!extra?.id || seen.has(extra.id)) continue
    const catalog = catalogById(extra.id)
    if (catalog) continue
    models.push(materialize(null, {
      ...extra,
      contextLength: isLegacyPlaceholder(extra) ? null : extra.contextLength,
      contextWindow: isLegacyPlaceholder(extra) ? null : extra.contextWindow,
      maxTokens: isLegacyPlaceholder(extra) ? null : extra.maxTokens,
    }, overrides.get(extra.id), discovered.has(extra.id)))
    seen.add(extra.id)
  }

  for (const id of discovered) {
    if (seen.has(id)) continue
    models.push(materialize(null, { id, name: id, discovered: true }, overrides.get(id), true))
    seen.add(id)
  }

  return models
}

function materialize(catalog, extra, override, discovered) {
  const base = override || blankOverride(catalog?.id || extra.id)
  const unknown = !catalog
  const contextInherit = catalog?.contextWindow ?? null
  const contextWindow = base.contextWindow === INHERIT ? contextInherit : finiteInt(base.contextWindow)
  const outputInherit = catalog?.outputCapability ?? null
  const outputCapability = base.outputCapability === INHERIT ? outputInherit : finiteInt(base.outputCapability)
  const budgetInherit = DEFAULT_REQUEST_OUTPUT_BUDGET
  const requestOutputBudget = base.requestOutputBudget === INHERIT ? budgetInherit : finiteInt(base.requestOutputBudget)
  const vendorImage = !!(catalog?.vendorInput || []).includes('image')
  const effectiveImage = base.inputMode === INHERIT
    ? !!catalog?.effectiveImage
    : base.inputMode === 'text+image'
  const input = effectiveImage ? ['text', 'image'] : ['text']
  const reasoningMode = base.reasoningMode || INHERIT
  let reasoning = false
  let compat = null
  let reasoningSource = 'none'
  if (reasoningMode === 'off') {
    reasoning = false
    reasoningSource = 'user-off'
  } else if (reasoningMode === 'vendor') {
    const wire = vendorWire(catalog)
    if (wire) {
      reasoning = wire.reasoning
      compat = wire.compat
      reasoningSource = 'user-vendor'
    } else {
      reasoning = false
      reasoningSource = 'vendor-unavailable'
    }
  } else if (reasoningMode === INHERIT && catalog?.applyReasoningByDefault && catalog.reasoning) {
    reasoning = catalog.reasoning
    compat = catalog.compat
    reasoningSource = 'vendor-default'
  }

  const overridden = []
  if (base.contextWindow !== INHERIT) overridden.push('contextWindow')
  if (base.outputCapability !== INHERIT) overridden.push('outputCapability')
  if (base.requestOutputBudget !== INHERIT) overridden.push('requestOutputBudget')
  if (base.inputMode !== INHERIT) overridden.push('input')
  if (base.reasoningMode !== INHERIT) overridden.push('reasoning')

  const id = catalog?.id || extra.id
  const name = extra?.name || catalog?.name || id
  return {
    id,
    name,
    description: describeModel({
      name,
      contextWindow,
      outputCapability,
      requestOutputBudget,
      input,
      reasoning,
      unknown,
      catalog,
    }),
    contextLength: contextWindow,
    contextWindow: contextWindow ?? null,
    contextKnown: contextWindow != null,
    contextSource: sourceOf(base.contextWindow, catalog ? 'vendor' : 'unknown'),
    outputCapability,
    outputCapabilitySource: sourceOf(base.outputCapability, outputInherit != null ? 'vendor' : 'unknown'),
    maxTokens: requestOutputBudget,
    requestOutputBudget,
    requestBudgetSource: base.requestOutputBudget === INHERIT ? 'default-budget' : 'user',
    input,
    vendorInput: catalog?.vendorInput || ['text'],
    inputSource: sourceOf(base.inputMode, catalog?.effectiveImage ? 'vendor-unverified-channel' : (vendorImage ? 'vendor-withheld' : 'text')),
    category: extra?.category || catalog?.category || (extra?.isCustom ? 'custom' : 'general'),
    recommended: !!catalog?.recommended,
    isCustom: !!(extra?.isCustom),
    discovered: !!discovered,
    channelListed: catalog ? !!catalog.channelListed : false,
    known: !!catalog,
    vendorReasoningAvailable: vendorWire(catalog) !== null,
    reasoningEfforts: reasoning || false,
    reasoningLevelIds: reasoning ? Object.keys(reasoning) : [],
    compat,
    reasoningSource,
    vendorReasoningNote: catalog?.vendorReasoningNote || catalog?.note || '',
    note: catalog?.note || (unknown ? 'Unknown to the maintained catalog. No image or reasoning capability is assumed.' : ''),
    overridden,
    override: base,
  }
}

function sourceOf(mode, inherited) {
  return mode === INHERIT || mode === undefined ? inherited : 'user'
}

function finiteInt(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function vendorWire(catalog) {
  if (!catalog) return null
  if (catalog.optionalReasoning && typeof catalog.optionalReasoning === 'object') {
    return {
      reasoning: catalog.optionalReasoning,
      compat: catalog.optionalCompat || EFFORT_MAX_TOKENS_COMPAT,
    }
  }
  if (catalog.applyReasoningByDefault && catalog.reasoning) {
    return { reasoning: catalog.reasoning, compat: catalog.compat || null }
  }
  return null
}

function describeModel(model) {
  const parts = []
  if (model.contextWindow) parts.push(`${formatCount(model.contextWindow)} context`)
  else parts.push('context unknown')
  if (model.outputCapability) parts.push(`output cap ${formatCount(model.outputCapability)}`)
  else parts.push('output cap unknown')
  parts.push(`request budget ${formatCount(model.requestOutputBudget)}`)
  if (model.input.includes('image')) parts.push('image')
  if (model.reasoning) parts.push(`reasoning ${Object.keys(model.reasoning).join('/')}`)
  const prefix = `[${parts.join(' · ')}] `
  const detail = model.catalog?.note || model.name
  return `${prefix}${detail}`
}

export function formatModelContext(contextLength) {
  const num = Number(contextLength)
  if (!Number.isFinite(num) || num <= 0) return ''
  if (num >= 1_000_000 && num % 1_000_000 === 0) return `${num / 1_000_000}M`
  if (num >= 1000 && num % 1000 === 0) return `${num / 1000}K`
  if (num >= 1000) return `${Math.round(num / 1000)}K`
  return String(num)
}

function formatCount(num) {
  return formatModelContext(num) || String(num)
}

export function formatModelDescription(model) {
  return model?.description || model?.name || model?.id || ''
}

export function getAllModels(cfg = {}) {
  const config = Array.isArray(cfg) ? { dynamicModels: cfg } : cfg
  return assembleModels(config)
}

export function findModel(id, cfg = {}) {
  return getAllModels(cfg).find((model) => model.id === id) || null
}

export function isSupportedModel(id, cfg = {}) {
  return findModel(id, cfg) !== null
}

export function isVisionModel(id, cfg = {}) {
  const model = findModel(id, cfg)
  return !!model?.input?.includes('image')
}

export function getDefaultModelIds(cfg = {}) {
  return getAllModels(cfg).map((model) => model.id)
}

export function getActiveModelIds(allModels = [], disabledOrConfig = []) {
  if (disabledOrConfig && !Array.isArray(disabledOrConfig) && typeof disabledOrConfig === 'object') {
    const models = Array.isArray(allModels) && allModels.length && typeof allModels[0] === 'object'
      ? allModels
      : getAllModels(disabledOrConfig)
    return selectedIds(models, disabledOrConfig)
  }
  const disabled = new Set(Array.isArray(disabledOrConfig) ? disabledOrConfig : [])
  return (Array.isArray(allModels) ? allModels : [])
    .map((model) => (typeof model === 'string' ? model : model?.id))
    .filter((id) => id && !disabled.has(id))
}

export function reasoningLevelsOf(model) {
  const efforts = model?.reasoningEfforts
  if (!efforts || efforts === false) return []
  return Object.keys(efforts)
}

export function upsertOverride(list, id, patch) {
  const merged = overridesById(list)
  const current = merged.get(id) || blankOverride(id)
  const next = { ...current, ...patch, id }
  for (const key of Object.keys(blankOverride(id))) {
    if (next[key] === undefined || next[key] === null || next[key] === '') next[key] = INHERIT
  }
  if (sameOverride(next, blankOverride(id))) merged.delete(id)
  else merged.set(id, next)
  return [...merged.values()]
}

function sameOverride(a, b) {
  return ['contextWindow', 'outputCapability', 'requestOutputBudget', 'inputMode', 'reasoningMode']
    .every((key) => a[key] === b[key])
}

export function mergeDiscovered(cfg, discovered) {
  const ids = unique((Array.isArray(discovered) ? discovered : []).map((item) => (typeof item === 'string' ? item : item?.id)))
  const previous = new Set(Array.isArray(cfg.discoveredPlanIds) ? cfg.discoveredPlanIds : [])
  const custom = Array.isArray(cfg.customModels) ? [...cfg.customModels] : []
  const customIds = new Set(custom.map((item) => item.id))
  let changed = ids.length !== previous.size || ids.some((id) => !previous.has(id))
  for (const item of Array.isArray(discovered) ? discovered : []) {
    if (!item?.id || item.known || catalogById(item.id) || customIds.has(item.id)) continue
    custom.push({ id: item.id, name: item.name || item.id })
    customIds.add(item.id)
    changed = true
  }
  return {
    ...cfg,
    discoveredPlanIds: ids,
    customModels: custom,
    changed,
  }
}
