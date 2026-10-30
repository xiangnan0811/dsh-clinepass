import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, realpathSync } from 'node:fs'
import http from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseConfig as Config } from '../lib/config.js'
import { catalogIdentity } from '../lib/cline-client.js'
import { clearPlanDiscovery, parsePlanIncludedModels } from '../lib/models.js'
import { invalidateModelsDiskCache, loadModelsDiskCache, saveModelsDiskCache } from '../lib/model-cache.js'
import { planWritesPending, enqueuePlanWrite } from '../lib/plan-write.js'
import { upsertPiAiProvider, removePiAiProvider, noteUserWrite, currentEpoch, autoDiscoverPlanModels, createCatalogRefresh, syncState } from '../lib/provider-sync.js'
import { registerSettingsRoutes } from '../lib/routes/settings.js'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const { Context, Service } = require('@deepseek-ai/cordis')
const z = require('@deepseek-ai/schemastery').default || require('@deepseek-ai/schemastery')

test('catalog startup retries, freshness, manual sync and unchanged success use one shared writer', async () => {
  const previousFetch = globalThis.fetch
  const dir = await mkdtemp(path.join(tmpdir(), 'catalog-refresh-'))
  let time = 10000000, cfg = Config({ selectionKind: 'explicit', explicitModels: [], modelsCachePath: path.join(dir, 'cache.json') }), ready = false, fail = false, requests = 0
  const timers = [], intervals = []
  globalThis.fetch = async url => {
    requests++
    if (fail) return new Response('{}', { status: 503 })
    return new Response(JSON.stringify(String(url).endsWith('recommended-models') ? { clinePass: [{ id: 'cline-pass/dated-1017' }], free: [{ id: 'vendor/free' }] }
      : String(url).endsWith('/ai/cline/models') ? { data: [{ id: 'vendor/dated-1017' }] }
        : String(url).endsWith('/usage-limits') ? { limits: [] } : String(url).endsWith('/plan') ? { plan: { includedModels: ['DeepSeek V4.1 Flash'] } } : {}))
  }
  const settings = { update: async patch => { cfg = Config({ ...cfg, ...patch }) } }
  const runtime = createCatalogRefresh({ credentials: { resolve: async () => ({ value: 'fixture-key' }) } }, {
    live: () => cfg, getSettingsApi: () => ready ? settings : null, syncProviderState: async () => {}, run: task => task(),
  }, { now: () => time, schedule: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer }, repeat: (fn, ms) => { const timer = { fn, ms }; intervals.push(timer); return timer }, cancel: () => {}, cancelRepeat: () => {} })
  try {
    runtime.start()
    assert.deepEqual(timers.map(timer => timer.ms), [500, 3000, 15000])
    assert.equal(intervals[0].ms, 3600000)
    assert.equal((await runtime.request('startup')).skipped, 'not-ready'); assert.equal(requests, 0)
    ready = true
    assert.equal((await runtime.request('startup')).ok, true)
    assert.equal(cfg.planSyncedAt, time)
    assert.deepEqual(cfg.explicitModels, [])
    assert.equal(cfg.discoveredPlanIds.includes('cline-pass/dated-1017'), false)
    assert.equal(cfg.customModels.some(row => row.id === 'vendor/free'), false)
    const firstCount = requests
    await runtime.request('startup'); assert.equal(requests, firstCount)
    time += 21600001
    await runtime.request('hourly'); assert.equal(requests, firstCount * 2); assert.equal(cfg.planSyncedAt, time)
    const successAt = time
    time += 21600001; fail = true
    assert.equal((await runtime.request('hourly')).ok, false)
    assert.equal(cfg.planSyncedAt, successAt)
    assert.equal(cfg.catalogMetadata[0].id, 'vendor/free')
    fail = false
    await runtime.request(); assert.equal(cfg.planSyncedAt, time)
    cfg = Config({ ...cfg, enabled: false }); const count = requests
    assert.equal((await runtime.request()).skipped, 'disabled'); assert.equal(requests, count)
    cfg = Config({ ...cfg, enabled: true }); await runtime.changed(); assert.ok(requests > count)
    await runtime.close(); assert.equal((await runtime.request()).skipped, 'stopped')
  } finally { await runtime.close(); globalThis.fetch = previousFetch; await rm(dir, { recursive: true, force: true }) }
})

