import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/token-count.js', import.meta.url), 'utf8')
const sandbox = {}
vm.runInNewContext(`${source}\nglobalThis.parseTokenCount = parseTokenCount`, sandbox)

test('token overrides accept counts and k/M suffixes', () => {
  const parsed = (value) => {
    const result = sandbox.parseTokenCount(value)
    return { ok: result.ok, value: result.value }
  }
  assert.equal(parsed('').ok, true)
  assert.equal(String(parsed('').value), 'inherit')
  assert.equal(parsed('1048576').value, 1048576)
  assert.equal(parsed('128k').value, 128000)
  assert.equal(parsed('1M').value, 1_000_000)
  assert.equal(parsed('131K').value, 131000)
  assert.equal(parsed('1M tokens').ok, false)
  assert.equal(parsed('0').ok, false)
})
