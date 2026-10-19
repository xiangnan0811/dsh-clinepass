import { Config, parseConfig, publicConfig, plainConfig, NS, LLM_PI_AI_NS } from './config.js'
import { registerPluginUpdater } from './updater.js'
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
  autoDiscoverPlanModels,
  resolveActiveAccountKey,
  migrateStoredConfig,
  syncState,
  enqueuePlanWrite,
  noteUserWrite,
  currentEpoch,
  readProvider,
} from './provider-sync.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerAccountsRoutes } from './routes/accounts.js'
import { registerModelsRoutes } from './routes/models.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerKeyRoutes } from './routes/keys.js'
import { createKeyDiscovery } from './key-discovery.js'
import { registerSlashCommand } from './slash-command.js'
import { activeCredentialEnv, isRateLimitFailure } from './account-pool.js'
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

export const name = 'dsh-clinepass'
export const inject = ['settings', 'credentials']

export { NS, LLM_PI_AI_NS, Config, sessionStats, recordSessionRequest, resetSessionStats, rotateToNextAccount }

function ownSettings(settings, config, entryId) {
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
      const next = plainConfig({ ...read(), ...plainConfig(patch) })
      await settings.update(entryId, next)
      written = next
    },
    replace: async (section) => {
      const next = plainConfig(section)
      await settings.replace(entryId, next)
      written = next
    },
  }
}

export function apply(ctx, config) {
  const keyDiscovery = createKeyDiscovery()
  ctx.effect?.(() => () => keyDiscovery.clear(), 'dsh-clinebot: discovered key handles')
  let getConfig = () => plainConfig(config)
  const live = () => parseConfig(structuredClone(plainConfig(getConfig())))
  let settingsApi
  let seenCatalog = null
  let providerSyncTail = Promise.resolve()
  let shuttingDown = false
  const statistics = createStatsRuntime(ctx)
  const recordMetrics = (metrics) => statistics.record(metrics)
  const dispatchMetadata = new WeakMap()
  const probeRequests = new WeakSet()
  const modelProbe = createModelProbe(ctx, { live, probeRequests })
  registerSessionUsage(ctx)
  const persistInternal = (patch) => enqueuePlanWrite(async () => {
      if (!settingsApi) throw new Error('Settings are unavailable for proxy configuration')
      const change = typeof patch === 'function' ? patch(live()) : patch
      if (settingsApi.update) await settingsApi.update(change)
      else await settingsApi.replace(parseConfig({ ...live(), ...change }))
    })
  const nativeAdapter = createNativeAdapterController(ctx, { live, persist: persistInternal, noteDispatch: (options, metadata) => {
    metadata.source = probeRequests.has(options) ? 'probe' : 'conversation'
    dispatchMetadata.set(options, metadata)
  } })
  const proxyRuntime = createProxyRuntime(ctx, { live, persist: persistInternal, onRequest: (metrics) => {
    recordSessionRequest({
    ok: metrics.ok, latencyMs: metrics.latencyMs, model: metrics.model,
    promptTokens: metrics.usage?.prompt_tokens, completionTokens: metrics.usage?.completion_tokens,
    reason: metrics.error?.code || '',
    })
    return recordMetrics(metrics)
  } })
  ctx.effect?.(() => async () => {
    shuttingDown = true
    await modelProbe.close()
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
      return { ok: false, error: String(err?.message || err) }
    }
  }
  const syncProviderState = (cfg, options) => {
    if (shuttingDown) return Promise.resolve({ ok: false, error: 'ClinePass is shutting down' })
    const run = () => runProviderSync(live(), options)
    const result = providerSyncTail.then(run, run)
    providerSyncTail = result.catch(() => {})
    return result
  }

  const triggerAutoDiscover = () => {
    autoDiscoverPlanModels(ctx, { live, getSettingsApi: () => settingsApi, syncProviderState })
  }

  const bindSettings = (sctx) => {
    const settings = sctx.settings
    const entryId = sctx.fiber?.entry?.options?.id || ctx.fiber?.entry?.options?.id || NS
    const scope = ownSettings(settings, config, entryId)
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
      migrateStoredConfig(ctx, live(), scope).then((migrated) => {
        if (cancelled) return null
        return syncProviderState(migrated?.config || live())
      }).catch(() => null)
      return () => { cancelled = true }
    }
    const onCatalogSettings = () => {
      const cfg = live()
      const change = catalogChange(seenCatalog, cfg)
      seenCatalog = change.seen
      if (change.changed) {
        clearUsageCache()
        clearProbeCache()
      }
      if (change.reset && typeof settingsApi?.replace === 'function') {
        const cleared = parseConfig(change.config)
        noteUserWrite()
        enqueuePlanWrite(() => settingsApi.replace(cleared)).then(() => syncProviderState(cleared)).catch(() => syncProviderState(cfg))
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
      const timer = setTimeout(triggerAutoDiscover, 500)
      return () => clearTimeout(timer)
    }, 'dsh-clinebot: auto-discover')
  } else {
    setTimeout(triggerAutoDiscover, 500)
  }

  const mountWeb = (webCtx) => {
    if (!webCtx.webServer?.register) return
    const unregisterUpdater = registerPluginUpdater(webCtx, {
      endpoint: '/dsh-clinebot/update',
      packageName: name,
      manifestUrl: new URL('../package.json', import.meta.url),
      // Publish identity is not confirmed. Do not install or check the upstream package.
      registry: false,
    })
    if (typeof webCtx.effect === 'function') {
      webCtx.effect(() => () => unregisterUpdater?.(), 'dsh-clinebot: updater')
    }
    const routeEnv = {
      live,
      getSettingsApi: () => settingsApi,
      syncProviderState,
      triggerAutoDiscover,
      keyDiscovery,
      proxyRuntime,
      nativeAdapter,
      statistics,
      recordMetrics,
      modelProbe,
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
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountWeb)

  registerSlashCommand(ctx, {
    live,
    getSettingsApi: () => settingsApi,
    syncProviderState,
    recordMetrics,
    statistics,
    modelProbe,
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
      const pub = publicConfig(live())
      const activeKey = await resolveActiveAccountKey(ctx, live())
      const res = await smokeChat(pub.baseUrl, activeKey.value, { model: model || pub.defaultModel })
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
        const failover = await rotateToNextAccount(ctx, before, 'service_429', settingsApi)
        if (failover.rotated) {
          await syncProviderState(failover.config || { ...live(), activeAccount: failover.activeAccount })
        }
      }
      return res
    },
  }
}
