import { writeJson, readBody } from '../http.js'
import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { fetchUsageLimits, presentUsage } from '../cline-client.js'
import { publicConfig } from '../config.js'

export function registerKeyRoutes(ctx, { live, keyDiscovery }) {
  for (const action of ['discover', 'validate']) {
    ctx.effect(() => registerAuthenticatedRoute(ctx, {
      kind: 'exact', path: `/dsh-clinebot/keys/${action}`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
        if (!assertTrustedSettingsRequest(req, res)) return
        try {
          if (action === 'discover') return writeJson(res, 200, { ok: true, ...await keyDiscovery.discover() })
          const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
          const key = body.discoveryId ? keyDiscovery.resolve(body.discoveryId) : String(body.apiKey || '').trim()
          if (!key) return writeJson(res, 400, { ok: false, error: 'API key required' })
          const cfg = publicConfig(live())
          const usage = await fetchUsageLimits(cfg.baseUrl, key, { timeoutMs: cfg.timeoutMs, bypassCache: true })
          const shown = presentUsage(usage)
          writeJson(res, 200, {
            ok: true, validated: usage.ok === true,
            error: usage.ok ? undefined : String(usage.error || 'Validation failed').split(key).join('[redacted]'),
            plan: usage.ok ? shown.plan : undefined,
            windows: usage.ok ? shown.windows : undefined,
          })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: String(error.message || error) })
        }
      },
    }), `dsh-clinebot: keys/${action}`)
  }
}
