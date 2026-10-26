// Keep the host Models page's edits in its existing provider document. The
// last payload distinguishes those edits from an explicit plugin field change.
const fields = { contextWindow: 'contextWindow', maxTokens: 'requestOutputBudget', input: 'inputMode', reasoningEfforts: 'reasoningMode', compat: 'reasoningMode' }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().filter((key) => {
    const child = value[key]
    return child !== undefined && !(child && typeof child === 'object' && !Array.isArray(child) && !Object.keys(child).length)
  }).map((key) => [key, canonical(value[key])]))
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

function control(cfg, id, field) {
  const override = cfg?.modelOverrides?.find((model) => model.id === id)
  return override?.[field] ?? 'inherit'
}

export function preserveHostModelEdits(payload, existing, previous, cfg, reset = {}) {
  const currentRows = new Map((existing?.models || []).map((model) => [model.id, model]))
  const previousRows = new Map((previous?.payload.models || payload.models).map((model) => [model.id, model]))
  return {
    ...payload,
    models: payload.models.map((model) => {
      const current = currentRows.get(model.id)
      const last = previousRows.get(model.id)
      if (!current || !last) return model
      const next = { ...model }
      for (const [field, setting] of Object.entries(fields)) {
        if (reset[model.id]?.includes(field)) continue
        if (previous && !same(control(cfg, model.id, setting), control(previous.config, model.id, setting))) continue
        // Once preserved, a host value equals the last payload: preserve it
        // again if it still differs from our current configured projection.
        const changedInHost = !same(current[field], last[field])
        const retainedHostEdit = previous?.hostFields?.[model.id]?.includes(field)
        if (!changedInHost && !retainedHostEdit) continue
        if (current[field] === undefined) delete next[field]
        else next[field] = structuredClone(current[field])
      }
      return next
    }),
  }
}

export function retainedHostFields(payload, configured) {
  const rows = new Map(configured.models.map((model) => [model.id, model]))
  return Object.fromEntries(payload.models.map((model) => [model.id,
    Object.keys(fields).filter((field) => !same(model[field], rows.get(model.id)?.[field])),
  ]))
}

export function hostFieldsToReset(body) {
  if (body.restoreModelCapabilities) return { [body.restoreModelCapabilities]: ['contextWindow', 'input', 'reasoningEfforts', 'compat'] }
  const patch = body.modelOverride || (body.customModel?.parameters && { id: body.customModel.id, ...body.customModel.parameters })
  if (!patch) return {}
  return { [patch.id]: Object.entries(fields).filter(([, setting]) => patch[setting] !== undefined).map(([field]) => field) }
}

export function applyStoredHostEdits(payload, edits, reset = {}) {
  const saved = new Map((edits || []).map((row) => [row.id, row.values]))
  return { ...payload, models: payload.models.map((model) => {
    const next = { ...model }
    for (const [field, value] of Object.entries(saved.get(model.id) || {})) {
      if (!(field in fields) || reset[model.id]?.includes(field)) continue
      if (value === null) delete next[field]
      else next[field] = structuredClone(value)
    }
    return next
  }) }
}

export function changedModelFields(previous, cfg) {
  if (!previous) return {}
  const ids = new Set([...(previous.modelOverrides || []), ...(cfg.modelOverrides || [])].map((model) => model.id))
  return Object.fromEntries([...ids].map((id) => [id, Object.entries(fields)
    .filter(([, setting]) => !same(control(previous, id, setting), control(cfg, id, setting))).map(([field]) => field)]))
}

export function captureHostEdits(payload, configured, previous = []) {
  const known = new Map(previous.map((row) => [row.id, row]))
  const retained = retainedHostFields(payload, configured)
  for (const model of payload.models) {
    const names = retained[model.id]
    if (!names.length) known.delete(model.id)
    else known.set(model.id, { id: model.id, values: Object.fromEntries(names.map((field) => [field, model[field] ?? null])) })
  }
  return [...known.values()]
}
