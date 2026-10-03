/**
 * ClineBot / ClinePass client helpers for DeepSeek Harness.
 *
 * Implements OpenAI-compatible chat completions interface, usage quota tracking,
 * Stale-While-Revalidate caching, smart failover, and secure credential storage.
 */

import { createHash } from 'node:crypto'
import {
  DEFAULT_MODEL_ID,
  PROVIDER_ID,
  PROVIDER_DISPLAY_NAME,
  clearPlanDiscovery,
  getAllModels,
  parsePlanIncludedModels,
  planDiscoveryDirty,
} from './models.js'
import { buildProviderPayload } from './provider-payload.js'

export const DEFAULT_BASE_URL = 'https://api.cline.bot/api/v1'
export const DEFAULT_API_KEY_ENV = 'CLINEBOT_API_KEY'
export const DEFAULT_TIMEOUT_MS = 15000
export const DEFAULT_SMOKE_TIMEOUT_MS = 25000
export const USAGE_CACHE_TTL_MS = 60000

export { PROVIDER_ID, PROVIDER_DISPLAY_NAME, DEFAULT_MODEL_ID }

/**
 * Resolve or fallback credential reference descriptor.
 */
export async function toCredentialRef(name) {
  try {
    const mod = await import('@deepseek-ai/dsh-credentials')
    if (typeof mod.credentialRef === 'function') {
      return mod.credentialRef(name)
    }
  } catch {
    /* fallback when executed in standalone unit tests outside DSH bundle */
  }
  return typeof name === 'object' && name !== null ? name : { type: 'env', name: String(name || '') }
}

/** Plan reads belong to one API address, primary credential name, and pin. */
export function catalogIdentity(cfg = {}) {
  return {
    baseUrl: normalizeBaseUrl(cfg.baseUrl),
    apiKeyEnv: String(cfg.apiKeyEnv || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV,
    activeAccount: String(cfg.activeAccount || '').trim(),
  }
}

export function sameCatalogIdentity(left, right) {
  return !!left && !!right
    && left.baseUrl === right.baseUrl
    && left.apiKeyEnv === right.apiKeyEnv
    && left.activeAccount === right.activeAccount
}

/** Keep the plan list when the address, primary name, and pin are unchanged. */
export function applyCatalogIdentity(previous, next) {
  if (sameCatalogIdentity(catalogIdentity(previous), catalogIdentity(next))) return next
  return clearPlanDiscovery(next)
}

/**
 * First observation records the current identity and does not clear.
 * A later change clears only while a previous plan read is still stored.
 */
export function catalogChange(seen, cfg) {
  const next = catalogIdentity(cfg)
  const changed = !!seen && !sameCatalogIdentity(seen, next)
  const reset = changed && planDiscoveryDirty(cfg)
  return { seen: next, changed, reset, config: reset ? clearPlanDiscovery(cfg) : cfg }
}

/** Normalize base URL ensuring clean format without trailing slashes. */
export function normalizeBaseUrl(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '')
  if (!s) return DEFAULT_BASE_URL
  s = s.replace(/\/chat\/completions$/i, '')
  if (s === 'https://api.cline.bot' || s === 'http://api.cline.bot') {
    s += '/api/v1'
  }
  return s
}

const REQUEST_HISTORY_LIMIT = 100
const requestHistory = []

// In-memory runtime session metrics for ClinePass requests
export const sessionStats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  promptTokensEst: 0,
  completionTokensEst: 0,
  totalTokensEst: 0,
  lastLatencyMs: null,
  lastRequestAt: null,
  lastError: null,
}

export function recordSessionRequest({
  latencyMs,
  ok,
  error,
  promptTokens = 0,
  completionTokens = 0,
  model = '',
  upstream = '',
  reason = '',
} = {}) {
  sessionStats.totalRequests += 1
  if (ok) {
    sessionStats.successfulRequests += 1
    if (typeof latencyMs === 'number') sessionStats.lastLatencyMs = latencyMs
    sessionStats.lastError = null
  } else {
    sessionStats.failedRequests += 1
    sessionStats.lastError = error || 'Request failed'
  }
  sessionStats.lastRequestAt = Date.now()
  sessionStats.promptTokensEst += Number(promptTokens) || 0
  sessionStats.completionTokensEst += Number(completionTokens) || 0
  sessionStats.totalTokensEst += (Number(promptTokens) || 0) + (Number(completionTokens) || 0)
  requestHistory.push({
    at: sessionStats.lastRequestAt,
    model: typeof model === 'string' ? model : '',
    ok: Boolean(ok),
    reason: ok ? '' : String(reason || '').slice(0, 40),
    upstream: typeof upstream === 'string' ? upstream.trim().slice(0, 80) : '',
  })
  if (requestHistory.length > REQUEST_HISTORY_LIMIT) requestHistory.shift()
}

