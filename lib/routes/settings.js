import { writeJson, readBody } from '../http.js'
import { isTrustedSettingsRequest, assertTrustedSettingsRequest } from '../access.js'
import { publicConfig, Config } from '../config.js'
import { buildStatus, enqueuePlanWrite, noteUserWrite } from '../provider-sync.js'
import { saveCredentialKey, smokeChat, DEFAULT_API_KEY_ENV, clearUsageCache, clearProbeCache, applyCatalogIdentity } from '../cline-client.js'
import { resolveSaveKeyEnv, activeCredentialEnv } from '../account-pool.js'
import { clearPlanDiscovery, invalidateModelsDiskCache, planDiscoveryDirty } from '../models.js'

export function registerSettingsRoutes(ctx, { live, getSettingsApi, syncProviderState, triggerAutoDiscover }) {
  // 1. GET /dsh-clinebot/status
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/status',
    handler: async (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'GET only' })
      try {
        const st = await buildStatus(ctx, live())
        writeJson(res, 200, st)
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /status')

  // 2. GET & PUT /dsh-clinebot/config
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/config',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        return writeJson(res, 200, { ok: true, config: publicConfig(live()) })
      }
      if (req.method !== 'PUT') {
        return writeJson(res, 405, { ok: false, error: 'GET or PUT' })
      }
      if (!isTrustedSettingsRequest(req)) {
        return writeJson(res, 403, { ok: false, error: 'same-origin only' })
      }
      const settingsApi = getSettingsApi()
      if (!settingsApi) {
        return writeJson(res, 503, { ok: false, error: 'settings not ready' })
      }
      let payload
      try {
        payload = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      } catch {
        return writeJson(res, 400, { ok: false, error: 'invalid json' })
      }
      if (payload && typeof payload.config === 'object') payload = payload.config
      try {
        noteUserWrite()
        const previous = live()
        const drafted = { ...previous, ...payload }
        const adopted = applyCatalogIdentity(previous, drafted)
        if (adopted !== drafted) {
          clearUsageCache()
          clearProbeCache()
        }
        const parsed = Config(adopted)
        await enqueuePlanWrite(() => settingsApi.replace(parsed))
        const synced = await syncProviderState(parsed)
        if (synced && synced.ok === false) {
          return writeJson(res, 502, { ok: false, error: synced.error || 'provider sync failed', config: publicConfig(live()) })
        }
        writeJson(res, 200, { ok: true, config: publicConfig(live()), warning: synced?.warning || '' })
      } catch (e) {
        writeJson(res, 400, { ok: false, error: String(e?.message || e) })
      }
    },
  }), 'dsh-clinebot: /config')

  // 3. POST /dsh-clinebot/save-key — direct saving into DSH credentials service
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/save-key',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      try {
        const bodyBuf = await readBody(req)
        let body = {}
        try { body = JSON.parse(bodyBuf.toString('utf8')) } catch { body = {} }

        const apiKey = String(body.apiKey || '').trim()
        if (!apiKey) {
          return writeJson(res, 400, { ok: false, error: 'API key cannot be empty' })
        }

        const pub = publicConfig(live())
        const target = resolveSaveKeyEnv(body.apiKeyEnv, pub.apiKeyEnv || DEFAULT_API_KEY_ENV)
        if (!target.ok) return writeJson(res, 400, { ok: false, error: target.error })
        const targetEnvName = target.apiKeyEnv
        await saveCredentialKey(ctx, targetEnvName, apiKey)

        let warning = ''
        const current = live()
        if (targetEnvName === activeCredentialEnv(current) && planDiscoveryDirty(current)) {
          const settingsApi = getSettingsApi()
          if (settingsApi?.replace) {
            const cleared = Config(clearPlanDiscovery(current))
            noteUserWrite()
            try {
              await enqueuePlanWrite(async () => {
                await settingsApi.replace(cleared)
                clearUsageCache()
                clearProbeCache()
                // Cache identity is the address and credential name, not the secret.
                // Without this delete, the next discovery reloads the previous plan.
                const dropped = await invalidateModelsDiskCache(pub.modelsCachePath)
                if (!dropped) warning = 'plan_list'
              })
            } catch {
              warning = 'plan_list'
            }
          } else {
            warning = 'plan_list'
          }
        }

        await syncProviderState(live())
        triggerAutoDiscover()

        const validation = await smokeChat(pub.baseUrl, apiKey, {
          model: pub.defaultModel,
          timeoutMs: 15000,
        })

        writeJson(res, 200, {
          ok: true,
          envName: targetEnvName,
          validated: validation.ok,
          latencyMs: validation.latencyMs,
          validationError: validation.ok ? null : validation.error,
          ...(warning ? { warning } : {}),
        })
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /save-key')
}
