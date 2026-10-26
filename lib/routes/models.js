import { writeJson, readBody } from '../http.js'
import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { publicConfig, parseConfig } from '../config.js'
import { resolveActiveAccountKey, resolvePathWithHome, enqueuePlanWrite, noteUserWrite, currentEpoch } from '../provider-sync.js'
import { getAllModels, mergeDiscovered, saveModelsDiskCache, selectedIds } from '../models.js'
import { applyModelManagement } from '../model-management.js'
import { hostFieldsToReset } from '../host-model-edits.js'
import { fetchUsageLimits, catalogIdentity, collectAccountUsage, presentUsage } from '../cline-client.js'
import { resolveAccountPool, activeCredentialEnv } from '../account-pool.js'
import { discoverModels } from '../model-discovery.js'

export function registerModelsRoutes(ctx, { live, getSettingsApi, syncProviderState }) {
  ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: '/dsh-clinebot/models/discover',
    handler: async (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'GET only' })
      try {
        const seen = currentEpoch(), cfg = live(), pub = publicConfig(cfg)
        const activeKey = await resolveActiveAccountKey(ctx, cfg)
        const result = await discoverModels(pub.baseUrl, activeKey.value, { timeoutMs: pub.timeoutMs })
        if (currentEpoch() !== seen) return writeJson(res, 409, { ok: false, error: 'Configuration changed during discovery; retry' })
        return writeJson(res, result.ok ? 200 : 502, result)
      } catch {
        return writeJson(res, 500, { ok: false, error: 'Model discovery failed' })
      }
    },
  }), 'dsh-clinebot: /models/discover')

  // POST /dsh-clinebot/models/sync — dynamically load models from plan
  ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: '/dsh-clinebot/models/sync',
    handler: async (req, res) => {
      if (!assertTrustedSettingsRequest(req, res)) return
      if (req.method !== 'POST') {
        return writeJson(res, 405, { ok: false, error: 'POST only' })
      }
      try {
        const seen = noteUserWrite()
        const pub = publicConfig(live())
        const activeKey = await resolveActiveAccountKey(ctx, live())
        if (!activeKey.value) {
          return writeJson(res, 400, { ok: false, error: 'API key not configured' })
        }

        const usageData = await fetchUsageLimits(pub.baseUrl, activeKey.value, {
          timeoutMs: pub.timeoutMs,
          bypassCache: true,
        })

        if (!usageData.ok || !usageData.planModelsVerified) {
          return writeJson(res, 502, { ok: false, error: usageData.error || 'Failed to fetch plan models' })
        }

        const discovered = Array.isArray(usageData.dynamicModels) ? usageData.dynamicModels : []
        const settingsApi = getSettingsApi()
        if (!settingsApi?.replace && !settingsApi?.update) {
          return writeJson(res, 503, { ok: false, error: 'settings not ready' })
        }
        let next
        await enqueuePlanWrite(async () => {
          if (currentEpoch() !== seen) return
          const merged = mergeDiscovered(live(), discovered)
          next = parseConfig({ ...live(), discoveredPlanIds: merged.discoveredPlanIds, customModels: merged.customModels, planVerified: true })
          if (settingsApi.update) {
            await settingsApi.update({
              discoveredPlanIds: next.discoveredPlanIds,
              customModels: next.customModels,
              planVerified: true,
            })
          } else {
            await settingsApi.replace(next)
          }
          const cacheFile = resolvePathWithHome(pub.modelsCachePath)
          if (cacheFile && currentEpoch() === seen) {
            await saveModelsDiskCache(cacheFile, {
              discoveredIds: next.discoveredPlanIds,
              unknownModels: next.customModels || [],
              identity: catalogIdentity(next),
            })
          }
        })
        if (!next || currentEpoch() !== seen) return writeJson(res, 409, { ok: false, error: 'Configuration changed during plan sync; retry' })
        const synced = await syncProviderState(live())
        if (synced && synced.ok === false) {
          return writeJson(res, 502, { ok: false, error: synced.error || 'provider sync failed' })
        }
        const models = getAllModels(live())
        return writeJson(res, 200, {
          ok: true,
          plan: usageData.plan,
          discoveredCount: discovered.length,
          totalModelsCount: models.length,
          models,
          warning: synced?.warning || '',
        })
      } catch (err) {
        return writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /models/sync')

  // POST /dsh-clinebot/models/toggle — toggle disabled/enabled status in picker
  ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: '/dsh-clinebot/models/toggle',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')

        const settingsApi = getSettingsApi()
        if (!settingsApi?.replace) {
          return writeJson(res, 503, { ok: false, error: 'settings not ready' })
        }
        noteUserWrite()
        let next
        try {
          await enqueuePlanWrite(async () => {
            next = parseConfig(applyModelManagement(live(), body))
            await settingsApi.replace(next)
          })
        } catch (err) {
          return writeJson(res, 400, { ok: false, error: String(err?.message || err) })
        }
        const synced = await syncProviderState(next, { resetHostFields: hostFieldsToReset(body) })
        if (synced && synced.ok === false) {
          return writeJson(res, 502, { ok: false, error: synced.error || 'provider sync failed' })
        }
        const view = publicConfig(next)
        writeJson(res, 200, {
          ok: true,
          disabledModels: view.disabledModels,
          explicitModels: view.explicitModels,
          selectionKind: view.selectionKind,
          enabledModels: selectedIds(view.availableModels, next),
          warning: synced?.warning || '',
        })
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /models/toggle')

  // GET /dsh-clinebot/usage — direct fresh usage limit query
  ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: '/dsh-clinebot/usage',
    handler: async (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'GET only' })
      try {
        const pub = publicConfig(live())
        const activeKey = await resolveActiveAccountKey(ctx, live())
        if (!activeKey.value) {
          return writeJson(res, 400, { ok: false, error: 'API key not found' })
        }
        const usageData = await fetchUsageLimits(pub.baseUrl, activeKey.value, {
          timeoutMs: pub.timeoutMs,
          bypassCache: true,
          remember: false,
        })
        const shown = presentUsage(usageData)
        if (!shown.ok) {
          return writeJson(res, 502, {
            ...shown,
            error: shown.error || '配额请求失败',
          })
        }
        writeJson(res, 200, shown)
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /usage')

  // GET /dsh-clinebot/usage/accounts — other saved keys, without filling the failover cache
  ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: '/dsh-clinebot/usage/accounts',
    handler: async (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'GET only' })
      try {
        const cfg = live()
        const pub = publicConfig(cfg)
        let fresh = false
        try {
          fresh = new URL(req.url || '', 'http://127.0.0.1').searchParams.get('fresh') === '1'
        } catch {
          fresh = false
        }
        const pool = await resolveAccountPool(ctx, cfg)
        const accounts = await collectAccountUsage(pool, {
          baseUrl: pub.baseUrl,
          timeoutMs: pub.timeoutMs,
          activeEnv: activeCredentialEnv(cfg),
          fresh,
        })
        writeJson(res, 200, { ok: true, accounts })
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /usage/accounts')
}
