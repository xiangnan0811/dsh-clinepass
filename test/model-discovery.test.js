import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { discoverModels, mergeModelDiscovery } from '../lib/model-discovery.js'
import { parseConfig } from '../lib/config.js'
import { applyModelManagement } from '../lib/model-management.js'
import { clearPlanDiscovery, getAllModels, selectedIds, mergeDiscovered } from '../lib/models.js'
import { buildPiAiProvider } from '../lib/cline-client.js'
import { registerModelsRoutes } from '../lib/routes/models.js'
import { noteUserWrite } from '../lib/provider-sync.js'

const future = 'cline-pass/future-7'
const detail = { id: 'vendor/future-7', name: 'Future 7', context_length: 999999,
  top_provider: { context_length: 128000, max_completion_tokens: 32000 },
  architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['reasoning_effort'] }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })

test('discovery enriches only listed Pass IDs and keeps ordinary API billing IDs distinct', () => {
  const rows = mergeModelDiscovery([{ id: future, name: future }], [detail, { id: 'vendor/next-8' }])
  const pass = rows.find(row => row.id === future)
  assert.equal(pass.name, 'Future 7')
  assert.equal(pass.metadataId, detail.id)
  assert.deepEqual(pass.parameters, { contextWindow: 128000, outputCapability: 32000, inputMode: 'text+image', requestOutputBudget: 32000 })
  assert.equal(rows.some(row => row.id === 'cline-pass/next-8'), false)
  assert.equal(rows.find(row => row.id === detail.id).lane, 'api')
  assert.equal(pass.parameters.reasoningEfforts, undefined)
  const ambiguous = mergeModelDiscovery([{ id: future }], [detail, { ...detail, id: 'other/future-7' }])[0]
  assert.deepEqual(ambiguous.parameters, { requestOutputBudget: 65536 })
})

