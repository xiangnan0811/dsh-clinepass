import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocateAccountEnv,
  dropAccount,
  isKnownAccountEnv,
  isPluginKeyEnv,
  isRateLimitFailure,
  rememberRotation,
  resetRotationMemory,
  resolveSaveKeyEnv,
  rotateToNextAccount,
  upsertAccount,
  getLastRotation,
} from '../lib/account-pool.js'

test('extra account names stay in the ClinePass prefix', () => {
  assert.equal(isPluginKeyEnv('CLINEBOT_API_KEY'), true)
  assert.equal(isPluginKeyEnv('CLINEBOT_API_KEY_2'), true)
  assert.equal(isPluginKeyEnv('OPENAI_API_KEY'), false)
  assert.deepEqual(resolveSaveKeyEnv('OPENAI_API_KEY', 'CLINEBOT_API_KEY'), { ok: false, error: 'bad_env' })
  assert.deepEqual(resolveSaveKeyEnv('MY_CUSTOM_KEY', 'MY_CUSTOM_KEY'), { ok: true, apiKeyEnv: 'MY_CUSTOM_KEY' })
})

test('pool edits do not replace the primary credential', () => {
  const cfg = { apiKeyEnv: 'CLINEBOT_API_KEY', accounts: [] }
  assert.equal(allocateAccountEnv(cfg), 'CLINEBOT_API_KEY_2')
  assert.equal(upsertAccount(cfg, { apiKeyEnv: 'CLINEBOT_API_KEY', label: 'again' }).error, 'primary')
  const added = upsertAccount(cfg, { label: 'Work', apiKeyEnv: '' })
  assert.equal(added.account.apiKeyEnv, 'CLINEBOT_API_KEY_2')
  assert.equal(added.account.label, 'Work')
  const removed = dropAccount({ ...cfg, accounts: added.accounts, activeAccount: 'CLINEBOT_API_KEY_2' }, 'CLINEBOT_API_KEY_2')
  assert.deepEqual(removed.accounts, [])
  assert.equal(removed.activeAccount, '')
  assert.equal(dropAccount(cfg, 'CLINEBOT_API_KEY').error, 'primary')
})

test('rate-limit detection ignores a bare quota or credit mention', () => {
  assert.equal(isRateLimitFailure({ status: 429, message: 'slow down', code: 'rate_limit_exceeded' }), true)
  assert.equal(isRateLimitFailure({ status: 402, message: 'payment required', code: 'billing' }), true)
  assert.equal(isRateLimitFailure({ message: 'You have exceeded your quota', code: 'quota' }), true)
  assert.equal(isRateLimitFailure({ message: 'remaining quota 40%', code: 'ok' }), false)
  assert.equal(isRateLimitFailure({ message: 'insufficient credits', code: 'billing' }), false)
  assert.equal(isRateLimitFailure({ message: 'model not found', code: 'not_found', status: 404 }), false)
  assert.equal(isRateLimitFailure({ code: 'RATE_LIMIT', message: 'slow down' }), true)
  assert.equal(isRateLimitFailure({
    code: 'QUOTA',
    message: 'You exceeded your current quota, please check your plan and billing details.',
  }), true)
  assert.equal(isRateLimitFailure({ code: 'PI_AI_ERROR', message: '402 Payment Required' }), true)
  assert.equal(isRateLimitFailure({ code: 'PI_AI_ERROR', message: 'rate_limit_exceeded' }), true)
  assert.equal(isKnownAccountEnv({ apiKeyEnv: 'CLINEBOT_API_KEY', accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY_2' }] }, 'CLINEBOT_API_KEY_2'), true)
  assert.equal(isKnownAccountEnv({ apiKeyEnv: 'CLINEBOT_API_KEY', accounts: [] }, 'OPENAI_API_KEY'), false)
})

test('a one-account pool does not record a failover', async () => {
  resetRotationMemory()
  const result = await rotateToNextAccount({}, {
    apiKeyEnv: 'CLINEBOT_API_KEY_TEST_SLOT',
    accounts: [],
  }, 'stream_429', { replace: async () => { throw new Error('should not persist') } })
  assert.equal(result.rotated, false)
  assert.equal(getLastRotation(), null)
  rememberRotation({ at: 1, reason: 'stream_429', from: 'A', to: 'B' })
  assert.equal(getLastRotation().to, 'B')
  resetRotationMemory()
})
