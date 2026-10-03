import { writeJson, readBody } from '../http.js'
import { assertTrustedSettingsRequest } from '../access.js'
import { publicConfig, plainConfig, Config } from '../config.js'
import { upsertPiAiProvider, removePiAiProvider, enqueuePlanWrite, noteUserWrite } from '../provider-sync.js'
import { clearUsageCache, clearProbeCache, saveCredentialKey, applyCatalogIdentity } from '../cline-client.js'
import { upsertAccount, dropAccount, deleteCredentialKey, isKnownAccountEnv, commitAddedAccount } from '../account-pool.js'

function settingsOr503(res, getSettingsApi) {
  const settingsApi = getSettingsApi()
  if (!settingsApi || typeof settingsApi.replace !== 'function') {
    writeJson(res, 503, { ok: false, error: 'settings' })
    return null
  }
  return settingsApi
}

export function registerAccountsRoutes(ctx, { live, getSettingsApi, syncProviderState }) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/accounts',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      const settingsApi = settingsOr503(res, getSettingsApi)
      if (!settingsApi) return
      try {
        const bodyBuf = await readBody(req)
        let body = {}
        try { body = JSON.parse(bodyBuf.toString('utf8')) } catch { body = {} }
        const apiKey = String(body.apiKey || '').trim()
        if (!apiKey) return writeJson(res, 400, { ok: false, error: 'missing_key' })
        const curr = plainConfig(live())
        const added = upsertAccount(curr, { label: body.label, apiKeyEnv: body.apiKeyEnv })
        if (!added.ok) return writeJson(res, 400, { ok: false, error: added.error })
        // Pool name first. A rejected secret does not leave a credential outside the pool.
        const outcome = await commitAddedAccount({
          previous: curr,
          added,
          readFresh: () => plainConfig(live()),
          replace: (cfg) => settingsApi.replace(Config(cfg)),
          saveSecret: () => saveCredentialKey(ctx, added.account.apiKeyEnv, apiKey),
        })
        if (!outcome.ok) {
          return writeJson(res, outcome.status || 500, {
            ok: false,
            error: outcome.error,
            ...(outcome.partial ? { partial: true, accountAdded: true, secretSaved: false } : {}),
          })
        }
        const next = Config(outcome.config)
        await syncProviderState(next)
        clearUsageCache()
        clearProbeCache()
        writeJson(res, 200, { ok: true, account: added.account })
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /accounts')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/accounts/delete',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      const settingsApi = settingsOr503(res, getSettingsApi)
      if (!settingsApi) return
      try {
        const bodyBuf = await readBody(req)
        let body = {}
        try { body = JSON.parse(bodyBuf.toString('utf8')) } catch { body = {} }
        const curr = plainConfig(live())
        const dropped = dropAccount(curr, body.apiKeyEnv)
        if (!dropped.ok) return writeJson(res, 400, { ok: false, error: dropped.error })
        const drafted = { ...curr, accounts: dropped.accounts, activeAccount: dropped.activeAccount }
        const next = Config(applyCatalogIdentity(curr, drafted))
        noteUserWrite()
        await enqueuePlanWrite(() => settingsApi.replace(next))
        await syncProviderState(next)
        let secretDeleted = false
        let warning = ''
        if (body.deleteSecret) {
          try {
            await deleteCredentialKey(ctx, dropped.removed)
            secretDeleted = true
          } catch (err) {
            warning = String(err?.message || err)
          }
        }
        clearUsageCache()
        clearProbeCache()
        writeJson(res, 200, { ok: true, removed: dropped.removed, secretDeleted, ...(warning ? { warning } : {}) })
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /accounts/delete')

  // POST /dsh-clinebot/accounts/active — switch or pin active account
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/accounts/active',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      try {
        const bodyBuf = await readBody(req)
        let body = {}
        try { body = JSON.parse(bodyBuf.toString('utf8')) } catch { body = {} }
        const account = String(body.account || '').trim()
        const curr = plainConfig(live())
        if (account && !isKnownAccountEnv(curr, account)) {
          return writeJson(res, 400, { ok: false, error: 'missing_account' })
        }
        const settingsApi = settingsOr503(res, getSettingsApi)
        if (!settingsApi) return
        const next = Config(applyCatalogIdentity(curr, { ...curr, activeAccount: account }))
        noteUserWrite()
        await enqueuePlanWrite(() => settingsApi.replace(next))
        clearUsageCache()
        clearProbeCache()
        await syncProviderState(next)
        writeJson(res, 200, { ok: true, activeAccount: next.activeAccount })
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /accounts/active')

  // POST /dsh-clinebot/register — upsert into DSH llm-pi-ai
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/register',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      try {
        const bodyBuf = await readBody(req)
        let body = {}
        try { body = JSON.parse(bodyBuf.toString('utf8')) } catch { body = {} }
        const activeModels = body.models || publicConfig(live()).enabledModels
        const result = await upsertPiAiProvider(ctx, live(), activeModels)
        writeJson(res, 200, { ok: true, provider: result })
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /register')

  // POST /dsh-clinebot/unregister — remove from DSH
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-clinebot/unregister',
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
      if (!assertTrustedSettingsRequest(req, res)) return
      try {
        await removePiAiProvider(ctx)
        writeJson(res, 200, { ok: true })
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  }), 'dsh-clinebot: /unregister')
}