test('API discovery uses the configured host, exact IDs and bounded metadata without exposing errors or credentials', async () => {
  const calls = []
  const result = await discoverModels('https://gateway.test/v1/chat/completions', 'secret-test', { fetchImpl: async (url, options) => {
    calls.push(url)
    assert.equal(options.headers.Authorization, 'Bearer secret-test')
    assert.equal(options.redirect, 'error')
    if (url.endsWith('/recommended-models')) return json({ clinePass: [{ id: future }, { id: 'bad id' }, { id: future }] })
    return json({ data: [detail, { id: '@preset/internal' }, { id: '~vendor/latest' }, { id: 'bad\nid' }] })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.models.length, 2)
  assert.ok(calls.every(url => url.startsWith('https://gateway.test/v1/')))
  assert.equal(JSON.stringify(result).includes('secret-test'), false)
  assert.deepEqual(result.warnings, [])
})

test('plain /models fallback, partial success, empty lists and malformed failures remain distinguishable', async () => {
  const partial = await discoverModels('https://gateway.test/v1', '', { fetchImpl: async (url, options) => {
    assert.equal(options.headers.Authorization, undefined)
    return url.endsWith('/v1/models') ? json({ data: [{ id: 'vendor/new-9' }] }) : json({ error: 'secret-body' }, 404)
  } })
  assert.equal(partial.ok, true)
  assert.equal(partial.models[0].name, 'vendor/new-9')
  assert.equal(partial.warnings.length, 1)
  assert.equal(JSON.stringify(partial).includes('secret-body'), false)
  const empty = await discoverModels('', '', { fetchImpl: async () => json({ data: [], clinePass: [] }) })
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.models, [])
  const failed = await discoverModels('', '', { fetchImpl: async () => json({ error: 'secret-body' }) })
  assert.equal(failed.ok, false)
  assert.equal(failed.models, undefined)
  assert.equal(failed.error.includes('secret-body'), false)
  const badEntries = await discoverModels('', '', { fetchImpl: async () => json({ data: [{ id: 'bad id' }], clinePass: [null] }) })
  assert.equal(badEntries.ok, false)
})

test('discovery deadline covers response bodies', async () => {
  // The test owns a live handle while the production timeout is unref'ed.
  const keepAlive = setInterval(() => {}, 1000)
  try {
    const result = await discoverModels('', '', { timeoutMs: 20, fetchImpl: async (_url, { signal }) => ({
      ok: true, json: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    }) })
    assert.equal(result.ok, false)
    assert.match(result.error, /timed out/)
  } finally { clearInterval(keepAlive) }
})

test('current default selection replaces old generations while explicit choices, pins and budgets survive', () => {
  const cfg = parseConfig({}), rows = getAllModels(cfg), defaults = selectedIds(rows, cfg)
  assert.equal(defaults.length, 11)
  for (const id of ['glm-5.3', 'glm-5.3-flash', 'kimi-k3.1-pro', 'minimax-m3.1-flash', 'mimo-v2.6-pro', 'mimo-v2.6-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash-1017', 'qwen3.8-max']) assert.ok(defaults.includes(`cline-pass/${id}`), id)
  const old = 'cline-pass/kimi-k3'
  assert.equal(defaults.includes(old), false)
  assert.ok(rows.some(row => row.id === old))
  assert.deepEqual(buildPiAiProvider().models.map(row => row.id), defaults)
  const chosen = parseConfig({ ...cfg, selectionKind: 'explicit', explicitModels: [old], defaultModel: old,
    upstreamPins: [{ model: old, provider: 'moonshot' }], modelOverrides: [{ id: old, requestOutputBudget: 4096 }] })
  assert.deepEqual(selectedIds(getAllModels(chosen), chosen), [old])
  assert.equal(getAllModels(chosen).find(row => row.id === old).requestOutputBudget, 4096)
  assert.deepEqual(chosen.upstreamPins, [{ model: old, provider: 'moonshot' }])
  const enabled = applyModelManagement(cfg, { enableModel: old })
  assert.ok(selectedIds(getAllModels(enabled), enabled).includes(old))
  const all = applyModelManagement(cfg, { selectionAction: 'all' })
  assert.equal(selectedIds(rows, all).length, rows.length)
  assert.deepEqual(selectedIds(rows, applyModelManagement(all, { selectionAction: 'current' })), defaults)
})

test('import works from explicit none, survives restart and account clearing, and preserves plan filtering', () => {
  const pass = mergeModelDiscovery([{ id: future }], [detail])[0]
  const cfg = parseConfig({ selectionKind: 'explicit', explicitModels: [], upstreamPins: [{ model: 'cline-pass/deepseek-v4.1-flash', provider: 'deepseek' }] })
  const saved = applyModelManagement(cfg, { customModel: { id: pass.id, name: pass.name, parameters: pass.parameters }, enableModel: pass.id })
  const restarted = parseConfig(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(selectedIds(getAllModels(restarted), restarted), [future])
  const row = getAllModels(restarted).find(row => row.id === future)
  assert.equal(row.contextWindow, 128000)
  assert.equal(row.maxTokens, 32000)
  assert.deepEqual(row.input, ['text', 'image'])
  const withPlan = mergeDiscovered(restarted, [{ id: future, name: 'Plan name' }])
  assert.ok(clearPlanDiscovery(withPlan).customModels.some(row => row.id === future))
  assert.deepEqual(withPlan.upstreamPins, cfg.upstreamPins)
  const filtered = { ...restarted, planFilterEnabled: true, planVerified: true, discoveredPlanIds: [] }
  assert.deepEqual(selectedIds(getAllModels(filtered), filtered), [])
  const manual = applyModelManagement(cfg, { customModel: { id: 'vendor/manual' }, enableModel: 'vendor/manual' })
  const manualRow = getAllModels(manual).find(row => row.id === 'vendor/manual')
  assert.equal(manualRow.name, 'vendor/manual')
  assert.equal(manualRow.contextKnown, false)
})

test('authenticated discovery is read-only and rejects results from an obsolete configuration', async (t) => {
  let release
  const upstream = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-key')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url.endsWith('recommended-models') ? { clinePass: [{ id: future }] } : { data: [detail] }))
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => { upstream.closeAllConnections(); upstream.close() })
  const cfg = parseConfig({ baseUrl: `http://127.0.0.1:${upstream.address().port}`, selectionKind: 'explicit', explicitModels: [] })
  const snapshot = JSON.stringify(cfg), routes = new Map()
  registerModelsRoutes({ credentials: { resolve: async () => ({ value: 'fixture-key' }) }, effect: fn => fn(),
    webServer: { register: route => { routes.set(route.path, route); return () => {} } } }, {
    live: () => cfg, getSettingsApi: () => { assert.fail('discovery must not write') }, syncProviderState: () => { assert.fail('discovery must not register') },
  })
  const invoke = async () => {
    const res = { writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
    await routes.get('/dsh-clinebot/models/discover').handler({ method: 'GET', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } }, res)
    return res
  }
  assert.equal((await invoke()).status, 200)
  assert.equal(JSON.stringify(cfg), snapshot)
  // Hold only one branch so both reads can finish after the epoch changes.
  upstream.removeAllListeners('request')
  upstream.on('request', async (req, res) => {
    if (req.url.endsWith('recommended-models')) await new Promise(resolve => { release = resolve })
    res.end(JSON.stringify(req.url.endsWith('recommended-models') ? { clinePass: [] } : { data: [] }))
  })
  const pending = invoke()
  while (!release) await new Promise(resolve => setTimeout(resolve, 5))
  noteUserWrite(); release()
  assert.equal((await pending).status, 409)
  assert.equal(JSON.stringify(cfg), snapshot)
})

test('custom-model UI selects API metadata, saves without manual parameters and clears a changed model ID', async () => {
  const state = [], refs = [], effects = [], calls = []
  let cursor = 0, refCursor = 0
  let pendingResponse
  const React = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value }] },
    useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial } },
    useEffect(fn) { if (!effects.length) effects.push(fn) },
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat().filter(Boolean) } },
  }
  const rows = mergeModelDiscovery([{ id: future }], [detail])
  const source = readFileSync(new URL('../src/client/token-count.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/client/components/model-tools.js', import.meta.url), 'utf8')
  const ModelTools = vm.runInNewContext(source + '\nModelTools', { React, ROUTE_PREFIX: '/dsh-clinebot', useClientRequests: () => async () => pendingResponse || json({ ok: true, models: rows }) })
  const render = () => { cursor = 0; refCursor = 0; return ModelTools({ config: { customModels: [] }, modelsList: [], saveModelPatch: async patch => { calls.push(JSON.parse(JSON.stringify(patch))); return { ok: true } }, t: key => key }) }
  const walk = tree => [tree, ...tree.children.flatMap(child => typeof child === 'object' ? walk(child) : [])]
  let tree = render()
  await walk(tree).find(row => row.type === 'button' && row.children.includes('models.discover')).props.onClick()
  tree = render()
  const chooser = walk(tree).find(row => row.type === 'select' && row.children.some(child => child.props?.value === future))
  chooser.props.onChange({ target: { value: future } })
  tree = render()
  await walk(tree).find(row => row.type === 'button' && row.children.includes('models.custom_save')).props.onClick()
  assert.equal(calls[0].customModel.name, 'Future 7')
  assert.equal(calls[0].customModel.parameters.contextWindow, 128000)
  assert.equal(calls[0].enableModel, future)
  walk(tree).find(row => row.type === 'input' && row.props.value === future).props.onChange({ target: { value: 'vendor/manual' } })
  tree = render()
  await walk(tree).find(row => row.type === 'button' && row.children.includes('models.custom_save')).props.onClick()
  assert.equal(calls[1].customModel.parameters.contextWindow, 'inherit')
  assert.equal(calls[1].customModel.parameters.inputMode, 'inherit')
  let release
  pendingResponse = new Promise(resolve => { release = resolve })
  const pending = walk(tree).find(row => row.type === 'button' && row.children.includes('models.discover')).props.onClick()
  effects[0]() // Configuration identity changed while the API request was pending.
  release(json({ ok: true, models: rows }))
  await pending
  tree = render()
  assert.equal(walk(tree).some(row => row.props.className === 'cb-discovery'), false)
  assert.equal(walk(tree).some(row => row.type === 'input' && row.props.value === future), false)
})
