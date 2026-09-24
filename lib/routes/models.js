import { writeJson, readBody } from '../http.js'
import { isTrustedSettingsRequest, assertTrustedSettingsRequest } from '../access.js'
import { publicConfig, Config } from '../config.js'
import { resolveActiveAccountKey, resolvePathWithHome, noteUserWrite } from '../provider-sync.js'
import { getAllModels, mergeDiscovered, saveModelsDiskCache, upsertOverride, selectedIds } from '../models.js'
import { fetchUsageLimits } from '../cline-client.js'

export function registerModelsRoutes(ctx, { live, getSettingsApi, syncProviderState }) {
  // POST /dsh-clinebot/models/sync — dynamically load models from plan
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/models/sync',
    handler: async (req, res) => {
      if (!assertTrustedSettingsRequest(req, res)) return
      if (req.method !== 'POST') {
        return writeJson(res, 405, { ok: false, error: 'POST only' })
      }
      try {
        const pub = publicConfig(live())
        const activeKey = await resolveActiveAccountKey(ctx, live())
        if (!activeKey.value) {
          return writeJson(res, 400, { ok: false, error: 'API key not configured' })
        }

        const usageData = await fetchUsageLimits(pub.baseUrl, activeKey.value, {
          timeoutMs: pub.timeoutMs,
          bypassCache: true,
        })

        if (!usageData.ok) {
          return writeJson(res, 502, { ok: false, error: usageData.error || 'Failed to fetch plan models' })
        }

        const discovered = Array.isArray(usageData.dynamicModels) ? usageData.dynamicModels : []
        const settingsApi = getSettingsApi()
        if (!settingsApi?.replace && !settingsApi?.update) {
          return writeJson(res, 503, { ok: false, error: 'settings not ready' })
        }
        noteUserWrite()
        const merged = mergeDiscovered(live(), discovered)
        const next = Config({
          ...live(),
          discoveredPlanIds: merged.discoveredPlanIds,
          customModels: merged.customModels,
        })
        if (settingsApi.update) {
          await settingsApi.update({
            discoveredPlanIds: next.discoveredPlanIds,
            customModels: next.customModels,
          })
        } else {
          await settingsApi.replace(next)
        }
        const synced = await syncProviderState(live())
        if (synced && synced.ok === false) {
          return writeJson(res, 502, { ok: false, error: synced.error || 'provider sync failed' })
        }
        const cacheFile = resolvePathWithHome(pub.modelsCachePath)
        if (cacheFile) {
          await saveModelsDiskCache(cacheFile, {
            discoveredIds: next.discoveredPlanIds,
            unknownModels: next.customModels || [],
          })
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
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/models/toggle',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      try {
        const bodyBuf = await readBody(req)
        let body = {}
        try { body = JSON.parse(bodyBuf.toString('utf8')) } catch { body = {} }

        const settingsApi = getSettingsApi()
        if (!settingsApi?.replace) {
          return writeJson(res, 503, { ok: false, error: 'settings not ready' })
        }
        const patch = {}
        if (body.selectionKind === 'explicit' || body.selectionKind === 'all-except-disabled') {
          patch.selectionKind = body.selectionKind
        }
        if (Array.isArray(body.explicitModels)) patch.explicitModels = body.explicitModels
        if (Array.isArray(body.disabledModels)) {
          patch.disabledModels = body.disabledModels
          if (!patch.selectionKind) patch.selectionKind = 'all-except-disabled'
        } else if (Array.isArray(body.enabledModels)) {
          patch.selectionKind = 'explicit'
          patch.explicitModels = body.enabledModels
        }
        if (body.defaultModel) patch.defaultModel = body.defaultModel
        if (body.providerReasoning !== undefined) patch.providerReasoning = String(body.providerReasoning || '')
        if (body.modelOverride && body.modelOverride.id) {
          patch.modelOverrides = upsertOverride(live().modelOverrides, body.modelOverride.id, body.modelOverride)
        }
        noteUserWrite()
        const next = Config({ ...live(), ...patch })
        await settingsApi.replace(next)
        const synced = await syncProviderState(next)
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
  ctx.effect(() => ctx.webServer.register({
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
        })
        if (!usageData.ok) {
          return writeJson(res, 502, {
            ...usageData,
            error: usageData.error || '配额请求失败',
          })
        }
        writeJson(res, 200, usageData)
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /usage')
}
