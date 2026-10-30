import { createProxyServer } from './proxy-server.js'
import { resolveAccountPool, activeCredentialEnv } from './account-pool.js'
import { saveCredentialKey, toCredentialRef, usageCache, usageCacheKey } from './cline-client.js'
import { publicConfig } from './config.js'
import { readProvider, currentEpoch } from './provider-sync.js'
import { createSessionRouter } from './session-router.js'
import { getAllModels } from './models.js'

const CONTROLS = ['retryPolicy', 'timeoutMs', 'streamIdleTimeoutMs']
const PROXY_KEY_PREFIX = 'CLINEBOT_PROXY_KEY_'

function restoration(cfg) {
  const fields = { baseURL: cfg.baseUrl, apiKeyEnv: activeCredentialEnv(cfg) }
  const unset = []
  for (const name of CONTROLS) {
    const value = cfg.proxyDirectControls?.[name]
    if (value === null || value === undefined) unset.push(name)
    else fields[name] = value
  }
  return { fields, unset }
}

export function createProxyRuntime(ctx, { live, persist, onRequest, onEvent, beforeRequest }) {
  const settings = ctx.settings
  const credentials = ctx.credentials
  let proxy
  let credentialName = ''
  let error = ''
  let disposed = false

  async function stop() {
    const current = proxy
    proxy = undefined
    if (current) await current.stop()
    if (credentialName) {
      const owned = credentialName
      credentialName = ''
      await credentials.unset(await toCredentialRef(owned))
    }
  }

  return {
    async prepare(cfg, existing) {
      if (disposed) throw new DOMException('ClinePass proxy is disposed', 'AbortError')
      if (!cfg.proxyEnabled || cfg.enabled === false) {
        if (proxy || existing?.apiKeyEnv?.startsWith(PROXY_KEY_PREFIX) || cfg.proxyDirectControls) {
          return { transport: restoration(cfg), async finish() { await stop(); if (live().proxyDirectControls) await persist({ proxyDirectControls: null }) } }
        }
        return {}
      }
      if (cfg.proxyDirectControls == null) {
        const saved = Object.fromEntries(CONTROLS.map((name) => [name, existing?.[name] ?? null]))
        await persist({ proxyDirectControls: saved })
      }
      if (!proxy) {
        const next = createProxyServer({
          async snapshot() {
            const seen = currentEpoch()
            const config = publicConfig(live())
            const accounts = await resolveAccountPool(ctx, live())
            for (const account of accounts) {
              const cached = usageCache.get(usageCacheKey(config.baseUrl, account.value))
              const windows = cached?.expiresAt > Date.now() && cached.data?.ok ? cached.data.windows : null
              const values = Object.values(windows || {}).map((window) => window?.percentUsed).filter((value) => typeof value === 'number' && Number.isFinite(value))
              if (values.length) account.percentUsed = Math.max(...values)
            }
            return { config, accounts, isCurrent: () => currentEpoch() === seen }
          },
          onRequest,
          router: createSessionRouter({ onEvent }), beforeRequest,
        })
        try {
          await next.start()
          const nextCredential = `${PROXY_KEY_PREFIX}${next.port}`
          await saveCredentialKey(ctx, nextCredential, next.token)
          if (disposed) {
            await credentials.unset(await toCredentialRef(nextCredential))
            throw new DOMException('ClinePass proxy is disposed', 'AbortError')
          }
          credentialName = nextCredential
          proxy = next
          error = ''
        } catch (failure) {
          await next.stop()
          error = String(failure.message || failure)
          throw failure
        }
      }
      proxy.router.sync({ accounts: await resolveAccountPool(ctx, cfg), baseUrl: cfg.baseUrl, activeAccount: cfg.activeAccount, strategy: cfg.accountMode, modelRoutes: cfg.modelRoutes, modelIds: getAllModels(cfg).map(model => model.id) })
      return { transport: { fields: {
        baseURL: proxy.baseUrl, apiKeyEnv: credentialName,
        retryPolicy: { mode: 'normal', maxRetries: 0 },
        timeoutMs: cfg.proxyLimits.totalTimeoutMs + 1000,
        streamIdleTimeoutMs: cfg.proxyLimits.idleTimeoutMs + 1000,
      } } }
    },
    status() { return { enabled: live().proxyEnabled, error, sessionTransport: live().nativeAdapterEnabled === true, ...(proxy?.status() || { listening: false, activeRequests: 0, sessions: 0, cooldowns: [] }) } },
    restoreProvider(profile) {
      const restored = { ...profile, ...restoration(live()).fields }
      for (const field of restoration(live()).unset) delete restored[field]
      return restored
    },
    clearCooldown(account, model) { proxy?.router.clearCooldown(account, model) },
    async dispose() {
      disposed = true
      try {
        const cfg = live()
        const existing = await readProvider(ctx)
        if (credentialName && existing?.apiKeyEnv === credentialName) {
          const restored = restoration(cfg)
          await settings.mutate('llm-pi-ai', [
            ...Object.entries(restored.fields).map(([field, value]) => ({ op: 'set', path: ['providers', 'clinebot', field], value })),
            ...restored.unset.map((field) => ({ op: 'unset', path: ['providers', 'clinebot', field] })),
          ])
        }
      } finally { await stop() }
    },
  }
}
