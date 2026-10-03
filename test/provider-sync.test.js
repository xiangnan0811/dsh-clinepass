import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, realpathSync } from 'node:fs'
import http from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Config } from '../lib/config.js'
import { catalogIdentity } from '../lib/cline-client.js'
import { clearPlanDiscovery, parsePlanIncludedModels } from '../lib/models.js'
import { invalidateModelsDiskCache, loadModelsDiskCache, saveModelsDiskCache } from '../lib/model-cache.js'
import { planWritesPending } from '../lib/plan-write.js'
import { upsertPiAiProvider, removePiAiProvider, noteUserWrite, currentEpoch, autoDiscoverPlanModels } from '../lib/provider-sync.js'
import { registerSettingsRoutes } from '../lib/routes/settings.js'

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
      discoveredIds: ['cline-pass/glm-5.2'],
      unknownModels: [{ id: 'cline-pass/old-plan-only', name: 'Old Plan Only' }],
      identity: catalogIdentity(liveCfg),
    }), true)

    await discover()
    assert.ok(liveCfg.discoveredPlanIds.includes('cline-pass/glm-5.2'))
    assert.ok(liveCfg.discoveredPlanIds.includes('cline-pass/old-plan-only'))
    assert.ok(liveCfg.customModels.some((model) => model.id === 'cline-pass/mine'))
    assert.ok(liveCfg.customModels.some((model) => model.id === 'cline-pass/old-plan-only'))
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
    const saved = await loadModelsDiskCache(cacheFile, catalogIdentity(liveCfg))
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
    const saveP = postJson(saveKey, { apiKey: 'fake-key-race' })
    for (let i = 0; i < 50 && planWritesPending() < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(planWritesPending() >= 2)
    releaseUpdate()
    const saved = await saveP
    await discoverP
    assert.deepEqual(applied.slice(0, 2), ['discover', 'clear'])
    assert.equal(saved.status, 200)
    assert.equal(saved.body.warning, undefined)
    assert.equal(saved.body.validated, true)
    assert.deepEqual(liveCfg.discoveredPlanIds, [])
    assert.deepEqual(liveCfg.customModels.map((model) => model.id), ['cline-pass/mine'])
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
