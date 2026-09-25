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
const z = require('@deepseek-ai/schemastery').default || require('@deepseek-ai/schemastery')

function setPath(root, path, value) {
  let node = root
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    if (!node[key] || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[path[path.length - 1]] = value
}

function unsetPath(root, path) {
  let node = root
  for (let i = 0; i < path.length - 1; i += 1) {
    node = node?.[path[i]]
    if (!node) return
  }
  delete node[path[path.length - 1]]
}

class MemorySettings extends Service {
  writable = true

  constructor(ctx, config) {
    super(ctx, 'settings')
    this.docs = structuredClone(config?.document || {})
  }

  register(ns) {
    if (!this.docs[ns]) this.docs[ns] = {}
    return {
      get: () => this.docs[ns],
      watch: () => () => {},
      update: (patch) => this.update(ns, patch),
      replace: (section) => this.replace(ns, section),
    }
  }

  get(ns) {
    return this.docs[ns]
  }

  describe() {
    return Object.entries(this.docs).map(([ns, value]) => ({ ns, value, revision: 1 }))
  }

  async update(ns, patch) {
    this.docs[ns] = { ...(this.docs[ns] || {}), ...structuredClone(patch) }
  }

  async replace(ns, section) {
    this.docs[ns] = structuredClone(section)
  }

  async mutate(ns, ops) {
    const current = this.docs[ns] || {}
    for (const op of ops || []) {
      if (op.op === 'set') setPath(current, op.path, structuredClone(op.value))
      else if (op.op === 'unset') unsetPath(current, op.path)
    }
    this.docs[ns] = current
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

test('0.1.7 settings without register still publishes the selected catalog', async () => {
  const previousKey = process.env.CLINEBOT_API_KEY
  delete process.env.CLINEBOT_API_KEY
  const ctx = new Context()
  const docs = {
    'llm-pi-ai': { providers: { other: { apiKeyEnv: 'OTHER_KEY' } } },
  }
  class FormsSettings extends Service {
    constructor(inner) {
      super(inner, 'settings')
    }

    describe() {
      return Object.entries(docs).map(([ns, value]) => ({ ns, value, revision: 1 }))
    }

    async update(ns, patch) {
      docs[ns] = { ...(docs[ns] || {}), ...structuredClone(patch) }
    }

    async replace(ns, section) {
      docs[ns] = structuredClone(section)
    }

    async mutate(ns, ops) {
      const current = docs[ns] || {}
      for (const op of ops || []) {
        if (op.op === 'set') setPath(current, op.path, structuredClone(op.value))
        else if (op.op === 'unset') unsetPath(current, op.path)
      }
      docs[ns] = current
    }
  }
  await ctx.plugin(FormsSettings)
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
    modelsCachePath: '/tmp/dsh-clinebot-accept/missing-cache-forms.json',
  })
  try {
    let stored
    for (let i = 0; i < 50; i += 1) {
      stored = docs['llm-pi-ai']
      if ((stored?.providers?.clinebot?.models || []).length >= 16) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(stored.providers.clinebot.models.length, 16)
    assert.equal(stored.providers.other.apiKeyEnv, 'OTHER_KEY')
  } finally {
    await ctx.fiber?.dispose?.()
    if (previousKey === undefined) delete process.env.CLINEBOT_API_KEY
    else process.env.CLINEBOT_API_KEY = previousKey
  }
})
