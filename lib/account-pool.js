import {
  resolveKeyValue,
  usageCache,
  clearUsageCache,
  clearProbeCache,
  DEFAULT_API_KEY_ENV,
  toCredentialRef,
} from './cline-client.js'

/** Extra pool names stay inside this plugin's credential prefix. */
export const ACCOUNT_ENV_PATTERN = /^CLINEBOT_API_KEY(_[A-Z0-9]+)?$/

export function isPluginKeyEnv(name) {
  return ACCOUNT_ENV_PATTERN.test(String(name || '').trim())
}

export function resolveSaveKeyEnv(requested, primary) {
  const current = String(primary || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV
  const name = String(requested || '').trim() || current
  if (name === current || isPluginKeyEnv(name)) return { ok: true, apiKeyEnv: name }
  return { ok: false, error: 'bad_env' }
}

export function allocateAccountEnv(cfg) {
  const used = new Set([String(cfg?.apiKeyEnv || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV])
  for (const account of Array.isArray(cfg?.accounts) ? cfg.accounts : []) {
    if (account?.apiKeyEnv) used.add(account.apiKeyEnv)
  }
  let n = 2
  while (used.has(`CLINEBOT_API_KEY_${n}`)) n += 1
  return `CLINEBOT_API_KEY_${n}`
}

export function upsertAccount(cfg, { label, apiKeyEnv } = {}) {
  const primary = String(cfg?.apiKeyEnv || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV
  const env = String(apiKeyEnv || '').trim() || allocateAccountEnv(cfg)
  if (env === primary) return { ok: false, error: 'primary' }
  if (!isPluginKeyEnv(env)) return { ok: false, error: 'bad_env' }
  const accounts = (Array.isArray(cfg?.accounts) ? cfg.accounts : [])
    .filter((account) => account?.apiKeyEnv)
    .map((account) => ({ label: String(account.label || ''), apiKeyEnv: String(account.apiKeyEnv) }))
  const entry = { label: String(label || '').trim() || env, apiKeyEnv: env }
  const index = accounts.findIndex((account) => account.apiKeyEnv === env)
  if (index >= 0) accounts[index] = entry
  else accounts.push(entry)
  return { ok: true, account: entry, accounts }
}

export function dropAccount(cfg, apiKeyEnv) {
  const primary = String(cfg?.apiKeyEnv || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV
  const env = String(apiKeyEnv || '').trim()
  if (!env) return { ok: false, error: 'missing_account' }
  if (env === primary) return { ok: false, error: 'primary' }
  const current = Array.isArray(cfg?.accounts) ? cfg.accounts : []
  const accounts = current.filter((account) => account?.apiKeyEnv && account.apiKeyEnv !== env)
  if (accounts.length === current.filter((account) => account?.apiKeyEnv).length) {
    return { ok: false, error: 'missing_account' }
  }
  const activeAccount = String(cfg?.activeAccount || '') === env ? '' : String(cfg?.activeAccount || '')
  return { ok: true, accounts, activeAccount, removed: env }
}

/**
 * Fail over on a ClinePass rate limit or an exhausted account.
 * DSH 0.1.7's pi-ai adapter reports that as a finish failure whose code is
 * RATE_LIMIT or QUOTA and usually omits the HTTP status. A sentence that
 * merely mentions quota or credit is not one of those codes.
 */
export function isRateLimitFailure(failure) {
  if (!failure) return false
  if (typeof failure === 'string') return rateLimitText(failure)
  const status = Number(failure.status ?? failure.statusCode)
  if (status === 429 || status === 402) return true
  const code = String(failure.code || '').toLowerCase().replace(/-/g, '_')
  if (
    code === 'rate_limit'
    || code === 'rate_limit_exceeded'
    || code === 'insufficient_quota'
    || code === 'quota'
    || code === '429'
  ) return true
  return rateLimitText(failure.message)
}

function rateLimitText(value) {
  const message = String(value || '').toLowerCase()
  return message.includes('rate limit')
    || message.includes('rate_limit')
    || message.includes('rate-limit')
    || message.includes('too many requests')
    || message.includes('insufficient_quota')
    || message.includes('quota exceeded')
    || message.includes('exceeded your quota')
    || message.includes('exceeded your current quota')
    || /\b429\b/.test(message)
    || /\b402\b/.test(message)
}

/** Primary credential or an account saved in the pool. */
export function isKnownAccountEnv(cfg, apiKeyEnv) {
  const name = String(apiKeyEnv || '').trim()
  if (!name) return false
  const primary = String(cfg?.apiKeyEnv || DEFAULT_API_KEY_ENV).trim() || DEFAULT_API_KEY_ENV
  if (name === primary) return true
  return (Array.isArray(cfg?.accounts) ? cfg.accounts : []).some((account) => account?.apiKeyEnv === name)
}

let lastRotation = null

export function getLastRotation() {
  return lastRotation ? { ...lastRotation } : null
}

export function rememberRotation(info) {
  lastRotation = info ? { ...info } : null
  return getLastRotation()
}

export function resetRotationMemory() {
  lastRotation = null
}

export async function deleteCredentialKey(ctx, apiKeyEnv) {
  const name = String(apiKeyEnv || '').trim()
  if (!isPluginKeyEnv(name) || name === DEFAULT_API_KEY_ENV) {
    throw new Error('primary')
  }
  const credentials = ctx?.credentials || ctx?.get?.('credentials')
  if (!credentials || typeof credentials.unset !== 'function') {
    throw new Error('credentials_unavailable')
  }
  await credentials.unset(await toCredentialRef(name))
  return { ok: true, apiKeyEnv: name }
}

/**
 * Resolve all accounts in pool with their status and keys.
 */
export async function resolveAccountPool(ctx, cfg) {
  const apiKeyEnv = cfg?.apiKeyEnv || DEFAULT_API_KEY_ENV
  const defaultSlot = {
    id: 'default',
    label: 'Default',
    apiKeyEnv,
  }
  const accounts = Array.isArray(cfg?.accounts) ? cfg.accounts : []
  const allSlots = [defaultSlot, ...accounts]
  const activeAccount = String(cfg?.activeAccount || '')
  const resolved = []

  for (let i = 0; i < allSlots.length; i++) {
    const slot = allSlots[i]
    const envName = slot.apiKeyEnv || (i === 0 ? apiKeyEnv : `CLINEBOT_API_KEY_${i + 1}`)
    const keyInfo = await resolveKeyValue(ctx, envName)
    resolved.push({
      id: slot.id || (i === 0 ? 'default' : `account-${i + 1}`),
      label: slot.label || (i === 0 ? 'Default' : `Account ${i + 1}`),
      apiKeyEnv: envName,
      present: Boolean(keyInfo.value),
      source: keyInfo.source,
      value: keyInfo.value,
      isPinned: activeAccount ? activeAccount === envName : i === 0,
    })
  }

  return resolved
}

/** Credential env the harness provider must use. A pin wins over the primary env. */
export function activeCredentialEnv(cfg) {
  const primary = cfg?.apiKeyEnv || DEFAULT_API_KEY_ENV
  const pinned = String(cfg?.activeAccount || '').trim()
  if (!pinned) return primary
  const known = new Set([
    primary,
    ...(Array.isArray(cfg?.accounts) ? cfg.accounts.map((account) => account?.apiKeyEnv) : []),
  ].filter(Boolean))
  return known.has(pinned) ? pinned : primary
}

/**
 * Check if a cached quota entry is currently exhausted.
 * Checks 5-hour rolling limit and verifies if resetsAt timestamp has already elapsed.
 */
export function isAccountQuotaExhausted(usage) {
  if (!usage?.windows?.fiveHour) return false
  const fiveHour = usage.windows.fiveHour
  if (typeof fiveHour.percentUsed !== 'number' || fiveHour.percentUsed < 95) {
    return false
  }
  // Auto-recovery: if resetsAt is present and in the past, the account is recovered
  if (fiveHour.resetsAt) {
    const resetTime = new Date(fiveHour.resetsAt).getTime()
    if (!Number.isNaN(resetTime) && Date.now() >= resetTime) {
      return false
    }
  }
  return true
}

/**
 * Smart Quota-Aware Failover: rotates active account upon 429 or quota exhaustion.
 * Prioritizes accounts with lowest percentUsed and respects resetsAt recovery.
 */
export async function rotateToNextAccount(ctx, cfg, reason = 'rate_limit', settingsApi = null) {
  const pool = await resolveAccountPool(ctx, cfg)
  const configured = pool.filter((acc) => acc.present && acc.value)
  if (configured.length <= 1) {
    return { rotated: false, reason, message: 'Pool has only 1 configured account' }
  }

  const active = String(cfg?.activeAccount || configured[0].apiKeyEnv)
  const currentIndex = configured.findIndex((acc) => acc.apiKeyEnv === active)

  // Candidate pool excluding current account if possible
  const candidates = configured.filter((acc) => acc.apiKeyEnv !== active)
  if (!candidates.length) {
    return { rotated: false, reason, message: 'No alternative accounts configured' }
  }

  // Assess quota for candidates if cached in memory
  let bestCandidate = null
  let lowestUsagePct = Infinity

  for (const cand of candidates) {
    const cacheKey = `cline:usage:${cand.value.slice(-8)}`
    const cached = usageCache.get(cacheKey)?.data
    const isExhausted = isAccountQuotaExhausted(cached)

    if (!isExhausted) {
      const pct = cached?.windows?.fiveHour?.percentUsed ?? 50
      if (pct < lowestUsagePct) {
        lowestUsagePct = pct
        bestCandidate = cand
      }
    }
  }

  // Fallback if all candidates are either exhausted or uncached: pick next in round-robin
  const nextAcc = bestCandidate || candidates[currentIndex % candidates.length] || candidates[0]

  let updated = false
  if (settingsApi?.replace) {
    try {
      const next = { ...cfg, activeAccount: nextAcc.apiKeyEnv }
      await settingsApi.replace(next)
      updated = true
    } catch (err) {
      ctx?.logger?.warn?.('[dsh-clinebot] Failed to persist rotated activeAccount via settingsApi: ' + (err?.message || err))
    }
  } else {
    const settings = (ctx?.get && ctx.get('settings')) || ctx?.settings
    if (settings?.mutate) {
      try {
        await settings.mutate('dsh-clinebot', [
          { op: 'set', path: ['activeAccount'], value: nextAcc.apiKeyEnv },
        ])
        updated = true
      } catch (err) {
        ctx?.logger?.warn?.('[dsh-clinebot] Failed to persist rotated activeAccount via settings.mutate: ' + (err?.message || err))
      }
    }
  }

  if (!updated) {
    return {
      rotated: false,
      previousAccount: active,
      activeAccount: active,
      reason: 'failed_to_persist',
      message: 'Failed to persist rotated activeAccount to settings',
      updatedSettings: false,
    }
  }

  clearUsageCache()
  clearProbeCache()
  rememberRotation({
    at: Date.now(),
    reason,
    from: active,
    to: nextAcc.apiKeyEnv,
  })

  return {
    rotated: true,
    previousAccount: active,
    activeAccount: nextAcc.apiKeyEnv,
    reason,
    updatedSettings: true,
  }
}
