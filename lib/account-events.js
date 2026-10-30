import { randomUUID } from 'node:crypto'

const TYPES = new Set(['route', 'cooldown', 'recover', 'switch'])
const REASONS = new Set(['selection-change', 'model-route', 'manual-pin', 'session', 'least-used', 'round-robin', 'failover', 'expired', 'manual', 'automatic', 'credential-change', 'RATE_LIMIT', 'QUOTA', 'INSUFFICIENT_CREDITS', 'REQUEST_TOO_LARGE', 'AUTH', 'UPSTREAM_ERROR', 'CONNECT_TIMEOUT', 'FIRST_OUTPUT_TIMEOUT', 'EMPTY_RESPONSE', 'STREAM_ERROR'])

export function accountEvent(input, now = Date.now()) {
  if (!TYPES.has(input?.type) || typeof input.account !== 'string' || !input.account || input.account.length > 160) return null
  return { id: randomUUID(), at: now, type: input.type, account: input.account,
    ...(typeof input.model === 'string' && input.model.length > 0 && input.model.length <= 256 && !/[\x00-\x1f\x7f]/.test(input.model) ? { model: input.model } : {}),
    reason: REASONS.has(input.reason) ? input.reason : 'automatic',
    ...(Number.isFinite(input.until) && input.until >= now ? { until: input.until } : {}) }
}
