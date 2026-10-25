import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createProxyServer } from '../lib/proxy-server.js'

const frame = (delta = {}, extra = {}) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`
const terminal = frame({}, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } }) + 'data: [DONE]\n\n'
const complete = { choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } }
const pool = [
  { apiKeyEnv: 'CLINEBOT_API_KEY', present: true, value: 'fake-proxy-first' },
  { apiKeyEnv: 'CLINEBOT_API_KEY_2', present: true, value: 'fake-proxy-second' },
]

async function fixture(t, responder, { limits = {}, config = {} } = {}) {
  const calls = [], records = [], waiting = []
  const upstream = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const raw = Buffer.concat(parts).toString('utf8')
    const call = { account: req.headers.authorization.endsWith('first') ? 'first' : 'second', body: raw, headers: req.headers }
    calls.push(call)
    await responder(call, res)
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const cfg = { enabled: true, proxyEnabled: true, baseUrl: `http://127.0.0.1:${upstream.address().port}`, ...config }
  const proxy = createProxyServer({ limits, snapshot: async () => ({ config: cfg, accounts: pool.map((account) => ({ ...account })) }),
    onRequest(metrics) { records.push(metrics); for (const resolve of waiting.splice(0)) resolve() } })
  await proxy.start()
  t.after(async () => { await proxy.stop(); upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve)) })
  const send = (body = {}, options = {}) => fetch(`${proxy.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${proxy.token}`, ...options.headers },
    body: JSON.stringify({ model: 'cline-pass/test', messages: [{ role: 'user', content: 'test' }], stream: false, ...body }), ...options,
  })
  const record = async (index = 0) => { while (!records[index]) await new Promise((resolve) => waiting.push(resolve)); return records[index] }
  return { proxy, cfg, send, record, calls, records }
}

test('proxy authenticates before loading keys and refuses browser and rebinding requests', async (t) => {
  let snapshots = 0
  const proxy = createProxyServer({ snapshot: async () => { snapshots++; throw Error('must not resolve credentials') } })
  await proxy.start(); t.after(() => proxy.stop())
  let response = await fetch(`${proxy.baseUrl}/models`)
  assert.equal(response.status, 401)
  response = await fetch(`${proxy.baseUrl}/models`, { headers: { Authorization: `Bearer ${proxy.token}`, Origin: 'http://evil.test' } })
  assert.equal(response.status, 403)
  const badHost = await new Promise((resolve, reject) => {
    http.get(`${proxy.baseUrl}/models`, { headers: { Authorization: `Bearer ${proxy.token}`, Host: 'evil.test' } }, (res) => { res.resume(); resolve(res.statusCode) }).on('error', reject)
  })
  assert.equal(badHost, 403)
  assert.equal(snapshots, 0)
  assert.equal(JSON.stringify(proxy.status()).includes(proxy.token), false)
})

test('non-streaming failover preserves body and Retry-After, and records one logical request', async (t) => {
  const f = await fixture(t, (call, res) => {
    if (call.account === 'first') { res.writeHead(429, { 'Retry-After': '2' }); res.end('key must not be exposed'); return }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(complete))
  })
  const body = { stream: false, reasoning_effort: 'off', max_tokens: 1234, temperature: 0, tools: [{ type: 'function', function: { name: 'check', parameters: { type: 'object' } } }] }
  const response = await f.send(body)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), complete)
  assert.deepEqual(f.calls.map((call) => call.account), ['first', 'second'])
  assert.equal(f.calls[0].body, f.calls[1].body)
  const record = await f.record()
  assert.equal(record.ok, true)
  assert.equal(record.attempts.length, 2)
  assert.equal(record.ttftMs, null)
  assert.equal(record.usage.prompt_tokens, 8)
  assert.equal(record.account, pool[1].apiKeyEnv)
  assert.equal(f.proxy.status().cooldowns[0].reason, 'RATE_LIMIT')
})

test('proxy keeps the strict upstream restriction across account retry and overrides caller routing', async (t) => {
  const f = await fixture(t, (call, res) => {
    if (call.account === 'first') { res.writeHead(429); res.end(); return }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...complete, provider: 'DeepSeek' }))
  }, { config: { upstreamPins: [{ model: 'cline-pass/test', provider: 'deepseek' }] } })
  const response = await f.send({ provider: { only: ['baseten'] }, providerOptions: { gateway: { only: ['baseten'], unrelated: true } } })
  assert.equal(response.status, 200)
  await response.text()
  assert.equal(f.calls.length, 2)
  for (const call of f.calls) {
    const body = JSON.parse(call.body)
    assert.deepEqual(body.provider.only, ['deepseek'])
    assert.equal(body.provider.allow_fallbacks, false)
    assert.deepEqual(body.providerOptions.gateway.only, ['deepseek'])
    assert.equal(body.providerOptions.gateway.unrelated, true)
  }
  assert.equal((await f.record()).upstream, 'DeepSeek')
})

