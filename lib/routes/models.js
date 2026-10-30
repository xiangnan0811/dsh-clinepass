import { writeJson, readBody } from '../http.js'
import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { publicConfig, parseConfig } from '../config.js'
import { resolveActiveAccountKey, autoDiscoverPlanModels, enqueuePlanWrite, noteUserWrite, currentEpoch } from '../provider-sync.js'
import { selectedIds } from '../models.js'
import { applyModelManagement } from '../model-management.js'
import { hostFieldsToReset } from '../host-model-edits.js'
import { fetchUsageLimits, collectAccountUsage, presentUsage } from '../cline-client.js'
import { resolveAccountPool, activeCredentialEnv } from '../account-pool.js'
import { discoverModels } from '../model-discovery.js'

export function registerModelsRoutes(ctx, { live, getSettingsApi, syncProviderState, refreshCatalog }) {
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
        noteUserWrite()
        const result = await (refreshCatalog ? refreshCatalog() : autoDiscoverPlanModels(ctx, { live, getSettingsApi, syncProviderState }))
        const status = result?.ok ? 200 : result?.skipped === 'stale' ? 409 : ['not-ready', 'disabled', 'stopped'].includes(result?.skipped) ? 503 : result?.skipped === 'no-key' ? 400 : 502
        return writeJson(res, status, { ...result, totalModelsCount: result?.models?.length, error: result?.error || (!result?.ok ? 'Model sync unavailable; retry after settings and credentials are ready.' : '') })
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
