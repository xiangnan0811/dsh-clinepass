import assert from 'node:assert/strict'
import test from 'node:test'
import { attachStreamFailover, claimFailoverSlot, passThrough, resetFailoverClock } from '../lib/stream-failover.js'
import { recentRequests, recordSessionRequest, resetSessionStats, sessionStats } from '../lib/cline-client.js'

async function* chunks(list) {
  for (const chunk of list) yield chunk
}

test('cline stream wrapper yields every chunk and notices harness rate limits', async () => {
  let seen = 0
  const output = []
  for await (const chunk of passThrough(chunks([
    { type: 'text-delta', index: 0, text: 'pong' },
    { type: 'finish', reason: { kind: 'error', failure: { status: 429, code: 'rate_limit_exceeded', message: 'slow down' } } },
    { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'rate_limit_exceeded' } } },
  ]), () => { seen += 1 })) output.push(chunk.type)
  assert.deepEqual(output, ['text-delta', 'finish', 'finish'])
  assert.equal(seen, 2)
})

test('a normal finish and a credit mention do not rotate', async () => {
  let seen = 0
  for await (const chunk of passThrough(chunks([
    { type: 'finish', reason: { kind: 'stop' } },
  ]), () => { seen += 1 })) void chunk
  for await (const chunk of passThrough(chunks([
    { type: 'finish', reason: { kind: 'error', failure: { status: 400, code: 'billing', message: 'insufficient credits' } } },
  ]), () => { seen += 1 })) void chunk
  assert.equal(seen, 0)
})

test('a finished stream keeps its chunk order and the history drops the oldest entry', async () => {
  resetSessionStats()
  const output = []
  for await (const chunk of passThrough(chunks([
    { type: 'text-delta', text: 'do not store this prompt' },
    { type: 'finish', reason: { kind: 'stop' }, provider: 'deepseek' },
  ]), () => {}, (chunk) => {
    recordSessionRequest({
      ok: chunk.reason?.kind !== 'error',
      reason: chunk.reason?.kind || '',
      model: 'cline-pass/deepseek-v4.1-flash',
      upstream: typeof chunk.provider === 'string' ? chunk.provider : '',
    })
  })) output.push(chunk.type)
  assert.deepEqual(output, ['text-delta', 'finish'])
  const noted = recentRequests(1)[0]
  assert.equal(noted.upstream, 'deepseek')
  assert.equal(noted.prompt, undefined)
  assert.equal(JSON.stringify(noted).includes('do not store'), false)
  resetSessionStats()
  for (let i = 0; i < 101; i += 1) recordSessionRequest({ ok: true, model: `m${i}` })
  const kept = recentRequests(100)
  assert.equal(kept.length, 100)
  assert.equal(kept[0].model, 'm1')
  assert.equal(kept[99].model, 'm100')
  assert.equal(Object.hasOwn(kept[0], 'prompt'), false)
  resetSessionStats()
})

test('a stream without a measured latency keeps the previous latency', () => {
  resetSessionStats()
  recordSessionRequest({ ok: true, latencyMs: 12, model: 'cline-pass/deepseek-v4.1-flash' })
  recordSessionRequest({ ok: true, model: 'cline-pass/deepseek-v4.1-flash' })
  assert.equal(sessionStats.lastLatencyMs, 12)
  resetSessionStats()
})

test('a thrown stream records one finish and does not add another after a finish chunk', async () => {
  let notes = 0
  const late = (async function* () {
    yield { type: 'finish', reason: { kind: 'stop' } }
    throw new Error('late')
  })()
  await assert.rejects(async () => {
    for await (const chunk of passThrough(late, () => {}, () => { notes += 1 })) void chunk
  })
  assert.equal(notes, 1)
  notes = 0
  const early = (async function* () {
    throw new Error('early')
  })()
  await assert.rejects(async () => {
    for await (const chunk of passThrough(early, () => {}, () => { notes += 1 })) void chunk
  })
  assert.equal(notes, 1)
})

test('failover claims are at least 30 seconds apart and other providers are not wrapped', () => {
  resetFailoverClock()
  assert.equal(claimFailoverSlot(100_000), true)
  assert.equal(claimFailoverSlot(129_000), false)
  assert.equal(claimFailoverSlot(130_000), true)
  const calls = []
  attachStreamFailover({
    on(name, fn, options) {
      calls.push({ name, options })
      assert.equal(fn({ provider: 'openai' }, () => 'raw'), 'raw')
      const wrapped = fn({ provider: 'clinebot' }, () => chunks([]))
      assert.equal(typeof wrapped[Symbol.asyncIterator], 'function')
      return () => {}
    },
  }, { live: () => ({}), getSettingsApi: () => null, syncProviderState: async () => {} })
  assert.equal(calls[0].name, 'llm/stream')
  assert.equal(calls[0].options.global, true)
  assert.equal(calls[0].options.prepend, undefined)
})
