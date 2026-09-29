import assert from 'node:assert/strict'
import test from 'node:test'
import { attachStreamFailover, claimFailoverSlot, passThrough, resetFailoverClock } from '../lib/stream-failover.js'

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