/** Keep the first character of the local part and the domain. Anything else stays off the page. */
export function maskAccountEmail(email) {
  const value = String(email || '').trim()
  const at = value.indexOf('@')
  if (at <= 0 || at === value.length - 1) return ''
  return `${value.slice(0, 1)}•••@${value.slice(at + 1)}`
}

/**
 * Copy a usage payload for the settings card.
 * `email` is the masked address. `emailFull` is the original, so the card can
 * reveal it. The cache object itself is not changed. `/cline` prints only the mask.
 */
export function presentUsage(usage) {
  if (!usage || typeof usage !== 'object') return usage
  if (!usage.user) return { ...usage }
  const emailFull = String(usage.user.email || '').trim()
  return {
    ...usage,
    user: {
      ...usage.user,
      email: maskAccountEmail(emailFull) || null,
      emailFull: emailFull || null,
    },
  }
}

/**
 * Public plan label. Names containing `[Internal]` are skipped.
 * A missing public name keeps the historical fallback, including its price text.
 */
export function readPlanPresentation(plan) {
  const candidates = [plan?.displayName, plan?.title, plan?.name]
  let chosen = ''
  for (const item of candidates) {
    const text = typeof item === 'string' ? item.trim() : ''
    if (text && !text.includes('[Internal]')) {
      chosen = text
      break
    }
  }
  let label = 'ClinePass ($9.99/mo)'
  if (chosen) {
    const cents = Number(plan?.pricePerSeatCents || plan?.priceInCents || 999)
    const price = Number.isFinite(cents) ? (cents / 100).toFixed(2) : '9.99'
    label = `${chosen} ($${price}/mo)`
  }
  const stamp = [plan?.canceledAt, plan?.cancelAt].find((item) => typeof item === 'string' && item.trim())
  return {
    label,
    canceledAt: stamp ? stamp.trim() : '',
    cancelAtPeriodEnd: plan?.cancelAtPeriodEnd === true,
  }
}

export function resetSessionStats() {
  sessionStats.totalRequests = 0
  sessionStats.successfulRequests = 0
  sessionStats.failedRequests = 0
  sessionStats.promptTokensEst = 0
  sessionStats.completionTokensEst = 0
  sessionStats.totalTokensEst = 0
  sessionStats.lastLatencyMs = null
  sessionStats.lastRequestAt = null
  sessionStats.lastError = null
  requestHistory.length = 0
}

export function recentRequests(limit = 5) {
  const count = Math.max(0, Number(limit) || 0)
  return requestHistory.slice(-count).map((entry) => ({ ...entry }))
}

/**
 * Resolve API key from environment variables.
 */
export function resolveApiKey(apiKeyEnv, env = process.env) {
  const name = String(apiKeyEnv || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV
  return {
    envName: name,
    value: String(env[name] || ''),
  }
}

/**
 * Save API key directly into DSH credentials service (~/.dsh/.credentials.yaml).
 */
export async function saveCredentialKey(ctx, apiKeyEnv, apiKey) {
  const name = String(apiKeyEnv || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV
  const value = String(apiKey || '').trim()

  if (!value) {
    throw new Error('API key cannot be empty')
  }

  const credentials = ctx?.credentials || ctx?.get?.('credentials')
  if (!credentials || typeof credentials.set !== 'function') {
    throw new Error('DSH credentials service is unavailable in this runtime profile')
  }

  const ref = await toCredentialRef(name)
  try {
    await credentials.set(ref, value)
  } catch (err) {
    throw new Error(explainCredentialWriteError(err, name))
  }
  return { ok: true, envName: name }
}

export function explainCredentialWriteError(err, name) {
  const message = String(err?.message || err)
  if (/launching environment/i.test(message) || /shadowed/i.test(message)) {
    return `无法把密钥写入 ${name}：启动 dsh 的终端已经设置了同名环境变量，DSH 会用它盖住界面里的保存。请在那个终端执行 unset ${name}，重新启动 dsh，再保存密钥。`
  }
  return message
}

function abortAfter(ms) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), Math.max(1, Number(ms) || DEFAULT_TIMEOUT_MS))
  if (typeof timer.unref === 'function') timer.unref()
  return { signal: ac.signal, cancel: () => clearTimeout(timer) }
}

