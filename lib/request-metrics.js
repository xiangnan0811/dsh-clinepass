import { randomUUID } from 'node:crypto'

export const TOKEN_FIELDS = ['inputTokens', 'promptTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']
export const MEASURE_FIELDS = [...TOKEN_FIELDS, 'latencyMs', 'ttftMs']
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null
const duration = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const label = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 256) : fallback

export function smokeMetrics(outcome, { model, account, purpose = 'smoke', sessionId = '' }) {
  return { source: 'smoke', purpose, transport: 'direct', model: outcome.model || model, account, sessionId,
    ok: outcome.ok, status: outcome.status, latencyMs: outcome.latencyMs,
    usage: outcome.usage, usageFormat: 'openai', error: { code: outcome.errorCode || (outcome.ok ? '' : 'SMOKE_ERROR') } }
}

export function normalizeUsage(usage, format = 'native') {
  const result = Object.fromEntries(TOKEN_FIELDS.map((key) => [key, null]))
  if (!usage || typeof usage !== 'object') return result
  if (format === 'native') {
    for (const key of TOKEN_FIELDS) result[key] = count(usage[key])
    if ([result.inputTokens, result.cacheReadTokens, result.cacheWriteTokens].every((value) => value !== null)) result.promptTokens = result.inputTokens + result.cacheReadTokens + result.cacheWriteTokens
  } else {
    result.promptTokens = count(usage.prompt_tokens)
    result.outputTokens = count(usage.completion_tokens)
    result.cacheReadTokens = count(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens)
    result.cacheWriteTokens = count(usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_write_tokens)
    result.reasoningTokens = count(usage.completion_tokens_details?.reasoning_tokens)
    result.inputTokens = count(usage.prompt_cache_miss_tokens)
    // Standard OpenAI prompt_tokens includes cache hits. Cache creation is not
    // reported by this protocol; retain that separate counter as unknown.
    if (result.inputTokens === null && result.promptTokens !== null && result.cacheReadTokens !== null) result.inputTokens = count(result.promptTokens - result.cacheReadTokens - (result.cacheWriteTokens ?? 0))
    result.totalTokens = count(usage.total_tokens)
    if (result.totalTokens === null && result.promptTokens !== null && result.outputTokens !== null) result.totalTokens = count(result.promptTokens + result.outputTokens)
  }
  // Reasoning is a subset of output; it is never added a second time.
  return result
}

export function normalizeRequest(metrics, now = Date.now()) {
  const startedAt = duration(metrics.startedAt) ?? now - (duration(metrics.latencyMs) ?? 0)
  const attempts = (Array.isArray(metrics.attempts) ? metrics.attempts : [{ account: metrics.account, ok: metrics.ok, code: metrics.error?.code, status: metrics.status }]).map((entry) => ({
    account: label(entry.account), ok: entry.ok === true,
    code: label(typeof entry.code === 'string' && /^[\w.-]{1,80}$/.test(entry.code) ? entry.code : ''),
    status: Number.isInteger(entry.status) && entry.status >= 100 && entry.status <= 599 ? entry.status : null,
    latencyMs: duration(entry.latencyMs),
  }))
  return {
    id: randomUUID(), startedAt, completedAt: now, day: new Date(now).toISOString().slice(0, 10),
    provider: 'clinebot', model: label(metrics.model, 'unknown'), account: label(metrics.account, 'unknown') || attempts.at(-1)?.account || 'unknown',
    sessionId: label(metrics.sessionId), source: label(metrics.source, 'conversation'), purpose: label(metrics.purpose),
    transport: metrics.transport === 'proxy' || metrics.source === 'proxy' ? 'proxy' : 'direct',
    ok: metrics.ok === true, cancelled: metrics.cancelled === true || ['CANCELLED', 'ABORTED'].includes(metrics.error?.code),
    latencyMs: duration(metrics.latencyMs), ttftMs: duration(metrics.ttftMs),
    usage: normalizeUsage(metrics.usage, metrics.usageFormat || (metrics.source === 'proxy' ? 'openai' : 'native')), attempts,
  }
}

export function emptyTotals() {
  return { requests: 0, success: 0, failure: 0, cancelled: 0, attempts: 0, rateLimits: 0,
    measurements: Object.fromEntries(MEASURE_FIELDS.map((field) => [field, { sum: 0, samples: 0 }])) }
}

export function addTotals(target, source) {
  for (const key of ['requests', 'success', 'failure', 'cancelled', 'attempts', 'rateLimits']) target[key] += source[key]
  for (const key of MEASURE_FIELDS) {
    target.measurements[key].sum += source.measurements[key].sum
    target.measurements[key].samples += source.measurements[key].samples
  }
  return target
}

export function requestTotals(record) {
  const totals = emptyTotals()
  totals.requests = 1
  totals.success = record.ok ? 1 : 0
  totals.failure = record.ok ? 0 : 1
  totals.cancelled = record.cancelled ? 1 : 0
  totals.attempts = record.attempts.length
  totals.rateLimits = record.attempts.filter((entry) => entry.status === 429 || entry.status === 402 || entry.code === 'RATE_LIMIT' || entry.code === 'QUOTA').length
  for (const field of MEASURE_FIELDS) {
    const value = field in record.usage ? record.usage[field] : record[field]
    if (value !== null) totals.measurements[field] = { sum: value, samples: 1 }
  }
  return totals
}

export const GROUP_FIELDS = ['day', 'model', 'account', 'source', 'purpose', 'transport']
export const groupKey = (row) => JSON.stringify(GROUP_FIELDS.map((field) => row[field]))

export function aggregateRows(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = groupKey(row)
    if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(GROUP_FIELDS.map((field) => [field, row[field]])), totals: emptyTotals() })
    addTotals(groups.get(key).totals, row.totals)
  }
  return [...groups.values()]
}
