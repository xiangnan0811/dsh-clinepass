import { normalizeBaseUrl, DEFAULT_TIMEOUT_MS } from './cline-client.js'
import { catalogById, DEFAULT_REQUEST_OUTPUT_BUDGET } from './catalog.js'

const validId = (id) => typeof id === 'string' && id.length <= 256 && id.length > 0 && !/[\s\x00-\x1f\x7f]/.test(id)
const positive = (value) => Number.isSafeInteger(value) && value > 0 ? value : undefined

function rowsOf(data, key) {
  const rows = data?.[key]
  if (!Array.isArray(rows)) throw new Error('Invalid model list')
  const valid = rows.filter((row) => validId(row?.id))
  if (rows.length && !valid.length) throw new Error('Invalid model entries')
  return valid
}

function parametersOf(row) {
  const contextWindow = positive(row?.top_provider?.context_length) ?? positive(row?.context_length) ?? positive(row?.contextWindow)
  const outputCapability = positive(row?.top_provider?.max_completion_tokens) ?? positive(row?.max_output_tokens) ?? positive(row?.outputCapability)
  const modalities = row?.architecture?.input_modalities ?? row?.input
  const parameters = {}
  if (contextWindow) parameters.contextWindow = contextWindow
  if (outputCapability) parameters.outputCapability = outputCapability
  if (Array.isArray(modalities) && modalities.includes('text')) parameters.inputMode = modalities.includes('image') ? 'text+image' : 'text'
  // A capability ceiling is not the request budget. Keep the existing default,
  // lowering it only when the API advertises a smaller ceiling.
  parameters.requestOutputBudget = Math.min(DEFAULT_REQUEST_OUTPUT_BUDGET, outputCapability || Infinity, contextWindow || Infinity)
  return parameters
}

/** Recommendation membership proves only listing, never plan access. A vendor
 * row can supply reference parameters for an already listed Pass ID, but cannot
 * manufacture a Pass ID. Ambiguous suffixes are deliberately left unresolved. */
export function mergeModelDiscovery(recommended, models) {
  const freeIds = new Map(recommended.filter(row => row.freeSource === '/ai/cline/recommended-models#free').map(row => [row.id, row.freeSource]))
  const byId = new Map(models.map((row) => [row.id, row]))
  const suffixes = new Map()
  for (const row of models) {
    if (row.id.startsWith('cline-pass/') || row.id.startsWith('@') || row.id.startsWith('~') || row.id.includes(':batch')) continue
    const suffix = row.id.slice(row.id.indexOf('/') + 1)
    suffixes.set(suffix, [...(suffixes.get(suffix) || []), row])
  }
  const result = new Map()
  for (const row of [...recommended, ...models]) {
    if (result.has(row.id) || row.id.startsWith('@') || row.id.startsWith('~') || row.id.includes(':batch')) continue
    const pass = row.id.startsWith('cline-pass/')
    const candidates = pass ? suffixes.get(row.id.slice('cline-pass/'.length)) : null
    const detail = byId.get(row.id) || (candidates?.length === 1 ? candidates[0] : row)
    const catalog = catalogById(row.id)
    result.set(row.id, {
      id: row.id,
      name: catalog?.name || (typeof detail.name === 'string' && detail.name.trim() ? detail.name.slice(0, 200) : typeof row.name === 'string' && row.name.trim() ? row.name.slice(0, 200) : row.id),
      lane: pass ? 'pass' : 'api',
      builtIn: !!catalog,
      metadataId: detail.id,
      ...(freeIds.has(row.id) ? { free: true, freeSource: freeIds.get(row.id) } : {}),
      parameters: parametersOf(detail),
    })
  }
  return [...result.values()]
}

/** Read the configured gateway only. Credentials never go to another metadata
 * service, and a redirect is not followed with account authorization attached. */
export async function discoverModels(baseUrl, apiKey, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, signal: callerSignal } = {}) {
  const base = normalizeBaseUrl(baseUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  timer.unref?.()
  const headers = { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }
  const signal = AbortSignal.any([controller.signal, callerSignal].filter(Boolean))
  async function read(path, key) {
    try {
      signal.throwIfAborted()
      const response = await fetchImpl(`${base}${path}`, { headers, signal, redirect: 'error' })
      if (!response.ok) {
        await response.body?.cancel()
        return { ok: false, error: `${path}: HTTP ${response.status}` }
      }
      const data = await response.json()
      const rows = rowsOf(data, key)
      // The gateway's explicit free bucket is evidence for these exact IDs.
      // Neither a zero reference price nor a name containing free is evidence.
      if (key === 'clinePass' && data.free !== undefined) {
        rows.push(...rowsOf(data, 'free').map(row => ({ ...row, freeSource: '/ai/cline/recommended-models#free' })))
      }
      signal.throwIfAborted()
      return { ok: true, rows }
    } catch {
      return { ok: false, error: `${path}: ${signal.aborted ? 'request cancelled or timed out' : 'model list unavailable or invalid'}` }
    }
  }
  try {
    const [recommended, detailed] = await Promise.all([
      read('/ai/cline/recommended-models', 'clinePass'),
      read('/ai/cline/models', 'data'),
    ])
    const models = detailed.ok || signal.aborted ? detailed : await read('/models', 'data')
    const warnings = [recommended, models].filter((item) => !item.ok).map((item) => item.error)
    if (!recommended.ok && !models.ok) return { ok: false, error: warnings.join('; ') }
    return { ok: true, models: mergeModelDiscovery(recommended.rows || [], models.rows || []), warnings, checkedAt: Date.now() }
  } finally {
    clearTimeout(timer)
  }
}
