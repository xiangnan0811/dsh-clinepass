import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { writeJson } from '../http.js'

export function registerEconomyRoutes(ctx, { economy }) {
  for (const action of ['prices', 'prices/sync', 'budget']) ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact', path: `/dsh-clinebot/${action}`,
    handler: async (req, res) => {
      const write = action === 'prices/sync'
      if (req.method !== (write ? 'POST' : 'GET')) return writeJson(res, 405, { ok: false, error: 'Invalid method' })
      if (write && !assertTrustedSettingsRequest(req, res)) return
      try {
        const result = write ? await economy.syncPrices() : action === 'budget' ? await economy.status() : await economy.references(new URL(req.url, 'http://localhost').searchParams.get('model') || '')
        writeJson(res, 200, { ok: true, ...result })
      } catch (failure) { writeJson(res, 503, { ok: false, error: failure.message }) }
    },
  }), `dsh-clinebot: ${action}`)
}
