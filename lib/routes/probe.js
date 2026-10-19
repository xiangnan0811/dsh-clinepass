import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { readBody, writeJson } from '../http.js'

export function registerProbeRoutes(ctx, { modelProbe }) {
  ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact', path: '/dsh-clinebot/probe',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      const controller = new AbortController()
      const aborted = () => { if (!res.writableFinished) controller.abort() }
      req.on('aborted', aborted); res.on('close', aborted)
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8'))
        const result = await modelProbe.run(body.model, { signal: controller.signal })
        if (!res.destroyed) writeJson(res, result.ok ? 200 : result.error === 'PROBE_TIMEOUT' ? 504 : result.error === 'CANCELLED' ? 499 : 502, result)
      } catch (error) { if (!res.destroyed) writeJson(res, 400, { ok: false, error: String(error.message || error) }) }
      finally { controller.abort(); req.off('aborted', aborted); res.off('close', aborted) }
    },
  }), 'dsh-clinebot: streaming model probe')
}