// In-memory caches for quota queries and host health probes
export const MAX_CACHE_ENTRIES = 50
export const usageCache = new Map()
export const probeCache = new Map()

export function setBoundedCache(map, key, value, maxEntries = MAX_CACHE_ENTRIES) {
  if (map.size >= maxEntries) {
    const now = Date.now()
    for (const [k, v] of map.entries()) {
      if (v.expiresAt && v.expiresAt < now) {
        map.delete(k)
      }
    }
    if (map.size >= maxEntries) {
      const oldestKey = map.keys().next().value
      if (oldestKey) map.delete(oldestKey)
    }
  }
  map.set(key, value)
}

export function clearProbeCache() {
  probeCache.clear()
}

export function clearUsageCache() {
  usageCache.clear()
}

/** Separate quota entries by address and the whole credential, without keeping the secret in the map key. */
export function usageCacheKey(baseUrl, apiKey) {
  const material = `${normalizeBaseUrl(baseUrl)}\0${String(apiKey || '')}`
  return `cline:usage:${createHash('sha256').update(material).digest('hex')}`
}

/**
 * Resilient retry runner for transient network errors (ECONNRESET, ETIMEDOUT, 502, 503, 504, 429).
 */
export async function retryWithBackoff(fn, {
  maxRetries = 3,
  initialDelayMs = 500,
  maxDelayMs = 5000,
} = {}) {
  let attempt = 0
  let delay = initialDelayMs
  while (true) {
    try {
      const res = await fn()
      if (res && typeof res.status === 'number' && [429, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
        attempt++
        const retryAfter = res.headers?.get ? Number(res.headers.get('retry-after')) * 1000 : 0
        const waitTime = retryAfter > 0 ? Math.min(retryAfter, maxDelayMs) : delay
        await new Promise((r) => setTimeout(r, waitTime))
        delay = Math.min(delay * 2, maxDelayMs)
        continue
      }
      return res
    } catch (err) {
      if (attempt < maxRetries) {
        attempt++
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, maxDelayMs)
        continue
      }
      throw err
    }
  }
}

/**
 * Fetch official ClinePass rate limits and account quota.
 * Uses Stale-While-Revalidate (SWR) caching with keep-alive and network retry.
 */
