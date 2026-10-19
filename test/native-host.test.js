import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import http from 'node:http'
import test from 'node:test'
import { buildProviderPayload } from '../lib/provider-payload.js'
import { getAllModels } from '../lib/models.js'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const native = require('@deepseek-ai/dsh-llm-pi-ai')

test('installed DSH adapter accepts the catalog, request budget, reasoning and credential reference', { timeout: 10000 }, async (t) => {
  let captured
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    captured = { url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({
      id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'cline-pass/deepseek-v4.1-flash',
      choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
    })}\n\n`
    res.end(chunk({ role: 'assistant', content: 'pong' }) + chunk({}, 'stop', { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }) + 'data: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const model = 'cline-pass/deepseek-v4.1-flash'
  const built = buildProviderPayload({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKeyEnv: 'CLINEBOT_API_KEY_NATIVE_TEST',
    displayName: 'ClinePass',
    models: getAllModels({}),
  }).payload
  let adapter
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    inject() {},
    on() {},
    get(name) {
      if (name === 'credentials') return {
        async resolve(ref) {
          assert.equal(ref, 'CLINEBOT_API_KEY_NATIVE_TEST')
          return { value: 'fake-native-test-key' }
        },
      }
    },
    logger: { warn() {} },
    llm: {
      registerConfigurableProviders() { return { replace() {} } },
      registerModelDiscovery() {},
      registerAdapter(_routes, value) { adapter = value; return { replace() {} } },
    },
  }
  native.apply(ctx, { providers: { get: () => ({ clinebot: built }) } })
  const models = await adapter.listModels('clinebot')
  assert.equal(models.length, built.models.length)
  const prepared = await adapter.prepareCall('clinebot', model)
  assert.equal(prepared.model.defaultMaxTokens, 65536)
  assert.ok(prepared.model.inputModalities.includes('image'))
  const chunks = []
  for await (const chunk of prepared.stream({
    provider: 'clinebot', model, reasoningEffort: 'high', maxTokens: prepared.model.defaultMaxTokens,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
  })) chunks.push(chunk)
  assert.equal(captured.url, '/v1/chat/completions')
  assert.equal(captured.auth, 'Bearer fake-native-test-key')
  assert.equal(captured.body.model, model)
  assert.equal(captured.body.max_tokens, 65536)
  assert.equal(captured.body.reasoning_effort, 'high')
  assert.deepEqual(captured.body.thinking, { type: 'enabled' })
  assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind !== 'error'))
})
