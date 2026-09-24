import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { getAllModels } from '../lib/models.js'
import { buildProviderPayload } from '../lib/provider-payload.js'

const dshLib = dirname(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const piEntry = join(dshLib, '../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')
const { streamSimple } = await import(pathToFileURL(piEntry).href)

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function piModel(id) {
  const source = getAllModels({}).find((model) => model.id === id)
  const built = buildProviderPayload({
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKeyEnv: 'CLINEBOT_API_KEY',
    models: [source],
    displayName: 'ClineBot (ClinePass)',
  }).payload.models[0]
  const thinkingLevelMap = {}
  for (const level of LEVELS) {
    if (!Object.hasOwn(built.reasoningEfforts, level)) thinkingLevelMap[level] = null
    else if (built.reasoningEfforts[level] != null) thinkingLevelMap[level] = built.reasoningEfforts[level]
  }
  return {
    id: built.id,
    name: built.name,
    api: 'openai-completions',
    provider: 'clinebot',
    baseUrl: 'http://127.0.0.1:9/v1',
    reasoning: built.reasoningEfforts !== false,
    thinkingLevelMap,
    compat: built.compat,
    contextWindow: built.contextWindow || 1_000_000,
    maxTokens: built.maxTokens,
    input: built.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

async function capture(model, options, messages) {
  let params
  const stream = streamSimple(model, { messages }, {
    apiKey: 'fake-key',
    maxTokens: model.maxTokens,
    fetch: async () => {
      throw new Error('fetch should not run before onPayload capture')
    },
    onPayload(next) {
      params = structuredClone(next)
      throw new Error('captured')
    },
    ...options,
  })
  for await (const event of stream) {
    if (event.type === 'error') break
  }
  assert.ok(params, 'payload was not captured')
  return params
}

test('deepseek flash serializes thinking, effort, budget, and image parts', async () => {
  const model = piModel('cline-pass/deepseek-v4-flash')
  const high = await capture(model, { reasoning: 'high' }, [
    { role: 'user', content: 'hello' },
  ])
  assert.equal(high.model, 'cline-pass/deepseek-v4-flash')
  assert.equal(high.max_tokens, 65536)
  assert.equal(high.max_completion_tokens, undefined)
  assert.equal(high.reasoning_effort, 'high')
  assert.deepEqual(high.thinking, { type: 'enabled' })

  const untouched = await capture(model, {}, [
    { role: 'user', content: 'hello' },
  ])
  assert.equal(untouched.reasoning_effort, undefined)
  assert.equal(untouched.thinking, undefined)

  const image = await capture(model, { reasoning: 'low' }, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this' },
        { type: 'image', data: 'aaaa', mimeType: 'image/png' },
      ],
    },
  ])
  const user = image.messages.find((message) => message.role === 'user')
  assert.equal(user.content[1].type, 'image_url')
  assert.equal(user.content[1].image_url.url, 'data:image/png;base64,aaaa')
  assert.equal(image.reasoning_effort, 'low')
})

test('a non-reasoning catalog model does not send reasoning fields', async () => {
  const model = piModel('cline-pass/qwen3.7-plus')
  assert.equal(model.reasoning, false)
  const params = await capture(model, {}, [{ role: 'user', content: 'hello' }])
  assert.equal(params.reasoning_effort, undefined)
  assert.equal(params.thinking, undefined)
  assert.equal(params.max_tokens === 65536 || params.max_completion_tokens === 65536, true)
})
