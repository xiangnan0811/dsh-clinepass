import os from 'node:os'
import path from 'node:path'
import { publicConfig, Config, LLM_PI_AI_NS } from './config.js'
import {
  PROVIDER_ID,
  PROVIDER_DISPLAY_NAME,
  getAllModels,
  selectedIds,
  migrateConfig,
  mergeDiscovered,
  loadModelsDiskCache,
  saveModelsDiskCache,
} from './models.js'
import { buildProviderPayload } from './provider-payload.js'
import {
  resolveKeyValue,
  resolveAccountPool,
  probeHealth,
  fetchUsageLimits,
  sessionStats,
} from './cline-client.js'
import { activeCredentialEnv } from './account-pool.js'

let epoch = 0
let lastSync = { ok: true, error: '', warning: '', at: 0 }

export function noteUserWrite() {
  epoch += 1
  return epoch
}

export function currentEpoch() {
  return epoch
}

export function syncState() {
  return { ...lastSync, epoch }
}

function recordSync(patch) {
  lastSync = { ...lastSync, ...patch, at: Date.now() }
}

export function resolvePathWithHome(p) {
  if (!p || typeof p !== 'string') return ''
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2))
  }
  return p
}

function settingsOf(ctx) {
  return (ctx?.get && ctx.get('settings')) || ctx?.settings || null
}

export async function checkRegisteredInPiAi(ctx) {
  const settings = settingsOf(ctx)
  if (!settings?.get) return false
  try {
    const piAi = settings.get(LLM_PI_AI_NS)
    return !!piAi?.providers?.[PROVIDER_ID]
  } catch {
    return false
  }
}

export async function resolveActiveAccountKey(ctx, cfg, pool = null) {
  const accountPool = pool || await resolveAccountPool(ctx, cfg)
  const configured = accountPool.filter((acc) => acc.present && acc.value)
  if (!configured.length) {
    return { envName: publicConfig(cfg).apiKeyEnv, value: '', source: 'none', id: 'default' }
  }
  const pub = publicConfig(cfg)
  if (pub.activeAccount) {
    const pinned = configured.find((acc) => acc.apiKeyEnv === pub.activeAccount || acc.id === pub.activeAccount)
    if (pinned) return pinned
  }
  return configured[0]
}

export async function buildStatus(ctx, cfg) {
  const pub = publicConfig(cfg)
  const probeTimeout = Math.min(2500, pub.timeoutMs || 2500)

  const [key, pool, isRegistered, health] = await Promise.all([
    resolveKeyValue(ctx, pub.apiKeyEnv),
    resolveAccountPool(ctx, cfg),
    checkRegisteredInPiAi(ctx),
    probeHealth(pub.baseUrl, { timeoutMs: probeTimeout }),
  ])

  const activeAcc = await resolveActiveAccountKey(ctx, cfg, pool)
  const allModels = pub.availableModels || getAllModels(cfg)

  let usage = null
  const keyToUse = activeAcc.value || key.value
  if (keyToUse) {
    usage = await fetchUsageLimits(pub.baseUrl, keyToUse, { timeoutMs: probeTimeout }).catch(() => null)
  }

  let quotaWarning = null
  if (usage?.windows?.fiveHour) {
    const pct = usage.windows.fiveHour.percentUsed
    if (pct >= 95) {
      quotaWarning = {
        level: 'exhausted',
        message: `5-hour rolling limit is almost exhausted (${pct}%). New requests may be rejected until quota reset.`,
        resetsAt: usage.windows.fiveHour.resetsAt,
      }
    } else if (pct >= 80) {
      quotaWarning = {
        level: 'warning',
        message: `Notice: ${pct}% of the 5-hour rolling limit has been consumed.`,
        resetsAt: usage.windows.fiveHour.resetsAt,
      }
    }
  }

  return {
    ok: true,
    providerId: PROVIDER_ID,
    displayName: PROVIDER_DISPLAY_NAME,
    config: pub,
    key: {
      envName: activeAcc.apiKeyEnv || key.envName,
      present: !!(activeAcc.value || key.value),
      source: activeAcc.source || key.source,
    },
    accounts: pool.map((acc) => ({
      id: acc.id,
      label: acc.label,
      apiKeyEnv: acc.apiKeyEnv,
      present: acc.present,
      source: acc.source,
      isPinned: acc.isPinned,
    })),
    activeAccount: activeAcc.apiKeyEnv,
    health,
    usage,
    quotaWarning,
    sessionStats: { ...sessionStats },
    isRegistered,
    availableModels: allModels,
    sync: syncState(),
  }
}

export async function readProvider(ctx) {
  const settings = settingsOf(ctx)
  if (!settings?.get) return null
  try {
    return settings.get(LLM_PI_AI_NS)?.providers?.[PROVIDER_ID] || null
  } catch {
    return null
  }
}

