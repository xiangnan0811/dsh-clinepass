import { WebError } from '@deepseek-ai/dsh-web'
import { normalizeBaseUrl } from './cline-client.js'
import { resolveActiveAccountKey } from './provider-sync.js'

const failure = (message, code) => new WebError(message, code)

function searchResult(data, limit) {
  if (data?.error) throw failure('ClinePass search returned an error response', 'WEB_INVALID_RESPONSE')
  if (!Array.isArray(data?.results)) throw failure('ClinePass search returned no results array', 'WEB_INVALID_RESPONSE')
  const sources = data.results.map((row) => {
    let url
    try { url = new URL(row?.url) } catch { throw failure('ClinePass search returned an invalid source URL', 'WEB_INVALID_RESPONSE') }
    if (!['http:', 'https:'].includes(url.protocol)) throw failure('ClinePass search returned an unsupported source URL', 'WEB_INVALID_RESPONSE')
    const source = { url: url.href }
    for (const field of ['title', 'snippet', 'publishedAt']) {
      if (row[field] === undefined || row[field] === null) continue
      if (typeof row[field] !== 'string' || (field === 'publishedAt' && !Number.isFinite(Date.parse(row[field])))) throw failure('ClinePass search returned invalid source metadata', 'WEB_INVALID_RESPONSE')
      if (row[field].trim()) source[field] = row[field].trim()
    }
    return source
  })
  return { sources: sources.slice(0, limit), truncated: sources.length > limit }
}

/** Optional native capability; never changes the host's provider selection. */
export function createWebSearch(ctx, { live, fetchImpl = fetch, resolveAccount = resolveActiveAccountKey }) {
  let web, unregister, stopped = false
  const pending = new Set(), controllers = new Set()
  const available = () => !stopped && live().enabled !== false && live().webSearchEnabled === true
  async function search(request, signal) {
    if (!available()) throw failure('ClinePass web search is disabled', 'WEB_PROVIDER_UNAVAILABLE')
    if (typeof request?.query !== 'string' || !request.query.trim()) throw failure('A nonempty search query is required', 'WEB_INVALID_REQUEST')
    if (request.maxResults !== undefined && (!Number.isSafeInteger(request.maxResults) || request.maxResults < 1)) throw failure('maxResults must be a positive integer', 'WEB_INVALID_REQUEST')
    const cfg = live(), limit = Math.min(10, request.maxResults ?? 5)
    const controller = new AbortController()
    controllers.add(controller)
    const combined = AbortSignal.any([controller.signal, signal].filter(Boolean))
    const timer = setTimeout(() => controller.abort(new DOMException('Search timed out', 'TimeoutError')), cfg.searchTimeoutMs ?? 15000)
    try {
      combined.throwIfAborted()
      const account = await resolveAccount(ctx, cfg)
      combined.throwIfAborted()
      if (!account.value) throw failure('No active ClinePass credential is available', 'WEB_CREDENTIAL_MISSING')
      const response = await fetchImpl(`${normalizeBaseUrl(cfg.baseUrl)}/alpha/web-search`, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.value}`, 'x-cli-environment': 'production' },
        body: JSON.stringify({ query: request.query.trim(), numResults: limit }),
      })
      if (!response.ok) {
        await response.body?.cancel()
        const error = failure(`ClinePass search failed (HTTP ${response.status})`, `WEB_CLINE_HTTP_${response.status}`)
        error.status = response.status
        error.retryAfter = response.headers.get('retry-after')
        throw error
      }
      let data
      try { data = await response.json() } catch { combined.throwIfAborted(); throw failure('ClinePass search returned invalid JSON', 'WEB_INVALID_RESPONSE') }
      combined.throwIfAborted()
      return searchResult(data, limit)
    } catch (error) {
      if (combined.aborted) throw failure(combined.reason?.name === 'TimeoutError' ? 'ClinePass search timed out' : 'ClinePass search cancelled', combined.reason?.name === 'TimeoutError' ? 'WEB_TIMEOUT' : 'WEB_CANCELLED')
      if (error instanceof WebError) throw error
      throw failure('ClinePass search request failed', 'WEB_PROVIDER_FAILED')
    } finally { clearTimeout(timer); controllers.delete(controller) }
  }
  const provider = { id: 'clinebot', available, search(request, signal) {
    const task = search(request, signal)
    pending.add(task); task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  } }
  const abort = () => { for (const controller of controllers) controller.abort() }
  const detach = () => { unregister?.(); unregister = undefined; abort(); web = undefined }
  const sync = () => {
    if (!available()) { unregister?.(); unregister = undefined; abort() }
    else if (web && !unregister) unregister = web.registerSearchProvider(provider)
  }
  ctx.inject?.(['web'], (inner) => inner.effect(() => { web = inner.web; sync(); return detach }, 'dsh-clinebot: native web search'))
  return {
    provider, sync,
    status: () => ({ enabled: live().webSearchEnabled === true, serviceAvailable: !!web, registered: !!unregister, activeRequests: pending.size }),
    async close() { stopped = true; detach(); await Promise.allSettled(pending) },
  }
}
