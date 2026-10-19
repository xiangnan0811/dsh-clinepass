import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { readBody, writeJson } from '../http.js'

export function registerNativeModelRoutes(ctx, { live, nativeAdapter, syncProviderState }) {
  ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact', path: '/dsh-clinebot/native-models',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'GET or POST only' })
      if (req.method === 'POST' && !assertTrustedSettingsRequest(req, res)) return
      try {
        const store = nativeAdapter.store
        if (req.method === 'GET') {
          const profile = store ? await store.read() : null
          return writeJson(res, 200, { ok: true, active: !!store, models: (profile?.models || []).map((model) => ({ id: model.id, name: model.name, contextWindow: model.contextWindow ?? null, maxTokens: model.maxTokens ?? null, input: model.input || ['text'] })) })
        }
        if (!store) return writeJson(res, 409, { ok: false, error: 'Use the native editor while the ClinePass adapter extension is inactive' })
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const patch = {}
        for (const field of ['contextWindow', 'maxTokens']) {
          if (body[field] === undefined) continue
          if (body[field] !== 'inherit' && (!Number.isSafeInteger(body[field]) || body[field] <= 0)) return writeJson(res, 400, { ok: false, error: 'A positive token count or inherit is required' })
          patch[field] = body[field]
        }
        if (body.input !== undefined && !['text', 'text+image'].includes(body.input)) return writeJson(res, 400, { ok: false, error: 'Invalid input capability' })
        await store.patch((profile) => {
          if (!profile?.models?.some((model) => model.id === body.id)) throw new Error('Native model not found')
          return { ...profile, models: profile.models.map((model) => {
            if (model.id !== body.id) return model
            const next = { ...model }
            for (const [field, value] of Object.entries(patch)) {
              if (value === 'inherit') delete next[field]
              else next[field] = value
            }
            if (body.input) next.input = body.input === 'text+image' ? ['text', 'image'] : ['text']
            return next
          }) }
        })
        const result = await syncProviderState(live())
        return writeJson(res, result.ok ? 200 : 502, { ok: result.ok, error: result.error })
      } catch (error) { writeJson(res, 400, { ok: false, error: String(error.message || error) }) }
    },
  }), 'dsh-clinebot: native model editor')
}
