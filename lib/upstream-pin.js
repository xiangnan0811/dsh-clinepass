// ClinePass has two routing paths. The planner reads gateway.only; the
// OpenRouter path reads provider.only. Keep the restriction on both paths.
export function validateUpstreamPins(pins) {
  if (!Array.isArray(pins)) throw new Error('upstreamPins must be an array')
  const seen = new Set()
  for (const row of pins) {
    if (!row || typeof row.model !== 'string' || !row.model || row.model !== row.model.trim() || /\s/.test(row.model)) throw new Error('Invalid upstream pin model')
    if (typeof row.provider !== 'string' || !/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(row.provider)) throw new Error('Use an upstream provider ID, for example deepseek')
    if (seen.has(row.model)) throw new Error('Only one upstream pin is allowed per model')
    seen.add(row.model)
  }
  return pins
}

export function upstreamPinFor(config, model) {
  return config.upstreamPins?.find((row) => row.model === model)?.provider || ''
}

function providerId(value) {
  if (typeof value !== 'string') return ''
  const id = value.trim().toLowerCase().replace(/\s+/g, '-')
  return ['z.ai', 'z-ai', 'zai'].includes(id) ? 'zai' : id
}

export function applyUpstreamPin(body, pin) {
  if (!pin) return body
  const gateway = providerId(pin)
  const direct = gateway === 'zai' ? 'z-ai' : pin
  const routing = { ...body.providerOptions?.gateway, only: [gateway], order: [gateway] }
  // The 1017 Pass virtual model can ignore `only` on its private candidate.
  // These capability filters select the public candidate where `only` applies
  // (live-checked 2026-10-26). Still require matching final-provider metadata.
  if (body.model === 'cline-pass/deepseek-v4.1-flash-1017' && gateway === 'deepseek') {
    const has = routing.has ?? []
    if (Array.isArray(has)) routing.has = [...new Set([...has, 'vision', 'implicit-caching'])]
  }
  return { ...body,
    provider: { ...body.provider, only: [direct], order: [direct], allow_fallbacks: false },
    providerOptions: { ...body.providerOptions, gateway: routing },
  }
}

// Read only structured routing facts, never model text or attempted providers.
export function reportedUpstreams(value) {
  const payload = value?.data?.choices ? value.data : value
  const parts = [payload, ...(Array.isArray(payload?.choices) ? payload.choices.flatMap((choice) => [choice.delta, choice.message]) : [])]
  const finals = parts.map((part) => part?.provider_metadata?.gateway?.routing?.finalProvider)
    .filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim())
  if (finals.length) return [...new Set(finals)]
  return typeof payload?.provider === 'string' && payload.provider.trim() ? [payload.provider.trim()] : []
}

// Keep only bounded identifiers. Free-form planning text, prompts, headers and
// attempted providers are neither persisted nor used to decide a pin match.
export function normalizeRoutingEvidence(value) {
  const evidence = {}
  for (const key of ['responseId', 'responseModel', 'canonicalModel', 'resolvedProvider', 'deepseekFingerprint']) {
    const text = value?.[key]
    if (typeof text === 'string' && /^[a-zA-Z0-9._:/@+-]{1,256}$/.test(text)) evidence[key] = text
  }
  return Object.keys(evidence).length ? evidence : null
}

export function reportedRoutingEvidence(value, previous) {
  const payload = value?.data?.choices ? value.data : value
  const evidence = { ...normalizeRoutingEvidence(previous), ...normalizeRoutingEvidence({ responseId: payload?.id, responseModel: payload?.model }) }
  const parts = [payload, ...(Array.isArray(payload?.choices) ? payload.choices.flatMap((choice) => [choice.delta, choice.message]) : [])]
  for (const part of parts) {
    const metadata = part?.provider_metadata
    Object.assign(evidence, normalizeRoutingEvidence({
      canonicalModel: metadata?.gateway?.routing?.canonicalSlug,
      resolvedProvider: metadata?.gateway?.routing?.resolvedProvider,
      deepseekFingerprint: metadata?.deepseek?.systemFingerprint,
    }))
  }
  return normalizeRoutingEvidence(evidence)
}

export function upstreamPinFailure(pin, actual) {
  if (!pin) return null
  if (!actual) return { code: 'UPSTREAM_PIN_UNVERIFIED', message: 'ClinePass did not report its upstream provider; the pin could not be verified' }
  if (providerId(pin) !== providerId(actual)) return { code: 'UPSTREAM_PIN_MISMATCH', message: 'ClinePass used a different upstream provider; the configured pin was not honored' }
  return null
}

// A matching response proves this call's landing, not that the gateway will
// enforce the restriction on future calls. Old records have no routing evidence.
export function upstreamObservation(metrics) {
  const pin = typeof metrics.upstreamPin === 'string' ? metrics.upstreamPin : null
  const actual = typeof metrics.upstream === 'string' ? metrics.upstream : ''
  const attached = typeof metrics.upstreamPinAttached === 'boolean' ? metrics.upstreamPinAttached : null
  const status = pin === null ? 'unrecorded' : !pin ? 'automatic'
    : actual && upstreamPinFailure(pin, actual) ? 'mismatch'
      : attached === false ? 'not-attached' : !attached || !actual ? 'unverified' : 'matched'
  return { upstreamPin: pin, upstream: actual, upstreamPinAttached: attached, upstreamPinStatus: status,
    routingEvidence: normalizeRoutingEvidence(metrics.routingEvidence) }
}
