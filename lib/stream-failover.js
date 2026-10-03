import { PROVIDER_ID } from './models.js'
import { isRateLimitFailure, rotateToNextAccount } from './account-pool.js'

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

export async function* passThrough(stream, onRateLimit) {
  try {
    for await (const chunk of stream) {
      if (chunk?.type === 'finish' && chunk.reason?.kind === 'error' && isRateLimitFailure(chunk.reason.failure)) {
        onRateLimit(chunk.reason.failure)
      }
      yield chunk
    }
  } catch (err) {
    if (isRateLimitFailure(err)) onRateLimit(err)
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
      return passThrough(next(), () => scheduleFailover(ctx, deps))
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