test('catalog coalesces the latest credential demand, discards late data and stops all later writes', async () => {
  const previousFetch = globalThis.fetch, dir = await mkdtemp(path.join(tmpdir(), 'catalog-race-'))
  let key = 'old-key', cfg = Config({ modelsCachePath: path.join(dir, 'cache.json') }), stalled, writes = 0, registrations = 0
  const started = []
  globalThis.fetch = async (url, options) => {
    const auth = options.headers.Authorization; started.push(auth)
    if (String(url).endsWith('recommended-models') && auth === 'Bearer old-key') {
      return await new Promise((resolve, reject) => {
        stalled = () => resolve(new Response(JSON.stringify({ clinePass: [{ id: 'cline-pass/old-1017' }], free: [{ id: 'old/free' }] })))
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    }
    return new Response(JSON.stringify(String(url).endsWith('recommended-models') ? { clinePass: [], free: [{ id: 'new/free' }] }
      : String(url).endsWith('/ai/cline/models') ? { data: [] }
        : String(url).endsWith('/usage-limits') ? { limits: [] } : String(url).endsWith('/plan') ? { plan: { includedModels: ['DeepSeek V4.1 Flash'] } } : {}))
  }
  const runtime = createCatalogRefresh({ credentials: { resolve: async () => ({ value: key }) } }, {
    live: () => cfg, getSettingsApi: () => ({ update: async patch => { writes++; cfg = Config({ ...cfg, ...patch }) } }),
    syncProviderState: async () => { registrations++ }, run: task => task(),
  })
  try {
    const first = runtime.request()
    while (!stalled) await new Promise(resolve => setImmediate(resolve))
    assert.equal(runtime.request(), first)
    key = 'new-key'; noteUserWrite()
    const second = runtime.request('credential')
    assert.equal(second, first)
    assert.equal((await second).ok, true)
    stalled(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(writes, 1); assert.equal(registrations, 1)
    assert.deepEqual(cfg.catalogMetadata.map(row => row.id), ['new/free'])
    assert.equal(started.filter(value => value === 'Bearer new-key').length, 5)
    await runtime.close(); assert.equal(writes, 1)
  } finally { await runtime.close(); globalThis.fetch = previousFetch; await rm(dir, { recursive: true, force: true }) }
})

test('catalog cache write failure stays visible without damaging settings; close cancels in-flight work', async () => {
  const previousFetch = globalThis.fetch, dir = await mkdtemp(path.join(tmpdir(), 'catalog-cache-failure-'))
  let cfg = Config({ modelsCachePath: dir, selectionKind: 'explicit', explicitModels: [] }), stall = false, started, writes = 0
  globalThis.fetch = async (url, options) => {
    if (stall) {
      started = true
      return await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    }
    return new Response(JSON.stringify(String(url).endsWith('recommended-models') ? { clinePass: [], free: [] }
      : String(url).endsWith('/ai/cline/models') ? { data: [] } : String(url).endsWith('/usage-limits') ? { limits: [] }
        : String(url).endsWith('/plan') ? { plan: { includedModels: [] } } : {}))
  }
  const runtime = createCatalogRefresh({ credentials: { resolve: async () => ({ value: 'fixture-key' }) } }, {
    live: () => cfg, getSettingsApi: () => ({ update: async patch => { writes++; cfg = Config({ ...cfg, ...patch }) } }), syncProviderState: async () => {}, run: task => task(),
  })
  try {
    const result = await runtime.request()
    assert.equal(result.ok, true)
    assert.match(result.warning, /cache could not be saved/)
    assert.match(syncState().discovery.warning, /cache could not be saved/)
    assert.deepEqual(cfg.explicitModels, [])
    const before = writes
    stall = true
    const pending = runtime.request()
    for (let i = 0; i < 1000 && !started; i++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(started)
    await runtime.close(); await pending
    assert.equal(writes, before)
    assert.equal((await runtime.request()).skipped, 'stopped')
  } finally { await runtime.close(); globalThis.fetch = previousFetch; await rm(dir, { recursive: true, force: true }) }
})

test('unload while the queued discovery validates a credential cannot permit a late settings write', async () => {
  const previousFetch = globalThis.fetch, dir = await mkdtemp(path.join(tmpdir(), 'catalog-resolve-race-'))
  let cfg = Config({ modelsCachePath: path.join(dir, 'cache.json') }), count = 0, release, writes = 0
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('recommended-models') ? { clinePass: [], free: [] }
    : String(url).endsWith('/ai/cline/models') ? { data: [] } : String(url).endsWith('/usage-limits') ? { limits: [] }
      : String(url).endsWith('/plan') ? { plan: { includedModels: [] } } : {}))
  const runtime = createCatalogRefresh({ credentials: { resolve: async () => {
    count++
    if (count === 4) await new Promise(resolve => { release = resolve })
    return { value: 'fixture-key' }
  } } }, { live: () => cfg, getSettingsApi: () => ({ update: async patch => { writes++; cfg = Config({ ...cfg, ...patch }) } }), syncProviderState: async () => {}, run: task => task() })
  try {
    const pending = runtime.request()
    for (let i = 0; i < 1000 && !release; i++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(release)
    const closing = runtime.close(); release()
    await Promise.all([pending, closing])
    assert.equal(writes, 0)
  } finally { await runtime.close(); globalThis.fetch = previousFetch; await rm(dir, { recursive: true, force: true }) }
})

test('offline key replacement and deletion of the resolved fallback account clear the old plan before a failed refresh', async () => {
  const previousFetch = globalThis.fetch, dir = await mkdtemp(path.join(tmpdir(), 'catalog-fallback-identity-'))
  let cfg = Config({ modelsCachePath: path.join(dir, 'cache.json'), selectionKind: 'explicit', explicitModels: [], customModels: [{ id: 'vendor/mine', userDeclared: true }],
    accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY_2' }, { apiKeyEnv: 'CLINEBOT_API_KEY_3' }] }), fail = false
  const keys = new Map([['CLINEBOT_API_KEY_2', 'old-fallback-key'], ['CLINEBOT_API_KEY_3', 'next-fallback-key']])
  globalThis.fetch = async url => new Response(JSON.stringify(fail ? {} : String(url).endsWith('recommended-models') ? { clinePass: [], free: [] }
    : String(url).endsWith('/ai/cline/models') ? { data: [] } : String(url).endsWith('/usage-limits') ? { limits: [] }
      : String(url).endsWith('/plan') ? { plan: { includedModels: ['DeepSeek V4.1 Flash'] } } : {}), { status: fail ? 503 : 200 })
  const runtime = createCatalogRefresh({ credentials: { resolve: async ref => ({ value: keys.get(typeof ref === 'string' ? ref : ref.name) || '' }) } }, {
    live: () => cfg, getSettingsApi: () => ({ update: async patch => { cfg = Config({ ...cfg, ...patch }) } }), syncProviderState: async () => {}, run: task => task(),
  })
  try {
    assert.equal((await runtime.request()).ok, true); assert.equal(cfg.planVerified, true)
    keys.set('CLINEBOT_API_KEY_2', 'replacement-key'); fail = true
    assert.equal((await runtime.request('initial')).ok, false)
    assert.equal(cfg.planVerified, false); assert.deepEqual(cfg.discoveredPlanIds, [])
    fail = false; await runtime.request(); assert.equal(cfg.planVerified, true)
    cfg = Config({ ...cfg, accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY_3' }] }); fail = true
    assert.equal((await runtime.changed()).ok, false)
    assert.equal(cfg.planVerified, false); assert.deepEqual(cfg.discoveredPlanIds, [])
    assert.deepEqual(cfg.explicitModels, [])
    assert.ok(cfg.customModels.some(row => row.id === 'vendor/mine' && row.userDeclared))
    fail = false; await runtime.request(); assert.equal(cfg.planVerified, true)
    cfg = Config({ ...cfg, accounts: [] })
    assert.equal((await runtime.changed()).skipped, 'no-key')
    assert.equal(cfg.planVerified, false)
  } finally { await runtime.close(); globalThis.fetch = previousFetch; await rm(dir, { recursive: true, force: true }) }
})

test('replace-only discovery preserves a pin write already pending before its read', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clinebot-discovery-queue-'))
  const oldFetch = globalThis.fetch
  let cfg = Config({ modelsCachePath: path.join(dir, 'models.json') }), release
  const hold = new Promise(resolve => { release = resolve })
  const blocker = enqueuePlanWrite(() => hold)
  noteUserWrite()
  const pin = enqueuePlanWrite(() => { cfg = Config({ ...cfg, upstreamPins: [{ model: 'cline-pass/deepseek-v4.1-flash', provider: 'deepseek' }] }) })
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('/usage-limits') ? { limits: [] }
    : String(url).endsWith('/plan') ? { plan: { features: { included: ['Includes DeepSeek V4.1 Flash'] } } } : {}))
  const credentials = { resolve: async () => ({ value: 'fake-discovery-key' }) }
  const discovery = autoDiscoverPlanModels({ credentials, get: name => name === 'credentials' ? credentials : undefined }, {
    live: () => cfg, getSettingsApi: () => ({ replace: async next => { cfg = next } }), syncProviderState: async () => {},
  })
  try {
    for (let i = 0; i < 50 && planWritesPending() < 3; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(planWritesPending() >= 3)
    release()
    await Promise.all([blocker, pin, discovery])
    assert.equal(cfg.planVerified, true)
    assert.equal(cfg.upstreamPins[0].provider, 'deepseek')
  } finally {
    release()
    await Promise.allSettled([blocker, pin, discovery])
    globalThis.fetch = oldFetch
    await rm(dir, { recursive: true, force: true })
  }
})

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
      if ((stored?.providers?.clinebot?.models || []).length >= 11) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(stored.providers.clinebot.models.length, 11)
    assert.ok(stored.providers.clinebot.models.some(model => model.id === 'cline-pass/deepseek-v4.1-flash-1017'))
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
      if ((stored?.providers?.clinebot?.models || []).length >= 11) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(stored.providers.clinebot.models.length, 11)
    assert.ok(stored.providers.clinebot.models.some(model => model.id === 'cline-pass/deepseek-v4.1-flash-1017'))
    assert.equal(stored.providers.other.apiKeyEnv, 'OTHER_KEY')
  } finally {
    await ctx.fiber?.dispose?.()
    if (previousKey === undefined) delete process.env.CLINEBOT_API_KEY
    else process.env.CLINEBOT_API_KEY = previousKey
  }
})

const NEXT_PLAN = 'Includes DeepSeek V4.1 Flash and Totally Unknown Widget'

function postJson(handler, body) {
  const req = new EventEmitter()
  req.method = 'POST'
  req.headers = { host: '127.0.0.1:9', origin: 'http://127.0.0.1:9' }
  req.socket = { remoteAddress: '127.0.0.1' }
  const res = {
    status: 0,
    writeHead(code) { this.status = code },
    end(payload) { this.body = JSON.parse(String(payload)) },
  }
  const done = handler(req, res)
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return done.then(() => res)
}

test('a failed plan read can restore a matching cache, and deleting that cache keeps the cleared plan', async () => {
  const envName = 'CLINEBOT_API_KEY_DISK'
  const previousKey = process.env[envName]
  process.env[envName] = `fake-local-key-${Date.now()}`
  const dir = await mkdtemp(path.join(tmpdir(), 'clinebot-discover-'))
  const cacheFile = path.join(dir, 'models.json')
  let mode = 'fail'
  const server = http.createServer((req, res) => {
    if (mode === 'fail') {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'nope' }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    if (String(req.url).includes('usage-limits')) {
      res.end(JSON.stringify({ data: { limits: [] } }))
      return
    }
    if (String(req.url).includes('/plan')) {
      res.end(JSON.stringify({
        data: {
          plan: {
            displayName: 'ClinePass',
            features: { included: [NEXT_PLAN] },
          },
        },
      }))
      return
    }
    res.end(JSON.stringify({ data: {} }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  let liveCfg = Config({
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    apiKeyEnv: envName,
    discoveredPlanIds: [],
    customModels: [{ id: 'cline-pass/mine', name: 'Mine' }],
    modelsCachePath: cacheFile,
    timeoutMs: 1000,
  })
  const settingsApi = {
    async update(patch) {
      liveCfg = Config({ ...liveCfg, ...patch })
      return liveCfg
    },
  }
  const discover = () => autoDiscoverPlanModels({ get: () => null }, {
    live: () => liveCfg,
    getSettingsApi: () => settingsApi,
    syncProviderState: async () => {},
  })
  try {
    assert.equal(await saveModelsDiskCache(cacheFile, {
      discoveredIds: ['cline-pass/glm-5.2', 'cline-pass/old-plan-only'],
      unknownModels: [{ id: 'cline-pass/old-plan-only', name: 'Old Plan Only' }, { id: 'vendor/cache-only', name: 'Not a plan member' }],
      identity: { ...catalogIdentity(liveCfg), credentialHash: createHash('sha256').update(JSON.stringify([catalogIdentity(liveCfg), envName, process.env[envName]])).digest('hex') },
    }), true)

    await discover()
    assert.ok(liveCfg.discoveredPlanIds.includes('cline-pass/glm-5.2'))
    assert.ok(liveCfg.discoveredPlanIds.includes('cline-pass/old-plan-only'))
    assert.ok(liveCfg.customModels.some((model) => model.id === 'cline-pass/mine'))
    assert.ok(liveCfg.customModels.some((model) => model.id === 'cline-pass/old-plan-only'))
    assert.equal(liveCfg.discoveredPlanIds.includes('vendor/cache-only'), false)
    assert.equal(liveCfg.customModels.some(row => row.id === 'vendor/cache-only'), false)
    assert.equal(existsSync(cacheFile), true)

    liveCfg = Config(clearPlanDiscovery(liveCfg))
    assert.equal(await invalidateModelsDiskCache(cacheFile), true)
    await discover()
    assert.deepEqual(liveCfg.discoveredPlanIds, [])
    assert.deepEqual(liveCfg.customModels.map((model) => model.id), ['cline-pass/mine'])
    assert.equal(existsSync(cacheFile), false)

    mode = 'plan'
    await discover()
    const parsed = parsePlanIncludedModels(NEXT_PLAN)
    for (const model of parsed) assert.ok(liveCfg.discoveredPlanIds.includes(model.id))
    assert.equal(liveCfg.discoveredPlanIds.includes('cline-pass/glm-5.2'), false)
    assert.equal(liveCfg.discoveredPlanIds.includes('cline-pass/old-plan-only'), false)
    assert.ok(liveCfg.customModels.some((model) => model.id === 'cline-pass/mine'))
    assert.equal(liveCfg.customModels.some((model) => model.id === 'cline-pass/old-plan-only'), false)
    const unknown = parsed.find((model) => !model.known)
    assert.ok(liveCfg.customModels.some((model) => model.id === unknown.id))
    const saved = await loadModelsDiskCache(cacheFile)
    assert.equal(saved.stale, false)
    assert.equal(saved.discoveredIds.includes('cline-pass/old-plan-only'), false)
    assert.ok(saved.discoveredIds.includes(unknown.id))
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
    if (previousKey === undefined) delete process.env[envName]
    else process.env[envName] = previousKey
  }
})

test('replacing the active key drops the saved plan cache before the next discovery', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clinebot-save-key-'))
  const cacheFile = path.join(dir, 'models.json')
  const blocked = path.join(dir, 'not-a-file')
  await mkdir(blocked)
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    apiKeyEnv: 'CLINEBOT_API_KEY',
    modelsCachePath: cacheFile,
    timeoutMs: 1000,
  }
  let liveCfg = Config({
    ...base,
    discoveredPlanIds: [],
    customModels: [{ id: 'cline-pass/mine', name: 'Mine' }],
  })
  let replaceImpl = async (section) => { liveCfg = section }
  let cachePresentAtDiscover = null
  const routes = []
  registerSettingsRoutes({
    credentials: { async set() {} },
    effect(fn) { fn() },
    webServer: { register(route) { routes.push(route) } },
  }, {
    live: () => liveCfg,
    getSettingsApi: () => ({ replace: (section) => replaceImpl(section) }),
    syncProviderState: async () => {},
    triggerAutoDiscover: () => { cachePresentAtDiscover = existsSync(cacheFile) },
  })
  const saveKey = routes.find((route) => route.path === '/dsh-clinebot/save-key').handler
  const snapshot = () => saveModelsDiskCache(cacheFile, {
    discoveredIds: ['cline-pass/glm-5.2'],
    unknownModels: [{ id: 'cline-pass/old-plan-only', name: 'Old Plan Only' }],
    identity: catalogIdentity(liveCfg),
  })
  try {
    assert.equal(await snapshot(), true)
    const clean = await postJson(saveKey, { apiKey: 'fake-key-clean' })
    assert.equal(clean.status, 200)
    assert.equal(clean.body.warning, undefined)
    assert.equal(existsSync(cacheFile), true)
    assert.equal(cachePresentAtDiscover, true)

    liveCfg = Config({
      ...base,
      discoveredPlanIds: ['cline-pass/glm-5.2', 'cline-pass/old-plan-only'],
      customModels: [
        { id: 'cline-pass/mine', name: 'Mine' },
        { id: 'cline-pass/old-plan-only', name: 'Old Plan Only' },
      ],
    })
    assert.equal(await snapshot(), true)
    const active = await postJson(saveKey, { apiKey: 'fake-key-active' })
    assert.equal(active.status, 200)
    assert.equal(active.body.ok, true)
    assert.equal(active.body.warning, undefined)
    assert.equal(active.body.validated, true)
    assert.equal(cachePresentAtDiscover, false)
    assert.equal(existsSync(cacheFile), false)
    assert.deepEqual(liveCfg.discoveredPlanIds, [])
    assert.deepEqual(liveCfg.customModels.map((model) => model.id), ['cline-pass/mine'])

    liveCfg = Config({
      ...liveCfg,
      discoveredPlanIds: ['cline-pass/glm-5.2'],
      customModels: [
        { id: 'cline-pass/mine', name: 'Mine' },
        { id: 'cline-pass/old-plan-only', name: 'Old Plan Only' },
      ],
    })
    assert.equal(await snapshot(), true)
    const secondary = await postJson(saveKey, { apiKey: 'fake-key-two', apiKeyEnv: 'CLINEBOT_API_KEY_2' })
    assert.equal(secondary.status, 200)
    assert.equal(secondary.body.envName, 'CLINEBOT_API_KEY_2')
    assert.equal(secondary.body.warning, undefined)
    assert.equal(existsSync(cacheFile), true)
    assert.deepEqual(liveCfg.discoveredPlanIds, ['cline-pass/glm-5.2'])

    replaceImpl = async () => { throw new Error('replace failed') }
    const failedReplace = await postJson(saveKey, { apiKey: 'fake-key-retry' })
    assert.equal(failedReplace.status, 200)
    assert.equal(failedReplace.body.warning, 'plan_list')
    assert.equal(existsSync(cacheFile), true)
    assert.deepEqual(liveCfg.discoveredPlanIds, ['cline-pass/glm-5.2'])

    replaceImpl = async (section) => { liveCfg = section }
    liveCfg = Config({
      ...base,
      modelsCachePath: blocked,
      discoveredPlanIds: ['cline-pass/glm-5.2', 'cline-pass/old-plan-only'],
      customModels: [
        { id: 'cline-pass/mine', name: 'Mine' },
        { id: 'cline-pass/old-plan-only', name: 'Old Plan Only' },
      ],
    })
    const failedDrop = await postJson(saveKey, { apiKey: 'fake-key-blocked' })
    assert.equal(failedDrop.status, 200)
    assert.equal(failedDrop.body.warning, 'plan_list')
    assert.equal(existsSync(blocked), true)
    assert.deepEqual(liveCfg.discoveredPlanIds, [])
    assert.deepEqual(liveCfg.customModels.map((model) => model.id), ['cline-pass/mine'])
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a plan read already writing settings cannot restore the list after the active key is replaced', async () => {
  const envName = 'CLINEBOT_API_KEY_RACE'
  const previousKey = process.env[envName]
  process.env[envName] = `fake-race-key-${Date.now()}`
  const dir = await mkdtemp(path.join(tmpdir(), 'clinebot-race-'))
  const cacheFile = path.join(dir, 'models.json')
  const applied = []
  let releaseUpdate = null
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    const url = String(req.url)
    if (url.includes('usage-limits')) {
      res.end(JSON.stringify({ data: { limits: [] } }))
      return
    }
    if (url.includes('/plan')) {
      res.end(JSON.stringify({
        data: { plan: { displayName: 'ClinePass', features: { included: [NEXT_PLAN] } } },
      }))
      return
    }
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  let liveCfg = Config({
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    apiKeyEnv: envName,
    modelsCachePath: cacheFile,
    timeoutMs: 1000,
    discoveredPlanIds: ['cline-pass/glm-5.2', 'cline-pass/old-plan-only'],
    customModels: [
      { id: 'cline-pass/mine', name: 'Mine' },
      { id: 'cline-pass/old-plan-only', name: 'Old Plan Only' },
    ],
  })
  const routes = []
  registerSettingsRoutes({
    credentials: { async set() {} },
    effect(fn) { fn() },
    webServer: { register(route) { routes.push(route) } },
  }, {
    live: () => liveCfg,
    getSettingsApi: () => ({
      replace(section) {
        applied.push('clear')
        liveCfg = section
      },
    }),
    syncProviderState: async () => {},
    triggerAutoDiscover: () => { applied.push('rediscover') },
  })
  const saveKey = routes.find((route) => route.path === '/dsh-clinebot/save-key').handler
  const discoverSettings = {
    update(patch) {
      return new Promise((resolve) => {
        releaseUpdate = () => {
          applied.push('discover')
          liveCfg = Config({ ...liveCfg, ...patch })
          resolve()
        }
      })
    },
  }
  try {
    assert.equal(await saveModelsDiskCache(cacheFile, {
      discoveredIds: ['cline-pass/glm-5.2'],
      unknownModels: [{ id: 'cline-pass/old-plan-only', name: 'Old Plan Only' }],
      identity: catalogIdentity(liveCfg),
    }), true)
    const discoverP = autoDiscoverPlanModels({ get: () => null }, {
      live: () => liveCfg,
      getSettingsApi: () => discoverSettings,
      syncProviderState: async (cfg) => { applied.push(['sync', cfg?.discoveredPlanIds?.slice() || []]) },
    })
    for (let i = 0; i < 50 && !releaseUpdate; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(typeof releaseUpdate, 'function')
    noteUserWrite()
    const pinWrite = enqueuePlanWrite(() => { liveCfg = Config({ ...liveCfg, upstreamPins: [{ model: 'cline-pass/deepseek-v4.1-flash', provider: 'deepseek' }] }) })
    const saveP = postJson(saveKey, { apiKey: 'fake-key-race' })
    for (let i = 0; i < 50 && planWritesPending() < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(planWritesPending() >= 3)
    releaseUpdate()
    const saved = await saveP
    await discoverP
    await pinWrite
    assert.deepEqual(applied.slice(0, 2), ['discover', 'clear'])
    assert.equal(saved.status, 200)
    assert.equal(saved.body.warning, undefined)
    assert.equal(saved.body.validated, true)
    assert.deepEqual(liveCfg.discoveredPlanIds, [])
    assert.deepEqual(liveCfg.customModels.map((model) => model.id), ['cline-pass/mine'])
    assert.equal(liveCfg.upstreamPins[0].provider, 'deepseek')
    assert.equal(existsSync(cacheFile), false)
    assert.equal(applied.some((item) => Array.isArray(item) && item[0] === 'sync' && item[1].length > 0), false)
  } finally {
    if (releaseUpdate && !applied.includes('discover')) releaseUpdate()
    server.close()
    await rm(dir, { recursive: true, force: true })
    if (previousKey === undefined) delete process.env[envName]
    else process.env[envName] = previousKey
  }
})
