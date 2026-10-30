import { createHash } from 'node:crypto'

export const MAX_SESSIONS = 1000
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_COOLDOWNS = 4096
const cooldownKey = (account, model = '') => JSON.stringify([account, model])
const modelScope = model => typeof model === 'string' && model.length <= 256 && !/[\x00-\x1f\x7f]/.test(model) ? model : ''

const identity = (account, baseUrl) => createHash('sha256').update(`${baseUrl}\0${account.value}`).digest('hex')

export function createSessionRouter({ now = Date.now, maxSessions = MAX_SESSIONS, ttlMs = SESSION_TTL_MS, onEvent = () => {} } = {}) {
  const sessions = new Map()
  const cooldowns = new Map()
  let identities = new Map()
  let policy = ''
  let generation = 0
  let cursor = 0

  function prune() {
    const time = now()
    for (const [key, session] of sessions) if (time - session.lastUsedAt >= ttlMs) sessions.delete(key)
    while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value)
    for (const [key, cooldown] of cooldowns) if (cooldown.until <= time) { cooldowns.delete(key); onEvent({ type: 'recover', account: cooldown.account, model: cooldown.model, reason: 'expired' }) }
  }

  function bind(sessionId, account, expectedGeneration) {
    if (!sessionId || expectedGeneration !== generation || !identities.has(account.apiKeyEnv)) return
    sessions.delete(sessionId)
    sessions.set(sessionId, { account: account.apiKeyEnv, lastUsedAt: now() })
    prune()
  }

  function sync({ accounts, baseUrl, activeAccount = '', strategy = 'least-used', modelRoutes = [], modelIds }) {
    const nextPolicy = JSON.stringify([baseUrl, activeAccount, strategy, modelRoutes, modelIds])
    const nextIdentities = new Map(accounts.filter(account => account.present && account.value).map(account => [account.apiKeyEnv, identity(account, baseUrl)]))
    let changed = nextPolicy !== policy || nextIdentities.size !== identities.size
    const invalid = new Set([...identities.keys()].filter(key => identities.get(key) !== nextIdentities.get(key)))
    const knownModels = Array.isArray(modelIds) ? new Set(modelIds) : null
    for (const [key, entry] of cooldowns) if (invalid.has(entry.account) || entry.model && knownModels && !knownModels.has(entry.model)) {
      cooldowns.delete(key); onEvent({ type: 'recover', account: entry.account, model: entry.model, reason: invalid.has(entry.account) ? 'credential-change' : 'automatic' })
    }
    for (const [key, session] of sessions) if (nextPolicy !== policy || invalid.has(session.account)) sessions.delete(key)
    if (invalid.size) changed = true
    if (changed) generation++
    identities = nextIdentities
    policy = nextPolicy
    prune()
  }

  return {
    sync,
    plan({ accounts, baseUrl, sessionId = '', model = '', activeAccount = '', strategy = 'least-used', modelRoutes = [], modelIds }) {
      sync({ accounts, baseUrl, activeAccount, strategy, modelRoutes, modelIds })
      model = modelScope(model)
      const available = accounts.filter((account) => identities.has(account.apiKeyEnv)
        && cooldowns.size < MAX_COOLDOWNS && !cooldowns.has(cooldownKey(account.apiKeyEnv)) && !cooldowns.has(cooldownKey(account.apiKeyEnv, model)))
      let ordered = [...available]
      if (strategy === 'round-robin' && ordered.length) {
        const routed = modelRoutes.find((route) => route.model === model)?.account
        const sticky = sessionId ? sessions.get(sessionId)?.account : ''
        const explicit = [routed, activeAccount, sticky].some((key) => key && available.some((account) => account.apiKeyEnv === key))
        const start = cursor % ordered.length
        if (!explicit) cursor++
        ordered = [...ordered.slice(start), ...ordered.slice(0, start)]
      } else {
        // Unknown is kept unknown and ordered after measured quota, without an
        // invented percentage. Stable ties preserve the configured pool order.
        ordered.sort((a, b) => (Number.isFinite(a.percentUsed) ? a.percentUsed : Infinity) - (Number.isFinite(b.percentUsed) ? b.percentUsed : Infinity))
      }
      const routed = modelRoutes.find((route) => route.model === model)?.account
      const sticky = sessionId ? sessions.get(sessionId)?.account : ''
      const preferred = [routed, activeAccount, sticky].find((key) => key && available.some((account) => account.apiKeyEnv === key))
      if (preferred) ordered = [available.find((account) => account.apiKeyEnv === preferred), ...ordered.filter((account) => account.apiKeyEnv !== preferred)]
      const capturedGeneration = generation
      const reason = preferred === routed && routed ? 'model-route' : preferred === activeAccount && activeAccount ? 'manual-pin' : preferred === sticky && sticky ? 'session' : strategy
      if (ordered[0] && ordered[0].apiKeyEnv !== sticky) onEvent({ type: 'route', account: ordered[0].apiKeyEnv, reason })
      if (ordered[0]) bind(sessionId, ordered[0], capturedGeneration)
      return {
        accounts: ordered,
        reason,
        commit(account) {
          if (capturedGeneration === generation && account.apiKeyEnv !== ordered[0]?.apiKeyEnv) onEvent({ type: 'route', account: account.apiKeyEnv, reason: 'failover' })
          bind(sessionId, account, capturedGeneration)
        },
        fail(account, { code, retryAfterMs = 60000 }) {
          if (capturedGeneration !== generation || !identities.has(account.apiKeyEnv)) return
          prune()
          const scopedModel = code === 'INSUFFICIENT_CREDITS' ? model : ''
          const key = cooldownKey(account.apiKeyEnv, scopedModel)
          // Keep arbitrary request model IDs from growing this map indefinitely.
          if (!cooldowns.has(key) && cooldowns.size >= MAX_COOLDOWNS) return
          const until = now() + (code === 'INSUFFICIENT_CREDITS' ? 300000 : Math.max(1, retryAfterMs))
          cooldowns.set(key, { account: account.apiKeyEnv, model: scopedModel, until, reason: code })
          onEvent({ type: 'cooldown', account: account.apiKeyEnv, model: scopedModel, reason: code, until })
        },
      }
    },
    clearCooldown(account, model) {
      for (const [key, entry] of cooldowns) if (entry.account === account && (model === undefined || entry.model === model)) {
        cooldowns.delete(key); onEvent({ type: 'recover', account, model: entry.model, reason: 'manual' })
      }
    },
    reset() { sessions.clear(); cooldowns.clear(); identities.clear(); generation++; policy = ''; cursor = 0 },
    status() {
      prune()
      return { sessions: sessions.size, maxSessions, ttlMs, strategyCursor: cursor,
        cooldowns: [...cooldowns.values()].map(entry => ({ account: entry.account, ...(entry.model ? { model: entry.model } : {}), reason: entry.reason, remainingMs: Math.max(0, entry.until - now()) })) }
    },
  }
}