test('proxy refuses ignored or unverified pins for JSON and streams without account fallback', async (t) => {
  for (const stream of [false, true]) for (const provider of ['openai_compatible_private', null, 'deepseek']) await t.test(`${stream}/${provider}`, async (t) => {
    const routing = provider ? { provider_metadata: { gateway: { routing: { finalProvider: provider } } } } : {}
    const f = await fixture(t, (_call, res) => {
      if (stream) { res.setHeader('Content-Type', 'text/event-stream'); res.end(frame({ content: 'pong' }) + frame(routing) + terminal) }
      else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...complete, ...routing })) }
    }, { config: { upstreamPins: [{ model: 'cline-pass/test', provider: 'deepseek' }] } })
    const response = await f.send({ stream })
    const text = await response.text()
    const record = await f.record()
    assert.equal(record.ok, provider === 'deepseek')
    if (provider !== 'deepseek') assert.match(text, new RegExp(provider ? 'UPSTREAM_PIN_MISMATCH' : 'UPSTREAM_PIN_UNVERIFIED'))
    assert.equal(f.calls.length, 1)
    assert.equal(f.proxy.status().activeRequests, 0)
  })
})

test('SSE keepalive and role frames do not commit before a fragmented error; retry starts cleanly', async (t) => {
  const f = await fixture(t, (call, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    if (call.account === 'first') {
      res.write(': keepalive\r\n\r\n' + frame({ role: 'assistant' }) + 'data: {"err')
      setImmediate(() => res.end('or":{"code":"rate_limit_exceeded"}}\n\n'))
    } else {
      const bytes = Buffer.from(frame({ reasoning_content: '思考' }) + frame({ content: 'pong' }) + terminal)
      for (let index = 0; index < bytes.length; index += 7) res.write(bytes.subarray(index, index + 7))
      res.end()
    }
  })
  const response = await f.send({ stream: true })
  const text = await response.text()
  assert.equal(response.status, 200)
  assert.match(text, /思考/)
  assert.match(text, /pong/)
  assert.equal(text.includes('rate_limit_exceeded'), false)
  const record = await f.record()
  assert.equal(record.attempts.length, 2)
  assert.equal(record.ok, true)
  assert.equal(typeof record.ttftMs, 'number')
})

test('proxy routing details stay with their own attempt when a retry has no identifiers', async (t) => {
  const f = await fixture(t, (call, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    if (call.account === 'first') res.end(frame({ role: 'assistant' }, { id: 'first-response', model: 'vmc/first' }) + 'data: {"error":{"code":"rate_limit_exceeded"}}\n\n')
    else res.end(frame({ content: 'pong' }) + terminal)
  })
  const response = await f.send({ stream: true })
  await response.text()
  const record = await f.record()
  assert.equal(record.ok, true)
  assert.equal(record.attempts.length, 2)
  assert.deepEqual(record.attempts[0].routingEvidence, { responseId: 'first-response', responseModel: 'vmc/first' })
  assert.equal(record.attempts[1].routingEvidence, null)
  assert.equal(record.routingEvidence, null)
})

test('a tool call commits the stream and a later disconnect cannot replay to another account', async (t) => {
  const f = await fixture(t, (_call, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(frame({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'visible-tool', arguments: '' } }] }))
    const timer = setTimeout(() => res.destroy(), 30)
    res.on('close', () => clearTimeout(timer))
  })
  const response = await f.send({ stream: true })
  const text = await response.text()
  assert.equal(response.status, 200)
  assert.match(text, /visible-tool/)
  assert.match(text, /UPSTREAM_NETWORK|TRUNCATED_STREAM/)
  assert.equal(f.calls.length, 1)
  assert.equal((await f.record()).ok, false)
})

test('first output timeout does not reset on heartbeats and falls back once', async (t) => {
  const f = await fixture(t, (call, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    if (call.account === 'second') return res.end(frame({ content: 'second' }) + terminal)
    const timer = setInterval(() => res.write(': keepalive\n\n'), 10)
    res.on('close', () => clearInterval(timer))
  }, { limits: { firstOutputTimeoutMs: 100, totalTimeoutMs: 1000 } })
  const response = await f.send({ stream: true })
  assert.match(await response.text(), /second/)
  assert.equal(f.calls.length, 2)
  assert.equal((await f.record()).attempts[0].code, 'FIRST_OUTPUT_TIMEOUT')
})