export async function upsertPiAiProvider(ctx, cfg, activeModelIds) {
  const settings = settingsOf(ctx)
  if (!settings?.mutate) {
    const error = new Error('DSH settings service unavailable')
    recordSync({ ok: false, error: error.message, warning: '' })
    throw error
  }

  const pub = publicConfig(cfg)
  const allModels = getAllModels(cfg)
  const ids = Array.isArray(activeModelIds) ? activeModelIds : selectedIds(allModels, cfg)
  const chosen = allModels.filter((model) => ids.includes(model.id))
  if (!chosen.length) {
    await removePiAiProvider(ctx)
    recordSync({ ok: true, error: '', warning: 'no models selected; provider removed' })
    return { removed: true, modelCount: 0 }
  }

  const existing = await readProvider(ctx)
  const built = buildProviderPayload({
    baseUrl: pub.baseUrl,
    apiKeyEnv: activeCredentialEnv(cfg),
    models: chosen,
    displayName: PROVIDER_DISPLAY_NAME,
    existing,
    providerReasoning: pub.providerReasoning,
  })

  await settings.mutate(LLM_PI_AI_NS, [
    { op: 'set', path: ['providers', PROVIDER_ID], value: built.payload },
  ])
  recordSync({ ok: true, error: '', warning: built.reasoningWarning || '' })
  return built.payload
}

export async function removePiAiProvider(ctx) {
  const settings = settingsOf(ctx)
  if (!settings?.mutate) {
    throw new Error('DSH settings service unavailable')
  }
  await settings.mutate(LLM_PI_AI_NS, [
    { op: 'unset', path: ['providers', PROVIDER_ID] },
  ])
  return { ok: true }
}

export function formatProgressBar(pct, totalWidth = 10) {
  const clamped = Math.max(0, Math.min(100, pct || 0))
  const filled = Math.round((clamped / 100) * totalWidth)
  const empty = Math.max(0, totalWidth - filled)
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${clamped}%`
}

async function applyDiscovery(settingsApi, cfg, discovered, cacheFile) {
  const merged = mergeDiscovered(cfg, discovered)
  if (!merged.changed) return cfg
  const next = Config({
    ...cfg,
    discoveredPlanIds: merged.discoveredPlanIds,
    customModels: merged.customModels,
  })
  if (settingsApi?.update) await settingsApi.update({
    discoveredPlanIds: next.discoveredPlanIds,
    customModels: next.customModels,
  })
  else if (settingsApi?.replace) await settingsApi.replace(next)
  if (cacheFile) {
    await saveModelsDiskCache(cacheFile, {
      discoveredIds: next.discoveredPlanIds,
      unknownModels: (next.customModels || []).map((item) => ({ id: item.id, name: item.name || item.id })),
    })
  }
  return next
}

export async function autoDiscoverPlanModels(ctx, { live, getSettingsApi, syncProviderState }) {
  const seen = currentEpoch()
  try {
    const cfg = live()
    const pub = publicConfig(cfg)
    const cacheFile = pub.modelsCachePath
    const settingsApi = getSettingsApi()

    if ((!pub.discoveredPlanIds || !pub.discoveredPlanIds.length) && cacheFile) {
      const fromDisk = await loadModelsDiskCache(cacheFile)
      if (fromDisk && !fromDisk.stale && (fromDisk.discoveredIds?.length || fromDisk.unknownModels?.length)) {
        if (currentEpoch() !== seen) return
        const seeded = await applyDiscovery(settingsApi, live(), [
          ...fromDisk.discoveredIds.map((id) => ({ id, known: true })),
          ...fromDisk.unknownModels.map((item) => ({ ...item, known: false })),
        ], null)
        await syncProviderState(seeded)
      }
    }

    const activeAcc = await resolveActiveAccountKey(ctx, live())
    if (!activeAcc.value) return
    if (currentEpoch() !== seen) return

    const usageData = await fetchUsageLimits(pub.baseUrl, activeAcc.value, {
      timeoutMs: Math.min(pub.timeoutMs, 5000),
      bypassCache: true,
    })
    if (currentEpoch() !== seen) return
    if (!usageData?.ok) {
      recordSync({ ok: false, error: usageData?.error || 'plan discovery failed', warning: lastSync.warning })
      return
    }
    const discovered = Array.isArray(usageData.dynamicModels) ? usageData.dynamicModels : []
    if (!discovered.length) return
    const next = await applyDiscovery(settingsApi, live(), discovered, cacheFile)
    await syncProviderState(next)
  } catch (err) {
    recordSync({ ok: false, error: String(err?.message || err), warning: lastSync.warning })
  }
}

export async function migrateStoredConfig(ctx, cfg, settingsApi) {
  if (Number(cfg?.migrationRevision) >= 1) return { config: cfg, changed: false, notes: [] }
  const seen = currentEpoch()
  const existing = await readProvider(ctx)
  if (currentEpoch() !== seen) {
    return { config: cfg, changed: false, skipped: 'stale', notes: ['migration skipped because a newer settings write started'] }
  }
  const migrated = migrateConfig(cfg, existing)
  if (!migrated.changed) return migrated
  if (currentEpoch() !== seen) {
    return { config: cfg, changed: false, skipped: 'stale', notes: ['migration skipped because a newer settings write started'] }
  }
  const next = Config(migrated.config)
  if (settingsApi?.replace) await settingsApi.replace(next)
  return { config: next, changed: true, notes: migrated.notes }
}