export async function fetchUsageLimits(baseUrl, apiKey, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  bypassCache = false,
  ttlMs = USAGE_CACHE_TTL_MS,
  remember = true,
} = {}) {
  const base = normalizeBaseUrl(baseUrl)
  if (!apiKey) {
    return { ok: false, error: 'API key is missing' }
  }

  const cacheKey = usageCacheKey(base, apiKey)
  const now = Date.now()
  const storeUsage = (entry) => {
    if (remember === false) return
    setBoundedCache(usageCache, cacheKey, entry)
  }

  const doFetch = async () => {
    const { signal, cancel } = abortAfter(timeoutMs)
    try {
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      }

      let limitsRes
      try {
        limitsRes = await fetchImpl(`${base}/users/me/plan/usage-limits`, {
          method: 'GET',
          headers,
          signal,
          keepalive: true,
        })
      } catch (netErr) {
        if (signal?.aborted || netErr?.name === 'AbortError') throw netErr
        // Quick 1-retry fallback on transient network drop
        await new Promise((r) => setTimeout(r, 250))
        if (signal?.aborted || netErr?.name === 'AbortError') throw netErr
        limitsRes = await fetchImpl(`${base}/users/me/plan/usage-limits`, {
          method: 'GET',
          headers,
          signal,
          keepalive: true,
        })
      }

      if (!limitsRes.ok) {
        const errText = await limitsRes.text().catch(() => '')
        const outcome = {
          ok: false,
          status: limitsRes.status,
          error: `ClinePass limits error (HTTP ${limitsRes.status}): ${errText.slice(0, 150)}`,
          checkedAt: Date.now(),
        }
        if (remember !== false && !usageCache.has(cacheKey)) {
          usageCache.set(cacheKey, { data: outcome, expiresAt: Date.now() + 5000, isRevalidating: false })
        }
        return outcome
      }

      const limitsData = await limitsRes.json().catch(() => ({}))
      const rawLimits = limitsData?.data?.limits || limitsData?.limits || []

      const parseWindow = (found) => {
        if (!found) return null
        const percentUsed = typeof found.percentUsed === 'number'
          ? Math.max(0, Math.min(100, Math.round(found.percentUsed * 10) / 10))
          : 0
        const remainingPercent = Math.max(0, Math.round((100 - percentUsed) * 10) / 10)
        return {
          type: found.type,
          percentUsed,
          remainingPercent,
          resetsAt: found.resetsAt || null,
        }
      }

      const byKind = new Map()
      for (const item of Array.isArray(rawLimits) ? rawLimits : []) {
        const kind = limitKind(item?.type)
        if (kind && !byKind.has(kind)) byKind.set(kind, item)
      }
      const fiveHour = parseWindow(byKind.get('fiveHour'))
      const weekly = parseWindow(byKind.get('weekly'))
      const monthly = parseWindow(byKind.get('monthly'))

      let userEmail = null
      let createdAt = null
      let planDisplayName = 'ClinePass ($9.99/mo)'
      let canceledAt = ''
      let cancelAtPeriodEnd = false
      let dynamicModels = []

      try {
        const [meRes, planRes] = await Promise.all([
          fetchImpl(`${base}/users/me`, { method: 'GET', headers, signal, keepalive: true }).catch(() => null),
          fetchImpl(`${base}/users/me/plan`, { method: 'GET', headers, signal, keepalive: true }).catch(() => null),
        ])

        if (meRes?.ok) {
          const meData = await meRes.json().catch(() => ({}))
          userEmail = meData?.data?.email || meData?.email || null
          createdAt = meData?.data?.createdAt || meData?.createdAt || null
        }

        if (planRes?.ok) {
          const planData = await planRes.json().catch(() => ({}))
          const plan = planData?.data?.plan || planData?.data || planData?.plan || planData
          const presentation = readPlanPresentation(plan)
          planDisplayName = presentation.label
          canceledAt = presentation.canceledAt
          cancelAtPeriodEnd = presentation.cancelAtPeriodEnd
          const featuresIncluded = plan?.features?.included || plan?.includedModels
          if (featuresIncluded) {
            dynamicModels = parsePlanIncludedModels(featuresIncluded)
          }
        }
      } catch {
        /* best-effort secondary details */
      }

      const result = {
        ok: true,
        plan: planDisplayName,
        canceledAt,
        cancelAtPeriodEnd,
        user: { email: userEmail, createdAt },
        windows: { fiveHour, weekly, monthly },
        dynamicModels,
        checkedAt: Date.now(),
      }

      storeUsage({ data: result, expiresAt: Date.now() + ttlMs, isRevalidating: false })
      return result
    } catch (err) {
      const outcome = {
        ok: false,
        error: String(err?.message || err),
        checkedAt: Date.now(),
      }
      if (remember !== false && !usageCache.has(cacheKey)) {
        storeUsage({ data: outcome, expiresAt: Date.now() + 5000, isRevalidating: false })
      } else {
        const existing = usageCache.get(cacheKey)
        if (existing) existing.isRevalidating = false
      }
      return outcome
    } finally {
      const existing = usageCache.get(cacheKey)
      if (existing) existing.isRevalidating = false
      cancel()
    }
  }

  if (remember !== false && !bypassCache && usageCache.has(cacheKey)) {
    const cached = usageCache.get(cacheKey)
    if (cached.expiresAt > now) {
      return cached.data
    }
    // SWR: return stale data immediately, revalidate asynchronously
    if (!cached.isRevalidating) {
      cached.isRevalidating = true
      doFetch().catch(() => {})
    }
    return cached.data
  }

  return doFetch()
}

function usageWindowBrief(window) {
  if (!window) return null
  return {
    percentUsed: typeof window.percentUsed === 'number' ? window.percentUsed : null,
    resetsAt: window.resetsAt || null,
  }
}

