import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { readBody, writeJson } from '../http.js'
import { isKnownAccountEnv } from '../account-pool.js'

export const IMAGE_FIELDS = ['maxRequestImageBytes', 'requestImagePixelBudget', 'requestImageMaxBytes']

export function registerProxyControls(ctx, { live, proxyRuntime, nativeAdapter, syncProviderState }) {
  for (const action of ['status', 'cooldown', 'images']) {
    ctx.effect(() => registerAuthenticatedRoute(ctx, {
      kind: 'exact', path: `/dsh-clinebot/proxy/${action}`,
      handler: async (req, res) => {
        if (req.method !== (action === 'status' ? 'GET' : 'POST')) return writeJson(res, 405, { ok: false, error: 'Invalid method' })
        if (action === 'status') return writeJson(res, 200, { ok: true, ...proxyRuntime.status() })
        if (!assertTrustedSettingsRequest(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
          if (action === 'cooldown') {
            if (!isKnownAccountEnv(live(), body.account)) return writeJson(res, 400, { ok: false, error: 'Account not found' })
            proxyRuntime.clearCooldown(body.account)
          } else {
            const operations = []
            for (const field of IMAGE_FIELDS) {
              if (body[field] === undefined) continue
              const value = body[field]
              if (value !== 'inherit' && (!Number.isSafeInteger(value) || value <= 0)) return writeJson(res, 400, { ok: false, error: `${field} must be a positive integer or inherit` })
              operations.push({ op: value === 'inherit' ? 'unset' : 'set', path: [field], value })
            }
            if (nativeAdapter.store) {
              const profile = await nativeAdapter.store.read()
              if (!profile) return writeJson(res, 409, { ok: false, error: 'Register a model before editing its image limits' })
              await nativeAdapter.store.patch((current) => {
                if (!current) throw new Error('Provider was removed while saving image limits')
                const next = { ...current }
                for (const operation of operations) {
                  if (operation.op === 'unset') delete next[operation.path[0]]
                  else next[operation.path[0]] = operation.value
                }
                return next
              })
            } else {
              await ctx.settings.mutate('llm-pi-ai', operations.map((operation) => ({ ...operation, path: ['providers', 'clinebot', ...operation.path] })))
            }
            const synced = await syncProviderState(live())
            if (!synced.ok) return writeJson(res, 502, { ok: false, error: synced.error })
          }
          writeJson(res, 200, { ok: true })
        } catch (error) { writeJson(res, 400, { ok: false, error: String(error.message || error) }) }
      },
    }), `dsh-clinebot: proxy/${action}`)
  }
}
