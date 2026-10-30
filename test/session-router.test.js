import assert from 'node:assert/strict'
import test from 'node:test'

test('model cooldown recovery, expiry and credential invalidation remain isolated', () => {
  let time = 1000000
  const events = [], router = createSessionRouter({ now: () => time, onEvent: event => events.push(event) })
  const accounts = [{ apiKeyEnv: 'A', present: true, value: 'fake-a' }]
  const plan = model => router.plan({ accounts, baseUrl: 'https://gateway.test', model })
  const old = plan('m1')
  old.fail(accounts[0], { code: 'INSUFFICIENT_CREDITS' })
  plan('m2').fail(accounts[0], { code: 'INSUFFICIENT_CREDITS' })
  assert.equal(plan('m3').accounts.length, 1)
  assert.equal(plan('m1').accounts.length, 0)
  router.clearCooldown('A', 'm1')
  assert.deepEqual(router.status().cooldowns.map(row => row.model), ['m2'])
  plan('m3').commit(accounts[0])
  assert.equal(router.status().cooldowns.length, 1)
  time += 300000
  assert.equal(plan('m2').accounts.length, 1)
  assert.ok(events.some(event => event.reason === 'expired' && event.model === 'm2'))
  plan('m1').fail(accounts[0], { code: 'INSUFFICIENT_CREDITS' })
  accounts[0].value = 'replacement'
  plan('m1')
  old.fail(accounts[0], { code: 'INSUFFICIENT_CREDITS' })
  assert.deepEqual(router.status().cooldowns, [])
  plan('m1').fail(accounts[0], { code: 'RATE_LIMIT' })
  assert.equal(plan('m2').accounts.length, 0)
  router.clearCooldown('A')
  assert.equal(plan('m2').accounts.length, 1)
  plan('m1').fail(accounts[0], { code: 'INSUFFICIENT_CREDITS' })
  accounts.length = 0; plan('m1')
  assert.deepEqual(router.status().cooldowns, [])
})
import { createSessionRouter } from '../lib/session-router.js'

const accounts = [
  { apiKeyEnv: 'CLINEBOT_API_KEY', present: true, value: 'fake-first', percentUsed: 60 },
  { apiKeyEnv: 'CLINEBOT_API_KEY_2', present: true, value: 'fake-second', percentUsed: 10 },
  { apiKeyEnv: 'CLINEBOT_API_KEY_3', present: true, value: 'fake-unknown' },
]
const route = { accounts, baseUrl: 'https://example.test', sessionId: 'one', model: 'model' }

test('model route, manual pin, sticky session and measured strategy have stable precedence', () => {
  const router = createSessionRouter()
  let plan = router.plan(route)
  assert.equal(plan.accounts[0].apiKeyEnv, accounts[1].apiKeyEnv)
  const lowerUsage = accounts.map((account, i) => ({ ...account, percentUsed: i ? 90 : 0 }))
  plan = router.plan({ ...route, accounts: lowerUsage })
  assert.equal(plan.reason, 'session')
  assert.equal(plan.accounts[0].apiKeyEnv, accounts[1].apiKeyEnv)
  plan = router.plan({ ...route, activeAccount: accounts[0].apiKeyEnv, modelRoutes: [{ model: 'model', account: accounts[2].apiKeyEnv }] })
  assert.equal(plan.reason, 'model-route')
  assert.equal(plan.accounts[0].apiKeyEnv, accounts[2].apiKeyEnv)
  assert.equal(plan.accounts.length, 3)
  assert.equal(new Set(plan.accounts.map((account) => account.apiKeyEnv)).size, 3)
})

test('cooldowns do not bypass exhaustion; expiry and key replacement release bindings', () => {
  let now = 100
  const router = createSessionRouter({ now: () => now })
  const plan = router.plan(route)
  for (const account of plan.accounts) plan.fail(account, { code: 'RATE_LIMIT', retryAfterMs: 100 })
  assert.equal(router.plan(route).accounts.length, 0)
  now = 200
  assert.equal(router.plan(route).accounts.length, 3)
  const changed = accounts.map((account) => ({ ...account, value: `${account.value}-new` }))
  const next = router.plan({ ...route, accounts: changed, sessionId: '' })
  plan.fail(plan.accounts[0], { code: 'OLD_FAILURE', retryAfterMs: 100000 })
  plan.commit(plan.accounts[0])
  assert.equal(router.status().cooldowns.length, 0)
  assert.equal(router.status().sessions, 0)
  assert.equal(next.accounts[0].value, 'fake-second-new')
})

test('round robin advances once per plan, bounded sessions expire in idle order', () => {
  let now = 100
  const router = createSessionRouter({ now: () => now, maxSessions: 2, ttlMs: 50 })
  const first = router.plan({ ...route, strategy: 'round-robin' })
  const second = router.plan({ ...route, strategy: 'round-robin', sessionId: 'two' })
  assert.equal(first.accounts[0].apiKeyEnv, accounts[0].apiKeyEnv)
  assert.equal(second.accounts[0].apiKeyEnv, accounts[1].apiKeyEnv)
  router.plan({ ...route, strategy: 'round-robin', sessionId: 'three' })
  assert.equal(router.status().sessions, 2)
  now += 50
  assert.equal(router.status().sessions, 0)
  const unknownOnly = accounts.map(({ percentUsed: _used, ...account }) => account)
  assert.equal(router.plan({ ...route, accounts: unknownOnly }).accounts[0].apiKeyEnv, accounts[0].apiKeyEnv)
  assert.equal(JSON.stringify(router.status()).includes('fake-'), false)
})
