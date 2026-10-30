import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { publicConfig, plainConfig, parseConfig, LLM_PI_AI_NS } from './config.js'
import {
  PROVIDER_ID,
  PROVIDER_DISPLAY_NAME,
  getAllModels,
  selectedIds,
  migrateConfig,
  mergeDiscovered,
  loadModelsDiskCache,
  saveModelsDiskCache,
  clearPlanDiscovery,
} from './models.js'
import { buildProviderPayload, usableRouteReasoning } from './provider-payload.js'
import { preserveHostModelEdits, retainedHostFields, applyStoredHostEdits, captureHostEdits, changedModelFields } from './host-model-edits.js'
import {
  resolveKeyValue,
  resolveAccountPool,
  probeHealth,
  fetchUsageLimits,
  sessionStats,
  catalogIdentity,
  presentUsage,
  recentRequests,
} from './cline-client.js'
import { activeCredentialEnv, getLastRotation } from './account-pool.js'
import { currentEpoch, enqueuePlanWrite } from './plan-write.js'
import { discoverModels } from './model-discovery.js'

export { noteUserWrite, currentEpoch, enqueuePlanWrite } from './plan-write.js'

let lastSync = { ok: true, error: '', warning: '', at: 0, discovery: { error: '', warning: '', at: 0, lastSuccessAt: 0 } }
const managedProviders = new WeakMap()

export function syncState() {
  return { ...lastSync, discovery: { ...lastSync.discovery }, epoch: currentEpoch() }
}

function recordSync(patch) {
  lastSync = { ...lastSync, ...patch, at: Date.now() }
}

function recordDiscovery(patch) {
  lastSync.discovery = { ...lastSync.discovery, ...patch, at: Date.now() }
}

