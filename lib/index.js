import { Config, publicConfig, NS, LLM_PI_AI_NS } from './config.js'
import { registerPluginUpdater } from './updater.js'
import {
  sessionStats,
  recordSessionRequest,
  resetSessionStats,
  rotateToNextAccount,
  resolveKeyValue,
  smokeChat,
  fetchUsageLimits,
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
} from './provider-sync.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerAccountsRoutes } from './routes/accounts.js'
import { registerModelsRoutes } from './routes/models.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerSlashCommand } from './slash-command.js'
import { activeCredentialEnv } from './account-pool.js'

export const name = 'dsh-clinepass'
export const inject = ['settings', 'credentials']

export { NS, LLM_PI_AI_NS, Config, sessionStats, recordSessionRequest, resetSessionStats, rotateToNextAccount }

export function apply(ctx, config) {
  let getConfig = () => config
  const live = () => (getConfig() ? Config(structuredClone(getConfig())) : config)
  let settingsApi

  const syncProviderState = async (cfg) => {
    try {
      const pub = publicConfig(cfg)
      if (!pub.enabled) {
        if (await checkRegisteredInPiAi(ctx)) {
          await removePiAiProvider(ctx)
        }
        return { ok: true, removed: true }
      }
      const credentialEnv = activeCredentialEnv(pub)
      const key = await resolveKeyValue(ctx, credentialEnv)
      // The model menu reads this provider document. Leaving it unchanged when
      // the key is missing keeps a stale registration (one model, old base URL).
      const written = await upsertPiAiProvider(ctx, cfg, pub.enabledModels)
      if (!key.value && !pub.activeAccount) {
        return { ok: syncState().ok, warning: syncState().warning, written, needsKey: true }
      }
      return { ok: syncState().ok, warning: syncState().warning, written }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) }
    }
  }

  const triggerAutoDiscover = () => {
    autoDiscoverPlanModels(ctx, { live, getSettingsApi: () => settingsApi, syncProviderState })
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (sctx) => {
      const scope = sctx.settings.register(NS, Config, { base: config })
      settingsApi = scope
      getConfig = () => (scope?.get?.() ?? config) ?? config
      sctx.effect(() => {
        let cancelled = false
        migrateStoredConfig(ctx, live(), scope).then((migrated) => {
          if (cancelled) return null
          return syncProviderState(migrated?.config || live())
        }).catch(() => null)
        return () => { cancelled = true }
      }, 'dsh-clinebot: migrate')
      sctx.effect(() => scope.watch(() => {
        syncProviderState(live())
      }), 'dsh-clinebot: settings')
      sctx.effect(() => () => {
        getConfig = () => config
        settingsApi = undefined
      })
    })
  } else {
    const settingsService = (ctx?.get && ctx.get('settings')) || ctx?.settings
    if (typeof settingsService?.register === 'function') {
      const scope = settingsService.register(NS, Config, { base: config })
      settingsApi = scope
      getConfig = () => (scope?.get?.() ?? config) ?? config
      const runMigrate = () => {
        migrateStoredConfig(ctx, live(), scope).then((migrated) => syncProviderState(migrated?.config || live())).catch(() => null)
      }
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => scope.watch(() => {
          syncProviderState(live())
        }), 'dsh-clinebot: settings')
        ctx.effect(() => {
          let cancelled = false
          runMigrate()
          return () => { cancelled = true }
        }, 'dsh-clinebot: migrate')
      } else {
        runMigrate()
      }
    }
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
    }
    registerSettingsRoutes(webCtx, routeEnv)
    registerAccountsRoutes(webCtx, routeEnv)
    registerModelsRoutes(webCtx, routeEnv)
    registerAuthRoutes(webCtx, routeEnv)
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountWeb)

  registerSlashCommand(ctx, {
    live,
    getSettingsApi: () => settingsApi,
    syncProviderState,
  })

  return {
    getStatus: () => buildStatus(ctx, live()),
    registerProvider: (models) => upsertPiAiProvider(ctx, live(), models),
    unregisterProvider: () => removePiAiProvider(ctx),
    recordRequestMetrics: (metrics) => recordSessionRequest(metrics),
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
      recordSessionRequest({
        latencyMs: res.latencyMs,
        ok: res.ok,
        error: res.error,
        promptTokens: res.promptTokens || 5,
        completionTokens: res.completionTokens || 10,
      })
      if (res.status === 429) {
        const failover = await rotateToNextAccount(ctx, live(), 'service_429', settingsApi)
        if (failover.rotated) {
          await syncProviderState(live())
        }
      }
      return res
    },
  }
}