test('non-streaming body deadlines and empty streams retry without leaking pending readers', async (t) => {
  const f = await fixture(t, (call, res) => {
    if (call.account === 'first') { res.setHeader('Content-Type', 'application/json'); res.write('{'); return }
    res.end(JSON.stringify(complete))
  }, { limits: { bodyTimeoutMs: 100, totalTimeoutMs: 1000 } })
  assert.equal((await f.send()).status, 200)
  assert.equal((await f.record()).attempts[0].code, 'BODY_TIMEOUT')
  const g = await fixture(t, (call, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.end(call.account === 'first' ? frame({ role: 'assistant' }) + 'data: [DONE]\n\n' : frame({ content: 'nonempty' }) + terminal)
  })
  assert.match(await (await g.send({ stream: true })).text(), /nonempty/)
  assert.equal((await g.record()).attempts[0].code, 'EMPTY_RESPONSE')
})

test('HTTP error classes, embedded JSON errors and all exhausted candidates stay distinguishable', async (t) => {
  for (const status of [401, 402, 429, 503]) {
    const f = await fixture(t, (_call, res) => { res.writeHead(status, { 'Retry-After': '4' }); res.end() })
    const response = await f.send()
    assert.equal(response.status, status)
    assert.equal(response.headers.get('retry-after'), '4')
    assert.equal((await response.json()).attempts, 2)
    assert.equal((await f.record()).ok, false)
    const exhausted = await f.send()
    assert.equal(exhausted.status, 503)
    assert.equal((await exhausted.json()).error.code, 'NO_AVAILABLE_ACCOUNTS')
    assert.equal(f.calls.length, 2)
  }
  const f = await fixture(t, (call, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(call.account === 'first' ? { error: { type: 'invalid_api_key', message: 'fake-proxy-first' } } : complete))
  })
  const response = await f.send()
  assert.equal(response.status, 200)
  assert.equal((await f.record()).attempts.length, 2)
})

test('non-retryable HTTP 400 and full JSON byte budgets fail before extra account calls', async (t) => {
  const f = await fixture(t, (_call, res) => { res.writeHead(400); res.end('bad request') }, { limits: { maxRequestBytes: 300 } })
  let response = await f.send()
  assert.equal(response.status, 400)
  assert.equal(f.calls.length, 1)
  response = await f.send({ tools: [{ description: 'x'.repeat(1000) }] })
  assert.equal(response.status, 413)
  assert.equal((await response.json()).error.code, 'REQUEST_TOO_LARGE')
  assert.equal(f.calls.length, 1)
})

test('session failover stays local and respects per-model routes over the manual pin', async (t) => {
  const f = await fixture(t, (_call, res) => res.end(JSON.stringify(complete)), { config: { activeAccount: pool[0].apiKeyEnv, modelRoutes: [{ model: 'cline-pass/test', account: pool[1].apiKeyEnv }] } })
  const response = await f.send({}, { headers: { Authorization: `Bearer ${f.proxy.token}`, 'Content-Type': 'application/json', 'x-clinepass-session': 'session-A' } })
  assert.equal(response.status, 200)
  assert.equal(f.calls[0].account, 'second')
  assert.equal(f.calls[0].headers['x-clinepass-session'], undefined)
  assert.equal((await f.record()).sessionId, 'session-A')
  assert.equal(f.cfg.activeAccount, pool[0].apiKeyEnv)
})

test('caller cancellation and proxy shutdown abort upstream reads without failover', async (t) => {
  let began
  const started = new Promise((resolve) => { began = resolve })
  const f = await fixture(t, (_call, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.write(': started\n\n'); began() })
  const controller = new AbortController()
  const pending = f.send({ stream: true }, { signal: controller.signal })
  await started
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal((await f.record()).ok, false)
  assert.equal(f.calls.length, 1)
  const pendingShutdown = f.send({ stream: true }).then((response) => response.text()).catch(() => 'closed')
  // The second call starts under the same live proxy, then stop releases it.
  await new Promise((resolve) => setImmediate(resolve))
  await f.proxy.stop()
  await pendingShutdown
  assert.equal(f.proxy.status().listening, false)
  assert.equal(f.proxy.status().activeRequests, 0)
})
