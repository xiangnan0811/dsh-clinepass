import { Config, parseConfig, publicConfig, plainConfig, writableConfig, NS, LLM_PI_AI_NS } from './config.js'
import { createNativeUpdateChecker, registerPluginUpdater } from './updater.js'
import {
  sessionStats,
  recordSessionRequest,
  resetSessionStats,
  rotateToNextAccount,
  resolveKeyValue,
  smokeChat,
  fetchUsageLimits,
  catalogChange,
  clearUsageCache,
  clearProbeCache,
} from './cline-client.js'
import {
  checkRegisteredInPiAi,
  upsertPiAiProvider,
  removePiAiProvider,
  buildStatus,
  createCatalogRefresh,
  resolveActiveAccountKey,
  migrateStoredConfig,
  syncState,
  enqueuePlanWrite,
  noteUserWrite,
  currentEpoch,
  readProvider,
  recordSyncFailure,
} from './provider-sync.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerAccountsRoutes } from './routes/accounts.js'
import { registerModelsRoutes } from './routes/models.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerKeyRoutes } from './routes/keys.js'
import { createKeyDiscovery } from './key-discovery.js'
import { registerSlashCommand } from './slash-command.js'
import { activeCredentialEnv, isKnownAccountEnv, isRateLimitFailure } from './account-pool.js'
import { attachStreamFailover } from './stream-failover.js'
import { createProxyRuntime } from './proxy-runtime.js'
import { createNativeAdapterController } from './native-adapter-controller.js'
import { registerProxyControls } from './routes/proxy.js'
import { registerNativeModelRoutes } from './routes/native-models.js'
import { createStatsRuntime } from './stats-store.js'
import { smokeMetrics } from './request-metrics.js'
import { registerStatsRoutes } from './routes/stats.js'
import { registerSessionUsage } from './session-usage.js'
import { createModelProbe } from './model-probe.js'
import { registerProbeRoutes } from './routes/probe.js'
import { createWebSearch } from './web-search.js'
import { captureRunningPlugin } from './update-check.js'
import { createNativeLifecycle } from './native-lifecycle.js'
import { upstreamPinFor } from './upstream-pin.js'
import { clearPlanDiscovery } from './models.js'
import { createEconomy } from './economy.js'
import { registerEconomyRoutes } from './routes/economy.js'

export const name = 'dsh-clinepass'
export const inject = ['settings', 'credentials']

export { NS, LLM_PI_AI_NS, Config, sessionStats, recordSessionRequest, resetSessionStats, rotateToNextAccount }

export function ownSettings(settings, config, entryId, lifecycle) {
  if (typeof settings?.register === 'function') {
    return settings.register(NS, Config, { base: config })
  }
  if (typeof settings?.replace !== 'function' && typeof settings?.update !== 'function') return null
  // The loader commits volatile fields into the running config. Until that
  // event arrives, serve the section this plugin just wrote.
  let written = null
  const read = () => written ?? plainConfig(config)
  return {
    get: read,
    refresh() { written = null },
    update: async (patch) => {
      const fields = writableConfig(patch)
      if (lifecycle.edit) { written = await lifecycle.edit(entryId, current => ({ ...current, ...fields })); return }
      await settings.update(entryId, fields)
      written = { ...read(), ...fields }
    },
    replace: async (section) => {
      const next = writableConfig(section)
      if (lifecycle.edit) { written = await lifecycle.edit(entryId, current => ({ ...current, ...next })); return }
      await settings.replace(entryId, next)
      written = { ...read(), ...next }
    },
    updateDerived: async (derive) => {
      if (lifecycle.edit) { written = await lifecycle.edit(entryId, current => ({ ...current, ...writableConfig(derive(parseConfig(current))) })); return }
      const patch = writableConfig(derive(parseConfig(read())))
      await settings.update(entryId, patch)
      written = { ...read(), ...patch }
    },
  }
}