export function recordSyncFailure(error) {
  recordSync({ ok: false, error: String(error?.message || error) })
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

function namespaceValue(settings, ns) {
  if (!settings) return null
  if (typeof settings.get === 'function') {
    try {
      return settings.get(ns) ?? null
    } catch {
      return null
    }
  }
  if (typeof settings.describe === 'function') {
    try {
      const rows = settings.describe()
      const row = Array.isArray(rows) ? rows.find((item) => item?.ns === ns) : null
      return row?.value ?? null
    } catch {
      return null
    }
  }
  return null
}

export async function checkRegisteredInPiAi(ctx, cfg) {
  if (cfg?.nativeAdapterEnabled) return !!cfg.nativeProvider?.models?.length
  try {
    const piAi = namespaceValue(settingsOf(ctx), LLM_PI_AI_NS)
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

export async function buildStatus(ctx, cfg, { fresh = false } = {}) {
  cfg = plainConfig(cfg)
  const pub = publicConfig(cfg)
  const probeTimeout = Math.min(2500, pub.timeoutMs || 2500)

  const [key, pool, isRegistered, health] = await Promise.all([
    resolveKeyValue(ctx, pub.apiKeyEnv),
    resolveAccountPool(ctx, cfg),
    checkRegisteredInPiAi(ctx, cfg),
    probeHealth(pub.baseUrl, { timeoutMs: probeTimeout }),
  ])

  const activeAcc = await resolveActiveAccountKey(ctx, cfg, pool)
  const allModels = pub.availableModels || getAllModels(cfg)

  let usage = null
  const keyToUse = activeAcc.value || key.value
  if (keyToUse) {
    usage = await fetchUsageLimits(pub.baseUrl, keyToUse, { timeoutMs: probeTimeout, remember: false, bypassCache: fresh }).catch(() => null)
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
    lastFailover: getLastRotation(),
    health,
    usage: presentUsage(usage),
    recentRequests: recentRequests(5),
    quotaWarning,
    sessionStats: { ...sessionStats },
    isRegistered,
    availableModels: allModels,
    sync: syncState(),
  }
}

export async function readProvider(ctx) {
  try {
    return namespaceValue(settingsOf(ctx), LLM_PI_AI_NS)?.providers?.[PROVIDER_ID] || null
  } catch {
    return null
  }
}

export async function upsertPiAiProvider(ctx, cfg, activeModelIds, { resetHostFields = {}, persistHostEdits, transport, store } = {}) {
  cfg = plainConfig(cfg)
  const settings = settingsOf(ctx)
  if (!settings?.mutate) {
    const error = new Error('DSH settings service unavailable')
    recordSync({ ok: false, error: error.message, warning: '' })
    throw error
  }

  const pub = publicConfig(cfg)
  const allModels = getAllModels({ ...cfg, hostModelOverrides: [] })
  const ids = Array.isArray(activeModelIds) ? activeModelIds : selectedIds(allModels, cfg)
  const chosen = allModels.filter((model) => ids.includes(model.id))
  const existing = store ? await store.read() : await readProvider(ctx)
  const built = buildProviderPayload({
    baseUrl: pub.baseUrl,
    apiKeyEnv: activeCredentialEnv(cfg),
    models: allModels,
    displayName: PROVIDER_DISPLAY_NAME,
    existing,
    providerReasoning: '',
  })
  const previous = managedProviders.get(ctx)
  const reset = changedModelFields(previous?.config, cfg)
  for (const [id, fields] of Object.entries(resetHostFields)) reset[id] = [...new Set([...(reset[id] || []), ...fields])]
  const withStored = applyStoredHostEdits(built.payload, cfg.hostModelOverrides, reset)
  const payload = preserveHostModelEdits(withStored, existing, previous, cfg, reset)
  const hostEdits = captureHostEdits(payload, built.payload, cfg.hostModelOverrides)
  const described = new Map(getAllModels({ ...cfg, hostModelOverrides: hostEdits }).map((model) => [model.id, model.description]))
  for (const model of payload.models) model.description = described.get(model.id) || model.description
  if (persistHostEdits && JSON.stringify(hostEdits) !== JSON.stringify(cfg.hostModelOverrides || [])) await persistHostEdits(hostEdits)
  if (!chosen.length) {
    if (store) await store.remove()
    else await removePiAiProvider(ctx)
    recordSync({ ok: true, error: '', warning: 'no models selected; provider removed' })
    return { removed: true, modelCount: 0 }
  }
  const selectedPayload = { ...payload, models: payload.models.filter((model) => ids.includes(model.id)) }
  const reasoning = usableRouteReasoning(pub.providerReasoning, selectedPayload.models)
  if (reasoning.level) selectedPayload.reasoning = reasoning.level
  if (transport) {
    Object.assign(selectedPayload, transport.fields)
    for (const field of transport.unset || []) delete selectedPayload[field]
  }

  if (store) await store.write(selectedPayload, { expected: existing })
  else await settings.mutate(LLM_PI_AI_NS, [
    { op: 'set', path: ['providers', PROVIDER_ID], value: selectedPayload },
  ])
  managedProviders.set(ctx, { payload: structuredClone(payload), config: structuredClone(cfg), hostFields: retainedHostFields(payload, built.payload) })
  recordSync({ ok: true, error: '', warning: reasoning.warning || '' })
  return selectedPayload
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

async function applyDiscovery(settingsApi, live, discovered, cacheFile, seen, { valid = () => true, metadata, syncedAt = 0, fingerprint = '' } = {}) {
  let next
  const wrote = await enqueuePlanWrite(async () => {
    // Re-check after earlier plan writes. A clear that started while this
    // read was waiting, or while its settings call was in flight, owns the list.
    if (typeof seen === 'number' && currentEpoch() !== seen || !await valid()) return false
    const cfg = live()
    const merged = mergeDiscovered(cfg, discovered)
    next = parseConfig({ ...cfg, discoveredPlanIds: merged.discoveredPlanIds, planVerified: true, customModels: merged.customModels,
      ...(metadata ? { catalogMetadata: metadata } : {}), ...(syncedAt ? { planSyncedAt: syncedAt, planSyncIdentity: fingerprint } : {}) })
    if (settingsApi?.update) await settingsApi.update({
      discoveredPlanIds: next.discoveredPlanIds,
      planVerified: true,
      customModels: next.customModels,
      catalogMetadata: next.catalogMetadata,
      planSyncedAt: next.planSyncedAt,
      planSyncIdentity: next.planSyncIdentity,
    })
    else if (settingsApi?.replace) await settingsApi.replace(next)
    if (typeof seen === 'number' && currentEpoch() !== seen || !await valid()) return false
    if (cacheFile) {
      const saved = await saveModelsDiskCache(cacheFile, {
        discoveredIds: next.discoveredPlanIds,
        unknownModels: (next.customModels || []).filter(item => next.discoveredPlanIds.includes(item.id)).map(item => ({ id: item.id, name: item.name || item.id })),
        identity: { ...catalogIdentity(next), credentialHash: fingerprint },
        catalogMetadata: next.catalogMetadata,
      })
      recordDiscovery({ warning: saved ? '' : 'Model cache could not be saved; settings remain available.' })
    }
    return true
  })
  if (!wrote) return null
  return next
}

export async function autoDiscoverPlanModels(ctx, { live, getSettingsApi, syncProviderState, signal, isCurrent = () => true, freshnessMs = 0, now = Date.now }) {
  const seen = currentEpoch()
  try {
    const cfg = live()
    const pub = publicConfig(cfg)
    const cacheFile = pub.modelsCachePath
    const settingsApi = getSettingsApi()
    if (!pub.enabled || !settingsApi || !settingsApi.update && !settingsApi.replace) return { ok: false, skipped: 'not-ready' }
    const activeAcc = await resolveActiveAccountKey(ctx, cfg)
    const fingerprint = discoveryFingerprint(cfg, activeAcc)
    if (freshnessMs && cfg.planSyncIdentity === fingerprint && cfg.planSyncedAt && now() - cfg.planSyncedAt < freshnessMs) return { ok: true, skipped: 'fresh' }
    const valid = async () => {
      const account = await resolveActiveAccountKey(ctx, live())
      return !signal?.aborted && isCurrent() && live().enabled !== false && currentEpoch() === seen
        && discoveryFingerprint(live(), account) === fingerprint
    }
    if (!await valid()) return { ok: false, skipped: 'stale' }
    // A credential may have changed while the host was stopped, without an
    // update event. Never retain another resolved account's verified plan.
    if (cfg.planSyncIdentity && cfg.planSyncIdentity !== fingerprint) {
      const cleared = await enqueuePlanWrite(async () => {
        if (!await valid()) return false
        const next = clearPlanDiscovery(live())
        if (settingsApi.update) await settingsApi.update({ discoveredPlanIds: [], planVerified: false, planSyncedAt: 0, planSyncIdentity: '', catalogMetadata: [], customModels: next.customModels, dynamicModels: [] })
        else await settingsApi.replace(parseConfig(next))
        return true
      })
      if (!cleared) return { ok: false, skipped: 'stale' }
    }
    if (!activeAcc.value) return { ok: false, skipped: 'no-key' }

    if ((!pub.discoveredPlanIds || !pub.discoveredPlanIds.length) && cacheFile) {
      const fromDisk = await loadModelsDiskCache(cacheFile, { ...catalogIdentity(pub), credentialHash: fingerprint })
      if (fromDisk && !fromDisk.stale && (fromDisk.discoveredIds?.length || fromDisk.unknownModels?.length)) {
        if (currentEpoch() !== seen) return
        const seeded = await applyDiscovery(settingsApi, live, [
          ...fromDisk.discoveredIds.map((id) => ({ id, known: true })),
          ...fromDisk.unknownModels.filter(item => fromDisk.discoveredIds.includes(item.id)).map(item => ({ ...item, known: false })),
        ], null, seen, { valid, metadata: fromDisk.catalogMetadata })
        if (!seeded) return
        await syncProviderState(seeded)
      }
    }

    const [usageData, directory] = await Promise.all([fetchUsageLimits(pub.baseUrl, activeAcc.value, {
      timeoutMs: Math.min(pub.timeoutMs, 5000),
      bypassCache: true, signal,
    }), discoverModels(pub.baseUrl, activeAcc.value, { timeoutMs: Math.min(pub.timeoutMs, 5000), signal })])
    if (!await valid()) return { ok: false, skipped: 'stale' }
    if (!usageData?.ok || !usageData.planModelsVerified) {
      recordSync({ ok: false, error: usageData?.error || 'plan discovery failed', warning: lastSync.warning })
      recordDiscovery({ error: 'Plan discovery failed; previous valid data retained.' })
      return { ok: false, error: 'Plan discovery failed' }
    }
    const discovered = Array.isArray(usageData.dynamicModels) ? usageData.dynamicModels : []
    const complete = directory.ok && !directory.warnings.length
    const metadata = complete ? directory.models.filter(row => row.free).map(({ id, free, freeSource }) => ({ id, free, freeSource })) : undefined
    const next = await applyDiscovery(settingsApi, live, discovered, cacheFile, seen, { valid, metadata,
      syncedAt: complete ? now() : 0, fingerprint })
    if (!next) return { ok: false, skipped: 'stale' }
    if (!await valid()) return { ok: false, skipped: 'stale' }
    const cacheWarning = syncState().discovery.warning
    const synced = await syncProviderState(live())
    if (synced?.ok === false) return { ok: false, error: 'Provider registration failed' }
    const error = complete ? '' : 'Model directory is incomplete; previous valid metadata retained.'
    recordDiscovery({ error, ...(complete ? { lastSuccessAt: next.planSyncedAt } : {}) })
    recordSync({ ok: complete, error, warning: cacheWarning || synced?.warning || '' })
    return { ok: complete, error, plan: usageData.plan, discoveredCount: discovered.length, models: getAllModels(live()), warning: syncState().warning }
  } catch (err) {
    if (!signal?.aborted && isCurrent()) recordSync({ ok: false, error: 'Model discovery failed', warning: lastSync.warning })
    if (!signal?.aborted && isCurrent()) recordDiscovery({ error: 'Model discovery failed; previous valid data retained.' })
    return { ok: false, error: 'Model discovery failed' }
  }
}

function discoveryFingerprint(cfg, account) {
  return createHash('sha256').update(JSON.stringify([catalogIdentity(cfg), account.apiKeyEnv || account.envName, account.value])).digest('hex')
}

/** One instance owns bounded startup retries, freshness and the latest demand. */
export function createCatalogRefresh(ctx, deps, { now = Date.now, schedule = setTimeout, repeat = setInterval, cancel = clearTimeout, cancelRepeat = clearInterval } = {}) {
  let stopped = false, inFlight, controller, pending = false, generation = 0, observed = '', runningEpoch
  let lastResult = { ok: false, skipped: 'not-ready' }
  const timers = []
  const stamp = () => JSON.stringify([catalogIdentity(deps.live()), deps.live().enabled !== false, (deps.live().accounts || []).map(account => account.apiKeyEnv)])
  const request = (reason = 'manual') => {
    if (stopped) return Promise.resolve({ ok: false, skipped: 'stopped' })
    const cfg = deps.live()
    if (cfg.enabled === false) { observed = stamp(); generation++; controller?.abort(); return Promise.resolve({ ok: false, skipped: 'disabled' }) }
    if (inFlight) {
      if (runningEpoch !== currentEpoch() || observed !== stamp() || reason === 'credential') {
        pending = reason; generation++; controller?.abort()
      }
      return inFlight
    }
    observed = stamp()
    inFlight = (async () => {
      do {
        const demand = pending || reason
        pending = false
        observed = stamp()
        controller = new AbortController()
        const captured = generation
        runningEpoch = currentEpoch()
        lastResult = await deps.run(() => autoDiscoverPlanModels(ctx, { ...deps, signal: controller.signal, now,
          freshnessMs: demand === 'startup' ? 300000 : demand === 'hourly' ? 21600000 : 0,
          isCurrent: () => !stopped && generation === captured }))
      } while (pending && !stopped && deps.live().enabled !== false)
      return lastResult
    })().catch(() => ({ ok: false, error: 'Model discovery failed' })).finally(() => { inFlight = undefined })
    return inFlight
  }
  return {
    request,
    changed() {
      const next = stamp()
      if (observed && next !== observed || inFlight && runningEpoch !== currentEpoch()) return request('change')
    },
    start() {
      for (const delay of [500, 3000, 15000]) { const timer = schedule(() => { void request(delay === 500 ? 'initial' : 'startup') }, delay); timer.unref?.(); timers.push(timer) }
      const interval = repeat(() => { void request('hourly') }, 3600000); interval.unref?.(); timers.push(interval)
    },
    async close() { stopped = true; generation++; pending = false; controller?.abort(); for (const timer of timers) { cancel(timer); cancelRepeat(timer) }; await inFlight },
  }
}

export async function migrateStoredConfig(ctx, cfg, settingsApi) {
  if (Number(cfg?.migrationRevision) >= 1) return { config: cfg, changed: false, notes: [] }
  const seen = currentEpoch()
  const existing = await readProvider(ctx)
  if (currentEpoch() !== seen) {
    return { config: cfg, changed: false, skipped: 'stale', notes: ['migration skipped because a newer settings write started'] }
  }
  // Host schema defaults erase the distinction between an absent selectionKind
  // and an explicit all-except-disabled choice. Migrate the composed raw entry
  // before parsing so legacy enabledModels keeps its original selection intent.
  const raw = ctx?.fiber?.entry?.options?.config
  const migrated = migrateConfig(raw && typeof raw === 'object' && !Array.isArray(raw) ? plainConfig(raw) : cfg, existing)
  if (!migrated.changed) return migrated
  if (currentEpoch() !== seen) {
    return { config: cfg, changed: false, skipped: 'stale', notes: ['migration skipped because a newer settings write started'] }
  }
  const next = parseConfig(migrated.config)
  if (settingsApi?.replace) {
    const stored = await enqueuePlanWrite(async () => {
      if (currentEpoch() !== seen) return false
      await settingsApi.replace(next)
      return currentEpoch() === seen
    })
    if (!stored) {
      return { config: cfg, changed: false, skipped: 'stale', notes: ['migration skipped because a newer settings write started'] }
    }
  }
  return { config: next, changed: true, notes: migrated.notes }
}
