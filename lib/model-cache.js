import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const CACHE_VERSION = 3
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const LEGACY_CACHE_PATH = '~/.dsh/clinebot-models-cache.json'

function expandHome(value, home) {
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2))
  return value
}

/**
 * Default cache follows the harness home: `$DSH_HOME` when set, otherwise
 * `~/.dsh`. The historical `~/.dsh/...` default is treated as that same
 * default so an isolated `DSH_HOME` does not write the interactive profile.
 */
export function resolveModelsCachePath(configured, env = process.env, home = homedir()) {
  const value = String(configured || '').trim()
  if (value && value !== LEGACY_CACHE_PATH) return expandHome(value, home)
  const dshHome = String(env.DSH_HOME || '').trim()
  return join(dshHome || join(home, '.dsh'), 'clinebot-models-cache.json')
}

/**
 * Drop a saved plan cache. A missing file is success. A real filesystem
 * error is not, so the caller can say the previous plan list may remain.
 */
export async function invalidateModelsDiskCache(cachePath) {
  if (!cachePath) return false
  try {
    const fs = await import('node:fs/promises')
    await fs.rm(cachePath, { force: true })
    return true
  } catch {
    return false
  }
}

export async function saveModelsDiskCache(cachePath, snapshot) {
  if (!cachePath) return false
  const discoveredIds = Array.isArray(snapshot?.discoveredIds) ? snapshot.discoveredIds : []
  const unknownModels = Array.isArray(snapshot?.unknownModels) ? snapshot.unknownModels : []
  if (!discoveredIds.length && !unknownModels.length) return false
  const identity = snapshot?.identity && typeof snapshot.identity === 'object'
    ? {
      baseUrl: String(snapshot.identity.baseUrl || ''),
      apiKeyEnv: String(snapshot.identity.apiKeyEnv || ''),
      activeAccount: String(snapshot.identity.activeAccount || ''),
    }
    : null
  try {
    const fs = await import('node:fs/promises')
    await fs.mkdir(dirname(cachePath), { recursive: true })
    const savedAt = Date.now()
    const payload = {
      version: CACHE_VERSION,
      savedAt,
      expiresAt: savedAt + CACHE_TTL_MS,
      discoveredIds,
      unknownModels,
      identity,
    }
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

function sameStoredIdentity(stored, expected) {
  if (!stored || !expected) return false
  return stored.baseUrl === expected.baseUrl
    && stored.apiKeyEnv === expected.apiKeyEnv
    && String(stored.activeAccount || '') === String(expected.activeAccount || '')
}

export async function loadModelsDiskCache(cachePath, expectedIdentity) {
  if (!cachePath) return null
  try {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(cachePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.version !== CACHE_VERSION) {
      return { stale: true, version: parsed.version ?? null, discoveredIds: [], unknownModels: [] }
    }
    if (expectedIdentity && !sameStoredIdentity(parsed.identity, expectedIdentity)) {
      return {
        stale: true,
        version: CACHE_VERSION,
        discoveredIds: [],
        unknownModels: [],
        identityMismatch: true,
      }
    }
    const expired = typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()
    return {
      stale: expired,
      version: CACHE_VERSION,
      discoveredIds: Array.isArray(parsed.discoveredIds) ? parsed.discoveredIds : [],
      unknownModels: Array.isArray(parsed.unknownModels) ? parsed.unknownModels : [],
      savedAt: parsed.savedAt,
      expiresAt: parsed.expiresAt,
      identity: parsed.identity || null,
    }
  } catch {
    return null
  }
}