export function apply(ctx, config) {
  const lifecycle = createNativeLifecycle(ctx)
  const runningIdentity = captureRunningPlugin(new URL('../package.json', import.meta.url))
  const updater = createNativeUpdateChecker(ctx, { packageName: name, manifestUrl: new URL('../package.json', import.meta.url), runningIdentity })
  ctx.effect?.(() => () => updater.close(), 'dsh-clinebot: update checks')
  const keyDiscovery = createKeyDiscovery()
  ctx.effect?.(() => () => keyDiscovery.clear(), 'dsh-clinebot: discovered key handles')
  let getConfig = () => plainConfig(config)
  const live = () => parseConfig(structuredClone(plainConfig(getConfig())))
  let settingsApi
  let seenCatalog = null
  let providerSyncTail = Promise.resolve()
  let shuttingDown = false
  const statistics = createStatsRuntime(ctx, live)
  const economy = createEconomy(ctx, { live, statistics })
  const recordMetrics = (metrics) => statistics.record(metrics)
  const dispatchMetadata = new WeakMap()
  const probeRequests = new WeakSet()
  const modelProbe = createModelProbe(ctx, { live, probeRequests, dispatchMetadata })
  const webSearch = createWebSearch(ctx, { live })
  registerSessionUsage(ctx)
  const persistInternal = (patch) => enqueuePlanWrite(async () => {
      if (!settingsApi) throw new Error('Settings are unavailable for proxy configuration')
      if (settingsApi.updateDerived) return settingsApi.updateDerived(typeof patch === 'function' ? patch : () => patch)
      const change = typeof patch === 'function' ? patch(live()) : patch
      if (settingsApi.update) await settingsApi.update(change)
      else await settingsApi.replace(parseConfig({ ...live(), ...change }))
    })
  const nativeAdapter = createNativeAdapterController(ctx, { live, persist: persistInternal, beforeRequest: economy.guard, deferRestore: lifecycle.restore, noteDispatch: (options, metadata) => {
    metadata.source = probeRequests.has(options) ? 'probe' : 'conversation'
    dispatchMetadata.set(options, metadata)
  } })
  const proxyRuntime = createProxyRuntime(ctx, { live, persist: persistInternal, beforeRequest: economy.guard, onEvent: event => { void statistics.recordEvent(event) }, onRequest: (metrics) => {
    recordSessionRequest({
    ok: metrics.ok, latencyMs: metrics.latencyMs, model: metrics.model,
    promptTokens: metrics.usage?.prompt_tokens, completionTokens: metrics.usage?.completion_tokens,
    reason: metrics.error?.code || '',
    })
    return recordMetrics(metrics)
  } })
  ctx.effect?.(() => async () => {
    shuttingDown = true
    lifecycle.release()
    await catalogRefresh.close()
    await webSearch.close()
    await modelProbe.close()
    await economy.close()
    await providerSyncTail.catch(() => {})
    try { await nativeAdapter.dispose((profile) => proxyRuntime.restoreProvider(profile)) }
    finally { try { await proxyRuntime.dispose() } finally { await statistics.close() } }
  }, 'dsh-clinebot: native adapter and loopback proxy')

  const runProviderSync = async (cfg, options) => {
    const seenEpoch = currentEpoch()
    try {
      const store = await nativeAdapter.prepare(cfg)
      cfg = live()
      const pub = publicConfig(cfg)
      if (!pub.enabled) {
        if (store) await store.remove()
        else if (await checkRegisteredInPiAi(ctx)) {
          await removePiAiProvider(ctx)
        }
        const prepared = await proxyRuntime.prepare(cfg, null)
        await prepared.finish?.()
        return { ok: true, removed: true }
      }
      const credentialEnv = activeCredentialEnv(pub)
      const key = await resolveKeyValue(ctx, credentialEnv)
      const proxyState = await proxyRuntime.prepare(cfg, store ? await store.read() : await readProvider(ctx))
      // The model menu reads this provider document. Leaving it unchanged when
      // the key is missing keeps a stale registration (one model, old base URL).
      const written = await upsertPiAiProvider(ctx, cfg, options?.activeModelIds ?? pub.enabledModels, {
        ...options,
        transport: proxyState.transport,
        store,
        persistHostEdits: async (hostModelOverrides) => {
          if (!settingsApi || currentEpoch() !== seenEpoch) return
          await enqueuePlanWrite(async () => {
            if (currentEpoch() !== seenEpoch) return
            if (JSON.stringify(live().hostModelOverrides) === JSON.stringify(hostModelOverrides)) return
            if (settingsApi.update) await settingsApi.update({ hostModelOverrides })
            else await settingsApi.replace(parseConfig({ ...live(), hostModelOverrides }))
          })
        },
      })
      await proxyState.finish?.()
      if (!key.value && !pub.activeAccount) {
        return { ok: syncState().ok, warning: syncState().warning, written, needsKey: true }
      }
      return { ok: syncState().ok, warning: syncState().warning, written }
    } catch (err) {
      if (!shuttingDown) recordSyncFailure(err)
      return { ok: false, error: String(err?.message || err) }
    }
  }
  let previousAccount = live().activeAccount
  const syncProviderState = (cfg, options) => {
    if (shuttingDown) return Promise.resolve({ ok: false, error: 'ClinePass is shutting down' })
    if (previousAccount !== live().activeAccount) {
      previousAccount = live().activeAccount
      void statistics.recordEvent({ type: 'switch', account: previousAccount || live().apiKeyEnv, reason: 'selection-change' })
    }
    const run = () => { webSearch.sync(); return runProviderSync(live(), options) }
    void economy.autoSync()
    const result = providerSyncTail.then(() => lifecycle.run(run), () => lifecycle.run(run))
    providerSyncTail = result.catch(() => {})
    return result
  }

  const catalogRefresh = createCatalogRefresh(ctx, { live, getSettingsApi: () => settingsApi, syncProviderState, run: task => lifecycle.run(task) })
  const triggerAutoDiscover = () => catalogRefresh.request()

  const bindSettings = (sctx) => {
    const settings = sctx.settings
    const entryId = sctx.fiber?.entry?.options?.id || ctx.fiber?.entry?.options?.id || NS
    const scope = ownSettings(settings, config, entryId, lifecycle)
    if (!scope) return
    settingsApi = scope
    getConfig = () => plainConfig(scope.get?.() ?? config)
    if (typeof settings?.configure === 'function' && ctx.fiber) {
      try {
        const dispose = settings.configure({ auto: false }, ctx.fiber)
        if (typeof sctx.effect === 'function' && typeof dispose === 'function') {
          sctx.effect(() => dispose, 'dsh-clinebot: settings page')
        }
      } catch {
        // A second mount already registered the page policy.
      }
    }
    const runMigrate = () => {
      let cancelled = false
      lifecycle.initialize(async () => {
        const migrated = await migrateStoredConfig(ctx, live(), scope)
        if (cancelled) return null
        return syncProviderState(migrated?.config || live())
      }).catch(() => null)
      return () => { cancelled = true }
    }
    const onCatalogSettings = () => {
      const cfg = live()
      const change = catalogChange(seenCatalog, cfg)
      seenCatalog = change.seen
      void catalogRefresh.changed()
      if (change.changed) {
        clearUsageCache()
        clearProbeCache()
      }
      if (change.reset && typeof settingsApi?.replace === 'function') {
        noteUserWrite()
        enqueuePlanWrite(() => settingsApi.replace(parseConfig(clearPlanDiscovery(live(), cfg)))).then(() => syncProviderState(live())).catch(() => syncProviderState(live()))
        return
      }
      syncProviderState(cfg)
    }
    if (typeof sctx.effect === 'function') {
      sctx.effect(runMigrate, 'dsh-clinebot: migrate')
      if (typeof scope.watch === 'function') {
        sctx.effect(() => scope.watch(onCatalogSettings), 'dsh-clinebot: settings')
      } else if (typeof sctx.on === 'function') {
        sctx.effect(() => sctx.on('loader/volatile-update', () => {
          scope.refresh?.()
          onCatalogSettings()
        }), 'dsh-clinebot: settings')
      }
      sctx.effect(() => () => {
        getConfig = () => plainConfig(config)
        settingsApi = undefined
      })
    } else {
      runMigrate()
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], bindSettings)
  } else {
    const settingsService = (ctx?.get && ctx.get('settings')) || ctx?.settings
    if (settingsService) bindSettings({ ...ctx, settings: settingsService })
  }

  if (!settingsApi) syncProviderState(live())
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      catalogRefresh.start()
      return () => { lifecycle.release(); return catalogRefresh.close() }
    }, 'dsh-clinebot: auto-discover')
  } else {
    catalogRefresh.start()
  }
  ctx.on?.('credentials/reference-updated', ref => {
    const envName = typeof ref === 'string' ? ref : ref?.name
    if (!isKnownAccountEnv(live(), envName)) return
    noteUserWrite()
    if (envName !== activeCredentialEnv(live())) { void syncProviderState(live()).then(() => catalogRefresh.request('credential')).catch(() => {}); return }
    void enqueuePlanWrite(async () => {
      if (shuttingDown) return
      const next = clearPlanDiscovery(live())
      if (settingsApi?.update) await settingsApi.update({ discoveredPlanIds: [], planVerified: false, planSyncedAt: 0, planSyncIdentity: '', catalogMetadata: [], customModels: next.customModels })
    }).then(async () => { await syncProviderState(live()); return catalogRefresh.request('credential') }).catch(() => {})
  }, { global: true })

  const mountWeb = (webCtx) => {
    if (!webCtx.webServer?.register) return
    const unregisterUpdater = registerPluginUpdater(webCtx, {
      endpoint: '/dsh-clinebot/update',
      checker: updater,
    })
    if (typeof webCtx.effect === 'function') {
      webCtx.effect(() => () => unregisterUpdater?.(), 'dsh-clinebot: updater')
    }
    const routeEnv = {
      pluginVersion: runningIdentity.version,
      live,
      getSettingsApi: () => settingsApi,
      syncProviderState,
      triggerAutoDiscover,
      refreshCatalog: triggerAutoDiscover,
      keyDiscovery,
      proxyRuntime,
      nativeAdapter,
      statistics,
      recordMetrics,
      modelProbe,
      webSearch,
      economy,
      unregisterProvider: () => nativeAdapter.store ? nativeAdapter.store.remove() : removePiAiProvider(ctx),
    }
    registerSettingsRoutes(webCtx, routeEnv)
    registerAccountsRoutes(webCtx, routeEnv)
    registerModelsRoutes(webCtx, routeEnv)
    registerAuthRoutes(webCtx, routeEnv)
    registerKeyRoutes(webCtx, routeEnv)
    registerProxyControls(webCtx, routeEnv)
    registerNativeModelRoutes(webCtx, routeEnv)
    registerStatsRoutes(webCtx, routeEnv)
    registerProbeRoutes(webCtx, routeEnv)
    registerEconomyRoutes(webCtx, routeEnv)
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountWeb)

  registerSlashCommand(ctx, {
    live,
    getSettingsApi: () => settingsApi,
    syncProviderState,
    recordMetrics,
    statistics,
    modelProbe,
    economy,
  })

  attachStreamFailover(ctx, {
    live,
    getSettingsApi: () => settingsApi,
    syncProviderState,
    recordMetrics,
    dispatchMetadata,
    probeRequests,
  })

  return {
    getStatus: () => buildStatus(ctx, live()),
    registerProvider: (models) => syncProviderState(live(), { activeModelIds: models }).then((result) => result.written),
    unregisterProvider: () => nativeAdapter.store ? nativeAdapter.store.remove() : removePiAiProvider(ctx),
    recordRequestMetrics: (metrics) => { recordSessionRequest(metrics); return recordMetrics(metrics) },
    getStatistics: (filters) => statistics.query(filters),
    getSessionStats: () => ({ ...sessionStats }),
    getUsageLimits: async () => {
      const pub = publicConfig(live())
      const key = await resolveKeyValue(ctx, pub.apiKeyEnv)
      return fetchUsageLimits(pub.baseUrl, key.value)
    },
    runSmokeTest: async (model) => {
      await economy.guard()
      const pub = publicConfig(live())
      const activeKey = await resolveActiveAccountKey(ctx, live())
      const res = await smokeChat(pub.baseUrl, activeKey.value, { model: model || pub.defaultModel, upstreamPin: upstreamPinFor(pub, model || pub.defaultModel) })
      void recordMetrics(smokeMetrics(res, { model: model || pub.defaultModel, account: activeKey.apiKeyEnv || activeKey.envName, purpose: 'service' }))
      recordSessionRequest({
        latencyMs: res.latencyMs,
        ok: res.ok,
        error: res.error,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        model: res.model || model || pub.defaultModel || '',
        reason: res.ok ? '' : 'smoke',
      })
      if (isRateLimitFailure({ status: res.status, message: res.error })) {
        const before = live()
        const failover = await rotateToNextAccount(ctx, before, 'service_429', settingsApi, live)
        if (failover.rotated) {
          await syncProviderState(failover.config || { ...live(), activeAccount: failover.activeAccount })
        }
      }
      return res
    },
  }
}
