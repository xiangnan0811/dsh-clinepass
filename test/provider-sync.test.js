import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import http from 'node:http'
import test from 'node:test'
import { Config } from '../lib/config.js'
import { upsertPiAiProvider, removePiAiProvider, noteUserWrite, currentEpoch, autoDiscoverPlanModels } from '../lib/provider-sync.js'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const { Context, Service } = require('@deepseek-ai/cordis')
const { SettingsProvider } = require('@deepseek-ai/dsh-settings')
const z = require('@deepseek-ai/schemastery').default || require('@deepseek-ai/schemastery')

class MemorySettings extends SettingsProvider {
  writable = true

  constructor(ctx, config) {
    super(ctx)
    this.memory = structuredClone(config?.document || {})
  }

  load() {
    return this.memory
  }

  persist(ns, section) {
    this.memory[ns] = section
  }
}

const PiConfig = z.object({
  providers: z.dict(z.any()).default({}),
})

async function boot() {
  const ctx = new Context()
  await ctx.plugin(MemorySettings, {
    document: {
      'llm-pi-ai': {
        providers: {
          other: { apiKeyEnv: 'OTHER_KEY', headers: { 'X-Other': '1' } },
          clinebot: { headers: { 'X-Keep': 'yes' }, retryPolicy: { mode: 'off' }, models: [] },
        },
      },
    },
  })
  let holder
  await ctx.plugin({
    name: 'register-pi',
    inject: ['settings'],
    apply(inner) {
      holder = inner
      inner.settings.register('llm-pi-ai', PiConfig, {
        base: { providers: {} },
      })
    },
  })
  return { ctx: holder, settings: holder.settings }
}

test('real settings service keeps other providers and an explicit empty selection removes clinebot', async () => {
  const { ctx } = await boot()
  const cfg = Config({
    selectionKind: 'explicit',
    explicitModels: ['cline-pass/deepseek-v4-flash'],
    baseUrl: 'http://127.0.0.1:9/v1',
  })
  const written = await upsertPiAiProvider(ctx, cfg, ['cline-pass/deepseek-v4-flash'])
  assert.equal(written.models.length, 1)
  assert.equal(written.models[0].maxTokens, 65536)
  assert.equal(written.apiKeyEnv, 'CLINEBOT_API_KEY')
  const pinned = Config({
    ...cfg,
    activeAccount: 'CLINEBOT_API_KEY_2',
    accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY_2', label: 'Second' }],
  })
  const switched = await upsertPiAiProvider(ctx, pinned, ['cline-pass/deepseek-v4-flash'])
  assert.equal(switched.apiKeyEnv, 'CLINEBOT_API_KEY_2')
  assert.equal(written.headers['X-Keep'], 'yes')
  const stored = ctx.settings.get('llm-pi-ai')
  assert.equal(stored.providers.other.apiKeyEnv, 'OTHER_KEY')
  assert.equal(stored.providers.clinebot.models[0].id, 'cline-pass/deepseek-v4-flash')

  const removed = await upsertPiAiProvider(ctx, cfg, [])
  assert.equal(removed.removed, true)
  const after = ctx.settings.get('llm-pi-ai')
  assert.equal(after.providers.clinebot, undefined)
  assert.equal(after.providers.other.headers['X-Other'], '1')
  await removePiAiProvider(ctx)
})

test('a newer user write makes an older discovery skip its config update', async () => {
  const previousKey = process.env.CLINEBOT_API_KEY
  process.env.CLINEBOT_API_KEY = `fake-local-key-${Date.now()}`
  const replaced = []
  const server = http.createServer((req, res) => {
    noteUserWrite()
    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url.includes('usage-limits')) {
      res.end(JSON.stringify({ data: { limits: [] } }))
      return
    }
    res.end(JSON.stringify({
      data: { plan: { displayName: 'ClinePass', features: { included: ['Includes GLM 5.2'] } } },
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    let liveCfg = Config({
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      discoveredPlanIds: [],
      apiKeyEnv: 'CLINEBOT_API_KEY',
      modelsCachePath: '/tmp/dsh-clinebot-accept/missing-cache.json',
    })
    const settingsApi = {
      update(patch) {
        replaced.push(patch)
        liveCfg = Config({ ...liveCfg, ...patch })
        return liveCfg
      },
    }
    await autoDiscoverPlanModels({ get: () => null }, {
      live: () => liveCfg,
      getSettingsApi: () => settingsApi,
      syncProviderState: async () => {},
    })
    assert.equal(replaced.length, 0)
  } finally {
    server.close()
    if (previousKey === undefined) delete process.env.CLINEBOT_API_KEY
    else process.env.CLINEBOT_API_KEY = previousKey
  }
})

test('a missing API key still publishes the selected catalog', async () => {
  const previousKey = process.env.CLINEBOT_API_KEY
  delete process.env.CLINEBOT_API_KEY
  const ctx = new Context()
  await ctx.plugin(MemorySettings, {
    document: {
      'llm-pi-ai': {
        providers: {
          other: { apiKeyEnv: 'OTHER_KEY' },
          clinebot: {
            baseURL: 'http://127.0.0.1:9/api/v1',
            models: [{ id: 'cline-pass/deepseek-v4-flash' }],
          },
        },
      },
    },
  })
  let holder
  await ctx.plugin({
    name: 'register-pi',
    inject: ['settings'],
    apply(inner) {
      holder = inner
      inner.settings.register('llm-pi-ai', PiConfig, { base: { providers: {} } })
    },
  })
  class Creds extends Service {
    constructor(inner) {
      super(inner, 'credentials')
    }

    async resolve() {
      return null
    }
  }
  await ctx.plugin(Creds)
  const plugin = await import('../lib/index.js')
  await ctx.plugin({
    name: plugin.name,
    inject: plugin.inject,
    apply: plugin.apply,
  }, {
    enabled: true,
    baseUrl: 'https://api.cline.bot/api/v1',
    selectionKind: 'all-except-disabled',
    disabledModels: [],
    explicitModels: [],
    modelOverrides: [],
    migrationRevision: 1,
    modelsCachePath: '/tmp/dsh-clinebot-accept/missing-cache-nokey.json',
  })
  try {
    let stored
    for (let i = 0; i < 50; i += 1) {
      stored = holder.settings.get('llm-pi-ai')
      if ((stored?.providers?.clinebot?.models || []).length >= 16) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(stored.providers.clinebot.models.length, 16)
    assert.equal(stored.providers.clinebot.baseURL, 'https://api.cline.bot/api/v1')
    assert.equal(stored.providers.other.apiKeyEnv, 'OTHER_KEY')
    const flash = stored.providers.clinebot.models.find((model) => model.id === 'cline-pass/deepseek-v4.1-flash')
    assert.equal(Object.hasOwn(flash.reasoningEfforts, 'off'), false)
  } finally {
    await ctx.fiber?.dispose?.()
    if (previousKey === undefined) delete process.env.CLINEBOT_API_KEY
    else process.env.CLINEBOT_API_KEY = previousKey
  }
})
