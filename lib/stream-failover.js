import { PROVIDER_ID } from './models.js'
import { isRateLimitFailure, rotateToNextAccount } from './account-pool.js'
import { recordSessionRequest } from './cline-client.js'

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
      const failover = await rotateToNextAccount(ctx, before, 'stream_429', deps.getSettingsApi())
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
      return passThrough(next(), () => scheduleFailover(ctx, deps), (chunk) => noteStreamFinish(options, chunk))
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