function accountUsageRow(slot, usage) {
  const rawEmail = String(usage?.user?.email || '').trim()
  const shown = presentUsage(usage) || {}
  return {
    label: slot?.label || '',
    apiKeyEnv: slot?.apiKeyEnv || '',
    isPinned: Boolean(slot?.isPinned),
    ok: shown?.ok === true,
    error: shown?.ok ? '' : String(shown?.error || 'usage request failed').slice(0, 180),
    plan: shown?.plan || '',
    canceledAt: shown?.canceledAt || '',
    cancelAtPeriodEnd: shown?.cancelAtPeriodEnd === true,
    email: shown?.ok ? (shown.user?.email || '') : '',
    emailFull: shown?.ok ? rawEmail : '',
    windows: {
      fiveHour: usageWindowBrief(shown?.windows?.fiveHour),
      weekly: usageWindowBrief(shown?.windows?.weekly),
      monthly: usageWindowBrief(shown?.windows?.monthly),
    },
  }
}

/**
 * Quota rows for saved keys. This read does not fill the failover cache.
 * The active key may reuse a fresh cache entry from the status request.
 */
export async function collectAccountUsage(slots, {
  baseUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  activeEnv = '',
  fresh = false,
  fetchImpl,
} = {}) {
  const present = (Array.isArray(slots) ? slots : []).filter((slot) => slot?.present && slot?.value)
  const results = new Array(present.length)
  let cursor = 0

  async function oneAccount(slot) {
    try {
      const cacheKey = usageCacheKey(baseUrl, slot.value)
      const cached = usageCache.get(cacheKey)
      const reuse = !fresh && slot.apiKeyEnv === activeEnv && cached && cached.expiresAt > Date.now() && cached.data
      const usage = reuse
        ? cached.data
        : await fetchUsageLimits(baseUrl, slot.value, {
          timeoutMs,
          fetchImpl,
          remember: false,
          bypassCache: true,
        })
      return accountUsageRow(slot, usage)
    } catch (err) {
      return accountUsageRow(slot, { ok: false, error: String(err?.message || err) })
    }
  }

  async function worker() {
    while (cursor < present.length) {
      const index = cursor
      cursor += 1
      results[index] = await oneAccount(present[index])
    }
  }

  const workers = Math.min(2, present.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

/**
 * Health check probe with SWR caching.
 */
export async function probeHealth(baseUrl, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  bypassCache = false,
  ttlMs = 25000,
} = {}) {
  const base = normalizeBaseUrl(baseUrl)
  const root = base.replace(/\/api\/v1$/i, '')
  const cacheKey = `cline:health:${root}`
  const now = Date.now()

  const doProbe = async () => {
    const { signal, cancel } = abortAfter(timeoutMs)
    const start = Date.now()
    try {
      const res = await retryWithBackoff(async () => {
        return await fetchImpl(root, { method: 'HEAD', signal, keepalive: true })
      })
      const latencyMs = Date.now() - start
      const reachable = res.status > 0 && res.status < 500
      const outcome = {
        ok: reachable,
        status: res.status,
        latencyMs,
        error: reachable ? null : `HTTP status ${res.status}`,
        checkedAt: Date.now(),
      }
      setBoundedCache(probeCache, cacheKey, { data: outcome, expiresAt: Date.now() + ttlMs, isRevalidating: false })
      return outcome
    } catch (err) {
      const latencyMs = Date.now() - start
      const outcome = {
        ok: false,
        latencyMs,
        error: String(err?.message || err),
        checkedAt: Date.now(),
      }
      if (!probeCache.has(cacheKey)) {
        setBoundedCache(probeCache, cacheKey, { data: outcome, expiresAt: Date.now() + 5000, isRevalidating: false })
      } else {
        const existing = probeCache.get(cacheKey)
        if (existing) existing.isRevalidating = false
      }
      return outcome
    } finally {
      const existing = probeCache.get(cacheKey)
      if (existing) existing.isRevalidating = false
      cancel()
    }
  }

  if (!bypassCache && probeCache.has(cacheKey)) {
    const cached = probeCache.get(cacheKey)
    if (cached.expiresAt > now) {
      return cached.data
    }
    if (!cached.isRevalidating) {
      cached.isRevalidating = true
      doProbe().catch(() => {})
    }
    return cached.data
  }

  return doProbe()
}

/**
 * Non-streaming lightweight chat completion to verify credentials and endpoint latency.
 */
export function limitKind(type) {
  const name = String(type || '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (name === '5-hour' || name === '5h' || name === 'five-hour') return 'fiveHour'
  if (name === 'weekly' || name === 'week') return 'weekly'
  if (name === 'monthly' || name === 'month') return 'monthly'
  return ''
}

export function smokeRequestBody(model) {
  const id = model || DEFAULT_MODEL_ID
  const body = {
    model: id,
    messages: [{ role: 'user', content: 'Reply with the single word pong.' }],
    max_tokens: 256,
    stream: false,
  }
  // Muse Spark always reasons. A 150-token cap is spent before any visible
  // text, and the gateway then returns 500 "empty response content".
  // reasoning_effort "none" is rejected for this model.
  if (/muse-spark/i.test(id)) {
    body.max_tokens = 1024
    body.reasoning_effort = 'low'
  }
  return body
}

function messageText(message) {
  if (!message || typeof message !== 'object') return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
  }
  if (typeof message.reasoning_content === 'string') return message.reasoning_content
  if (typeof message.reasoning === 'string') return message.reasoning
  return ''
}

export async function smokeChat(baseUrl, apiKey, {
  model = DEFAULT_MODEL_ID,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const base = normalizeBaseUrl(baseUrl)
  const upstream = `${base}/chat/completions`
  if (!apiKey) {
    return { ok: false, upstream, error: 'Missing API key. Set credential or environment variable.' }
  }

  const { signal, cancel } = abortAfter(timeoutMs)
  const start = Date.now()
  try {
    const res = await fetchImpl(upstream, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(smokeRequestBody(model)),
      signal,
      keepalive: true,
    })

    const latencyMs = Date.now() - start
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const errorMsg = data?.error?.message || (typeof data?.error === 'string' ? data.error : null) || data?.message || `HTTP ${res.status}`
      return {
        ok: false,
        status: res.status,
        latencyMs,
        upstream,
        error: errorMsg,
      }
    }

    const payload = data?.data && typeof data.data === 'object' ? data.data : data
    const content = messageText(payload?.choices?.[0]?.message)
    const promptTokens = Number(data?.usage?.prompt_tokens) || Number(payload?.usage?.prompt_tokens) || 0
    const completionTokens = Number(data?.usage?.completion_tokens) || Number(payload?.usage?.completion_tokens) || 0
    const totalTokens = Number(data?.usage?.total_tokens) || Number(payload?.usage?.total_tokens) || (promptTokens + completionTokens)
    return {
      ok: true,
      status: res.status,
      latencyMs,
      upstream,
      model: payload?.model || model,
      preview: typeof content === 'string' ? content.trim().slice(0, 150) : 'OK',
      promptTokens,
      completionTokens,
      totalTokens,
    }
  } catch (err) {
    const latencyMs = Date.now() - start
    return {
      ok: false,
      latencyMs,
      upstream,
      error: String(err?.message || err),
    }
  } finally {
    cancel()
  }
}

