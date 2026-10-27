import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { writeJson } from '../http.js'

// models 为会话中用到的模型（逗号分隔），用于返回自动匹配的参考价。
function referenceQuery(req) {
  const params = new URL(req.url, 'http://localhost').searchParams
  const models = (params.get('models') || '').split(',').map(value => value.trim()).filter(Boolean)
  if (models.length > 50 || models.some(value => value.length > 256)) throw new Error('Too many or too long model names')
  return [params.get('model') || '', [...new Set(models)]]
}

export function registerEconomyRoutes(ctx, { economy }) {
  for (const action of ['prices', 'prices/sync', 'budget']) ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact', path: `/dsh-clinebot/${action}`,
    handler: async (req, res) => {
      const write = action === 'prices/sync'
      if (req.method !== (write ? 'POST' : 'GET')) return writeJson(res, 405, { ok: false, error: 'Invalid method' })
      if (write && !assertTrustedSettingsRequest(req, res)) return
      try {
        const result = write ? await economy.syncPrices() : action === 'budget' ? await economy.status() : await economy.references(...referenceQuery(req))
        writeJson(res, 200, { ok: true, ...result })
      } catch (failure) { writeJson(res, 503, { ok: false, error: failure.message }) }
    },
  }), `dsh-clinebot: ${action}`)
}
