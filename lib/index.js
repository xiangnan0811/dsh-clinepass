import { Config, publicConfig, plainConfig, NS, LLM_PI_AI_NS } from './config.js'
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
  let getConfig = () => plainConfig(config)
  const live = () => plainConfig(Config(structuredClone(plainConfig(getConfig()))))
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
    if (typeof sctx.effect === 'function') {
      sctx.effect(runMigrate, 'dsh-clinebot: migrate')
      if (typeof scope.watch === 'function') {
        sctx.effect(() => scope.watch(() => {
          syncProviderState(live())
        }), 'dsh-clinebot: settings')
      } else if (typeof sctx.on === 'function') {
        sctx.effect(() => sctx.on('loader/volatile-update', () => {
          scope.refresh?.()
          syncProviderState(live())
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