/**
 * Shape for llm-pi-ai.providers.clinebot (openai-completions).
 */
export function buildPiAiProvider({
  baseUrl = DEFAULT_BASE_URL,
  apiKeyEnv = DEFAULT_API_KEY_ENV,
  models,
  customModels = [],
  displayName = PROVIDER_DISPLAY_NAME,
  existing = null,
  providerReasoning = '',
} = {}) {
  const catalogCfg = Array.isArray(customModels) ? { dynamicModels: customModels } : (customModels || {})
  const available = getAllModels(catalogCfg)
  const chosen = models === undefined
    ? available
    : (Array.isArray(models) ? models : []).map((item) => (typeof item === 'string' ? available.find((model) => model.id === item) : item)).filter(Boolean)
  return buildProviderPayload({
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKeyEnv: apiKeyEnv || DEFAULT_API_KEY_ENV,
    models: chosen,
    displayName,
    existing,
    providerReasoning,
  }).payload
}

/**
 * Safely resolve key value from DSH credentials service or process.env.
 */
export async function resolveKeyValue(ctx, apiKeyEnv) {
  const refName = String(apiKeyEnv || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV
  const creds = (ctx?.get && ctx.get('credentials')) || ctx?.credentials
  if (creds && typeof creds.resolve === 'function') {
    try {
      const ref = await toCredentialRef(refName)
      const hit = await creds.resolve(ref)
      if (hit?.value) {
        return { envName: refName, value: hit.value, source: 'credentials' }
      }
    } catch {
      /* miss */
    }
  }

  const fromEnv = resolveApiKey(refName)
  if (fromEnv.value) {
    return { ...fromEnv, source: 'env' }
  }

  return { envName: refName, value: '', source: 'none' }
}


export { resolveAccountPool, isAccountQuotaExhausted, rotateToNextAccount } from './account-pool.js'
