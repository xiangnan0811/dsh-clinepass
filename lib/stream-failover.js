import { PROVIDER_ID } from './models.js'
import { isRateLimitFailure, rotateToNextAccount } from './account-pool.js'
import { recordSessionRequest } from './cline-client.js'
import { activeCredentialEnv } from './account-pool.js'

function upstreamName(chunk) {
  const candidates = [
    chunk?.provider,
    chunk?.upstream,
    chunk?.providerMetadata?.gateway?.routing?.finalProvider,
    chunk?.provider_metadata?.gateway?.routing?.finalProvider,
  ]
  const found = candidates.find((item) => typeof item === 'string' && item.trim())
  return found ? found.trim() : ''
}

function noteStreamFinish(options, chunk) {
  const failed = chunk?.reason?.kind === 'error'
  recordSessionRequest({
    ok: !failed,
    reason: typeof chunk?.reason?.kind === 'string' ? chunk.reason.kind : '',
    model: typeof options?.model === 'string' ? options.model : '',
    upstream: upstreamName(chunk),
  })
}

const FAILOVER_GAP_MS = 30_000
let lastFailoverAt = 0

export function resetFailoverClock() {
  lastFailoverAt = 0
}

export function releaseFailoverSlot() {
  lastFailoverAt = 0
}

export function claimFailoverSlot(now = Date.now()) {
  if (now - lastFailoverAt < FAILOVER_GAP_MS) return false
  lastFailoverAt = now
  return true
}

export async function* passThrough(stream, onRateLimit, onFinish) {
  let sawFinish = false
  const finish = (chunk) => {
    try {
      onFinish?.(chunk)
    } catch {
      /* a history note must not change the stream */
    }
  }
  try {
    for await (const chunk of stream) {
      if (chunk?.type === 'finish') {
        sawFinish = true
        if (chunk.reason?.kind === 'error' && isRateLimitFailure(chunk.reason.failure)) {
          onRateLimit(chunk.reason.failure)
        }
        finish(chunk)
      }
      yield chunk
    }
  } catch (err) {
    if (isRateLimitFailure(err)) onRateLimit(err)
    if (!sawFinish) finish({ type: 'finish', reason: { kind: 'error' } })
    throw err
  }
}

function scheduleFailover(ctx, deps) {
  if (!claimFailoverSlot()) return
  void (async () => {
    try {
      const before = deps.live()
      const failover = await rotateToNextAccount(ctx, before, 'stream_429', deps.getSettingsApi(), deps.live)
      if (failover?.rotated && typeof deps.syncProviderState === 'function') {
        await deps.syncProviderState(failover.config || { ...deps.live(), activeAccount: failover.activeAccount })
      } else if (failover?.reason === 'failed_to_persist') {
        releaseFailoverSlot()
      }
    } catch (err) {
      releaseFailoverSlot()
      ctx?.logger?.warn?.(`[dsh-clinebot] account failover failed: ${err?.message || err}`)
    }
  })()
}

export function attachStreamFailover(ctx, deps) {
  if (typeof ctx?.on !== 'function') return () => {}
  let unlisten = () => {}
  try {
    unlisten = ctx.on('llm/stream', (options, next) => {
      if (typeof next !== 'function' || options?.provider !== PROVIDER_ID) {
        return typeof next === 'function' ? next() : undefined
      }
      // The proxy owns retry attempts and routing; a proxy failure must not
      // mutate the global account pin or multiply the host's retry policy.
      const cfg = deps.live()
      const metadata = () => deps.dispatchMetadata?.get(options) || { transport: cfg.proxyEnabled ? 'proxy' : 'direct', account: activeCredentialEnv(cfg), source: deps.probeRequests?.has(options) ? 'probe' : 'conversation' }
      const stream = passThrough(next(), () => { if (metadata().transport !== 'proxy' && metadata().source !== 'probe') scheduleFailover(ctx, deps) }, (chunk) => { if (metadata().transport !== 'proxy') noteStreamFinish(options, chunk) })
      return deps.recordMetrics ? measureStream(stream, options, metadata, deps.recordMetrics) : stream
    }, { global: true }) || (() => {})
  } catch (err) {
    ctx?.logger?.warn?.(`[dsh-clinebot] stream failover was not attached: ${err?.message || err}`)
    return () => {}
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      try { unlisten?.() } catch { /* slot already disposed */ }
    }, 'dsh-clinebot: stream failover')
  }
  return typeof unlisten === 'function' ? unlisten : () => {}
}

/** One native dispatch, including its usage and final result, is one request. */
export async function* measureStream(stream, options, metadata, record) {
  const startedAt = Date.now()
  let usage, finish, ttftMs = null, thrown
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'usage') usage = chunk.usage
      if (chunk.type === 'finish') finish = chunk
      if (ttftMs === null && ((['text-delta', 'reasoning-delta'].includes(chunk.type) && chunk.text) || (chunk.type === 'tool-call-delta' && (chunk.name || chunk.argumentsDelta)))) ttftMs = Date.now() - startedAt
      yield chunk
    }
  } catch (error) { thrown = error; throw error }
  finally {
    const reason = finish?.reason
    const cancelled = reason?.kind === 'aborted' || options.signal?.aborted || (!finish && !thrown)
    const route = metadata()
    // Recording must not replace a provider failure or cancellation.
    try { if (route.transport !== 'proxy') Promise.resolve(record({ source: route.source || 'conversation', transport: 'direct', model: options.model, sessionId: options.sessionId,
      purpose: options.purpose, account: route.account, startedAt, latencyMs: Date.now() - startedAt, ttftMs,
      upstreamPin: route.upstreamPin, upstream: route.upstream, upstreamPinAttached: route.upstreamPinAttached, routingEvidence: route.routingEvidence,
      usage: route.usageFormat ? route.wireUsage : usage, usageFormat: route.usageFormat,
      ok: !!finish && !['error', 'aborted'].includes(reason?.kind), cancelled,
      error: { code: reason?.failure?.code || thrown?.code || (cancelled ? 'CANCELLED' : 'STREAM_ERROR') },
      attempts: [{ account: route.account, ok: !!finish && !['error', 'aborted'].includes(reason?.kind), code: reason?.failure?.code || thrown?.code,
        upstreamPin: route.upstreamPin, upstream: route.upstream, upstreamPinAttached: route.upstreamPinAttached, routingEvidence: route.routingEvidence,
        status: reason?.failure?.status, latencyMs: Date.now() - startedAt }],
    })).catch(() => {}) } catch { /* storage reports its own status */ }
  }
}
