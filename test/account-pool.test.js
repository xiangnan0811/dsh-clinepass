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
  commitAddedAccount,
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

test('an added account is named in settings before the secret is stored', async () => {
  const previous = { apiKeyEnv: 'CLINEBOT_API_KEY', accounts: [], timeoutMs: 15000 }
  const added = upsertAccount(previous, { label: 'Work' })
  const order = []
  let stored = previous
  const saved = await commitAddedAccount({
    previous,
    added,
    readFresh: () => stored,
    replace: async (cfg) => {
      order.push('replace')
      stored = cfg
    },
    saveSecret: async () => {
      order.push('secret')
    },
  })
  assert.deepEqual(order, ['replace', 'secret'])
  assert.equal(saved.ok, true)
  assert.equal(stored.accounts[0].apiKeyEnv, 'CLINEBOT_API_KEY_2')
  assert.equal(stored.timeoutMs, 15000)

  stored = previous
  let secrets = 0
  await assert.rejects(() => commitAddedAccount({
    previous,
    added,
    readFresh: () => stored,
    replace: async () => { throw new Error('settings down') },
    saveSecret: async () => { secrets += 1 },
  }), /settings down/)
  assert.equal(secrets, 0)

  stored = previous
  const failed = await commitAddedAccount({
    previous,
    added,
    readFresh: () => stored,
    replace: async (cfg) => { stored = { ...cfg, timeoutMs: 20000 } },
    saveSecret: async () => { throw new Error('shadowed') },
  })
  assert.equal(failed.partial, false)
  assert.equal(failed.error, 'shadowed')
  assert.deepEqual(stored.accounts, [])
  assert.equal(stored.timeoutMs, 20000)

  const prior = { ...previous, accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY_2', label: 'Old' }] }
  const renamed = upsertAccount(prior, { label: 'New', apiKeyEnv: 'CLINEBOT_API_KEY_2' })
  stored = prior
  const relabel = await commitAddedAccount({
    previous: prior,
    added: renamed,
    readFresh: () => stored,
    replace: async (cfg) => { stored = cfg },
    saveSecret: async () => { throw new Error('shadowed') },
  })
  assert.equal(relabel.partial, false)
  assert.equal(stored.accounts[0].label, 'Old')

  stored = { ...previous, accounts: added.accounts }
  const stuck = await commitAddedAccount({
    previous,
    added,
    readFresh: () => stored,
    replace: async (cfg) => {
      if (!(cfg.accounts || []).length) throw new Error('rollback refused')
      stored = cfg
    },
    saveSecret: async () => { throw new Error('shadowed') },
  })
  assert.equal(stuck.partial, true)
  assert.equal(stuck.secretSaved, false)
  assert.equal(stuck.accountAdded, true)
  assert.equal(stored.accounts[0].apiKeyEnv, 'CLINEBOT_API_KEY_2')
})

test('rotation drops the previous account plan list', async () => {
  const ctx = {
    credentials: {
      resolve: async (ref) => ({ value: ref.name === 'CLINEBOT_API_KEY' ? 'primary-key' : 'second-key' }),
    },
  }
  let saved = null
  const result = await rotateToNextAccount(ctx, {
    baseUrl: 'https://api.cline.bot/api/v1',
    apiKeyEnv: 'CLINEBOT_API_KEY',
    activeAccount: 'CLINEBOT_API_KEY',
    accounts: [{ apiKeyEnv: 'CLINEBOT_API_KEY_2', label: 'Two' }],
    discoveredPlanIds: ['cline-pass/glm-5.2', 'cline-pass/some-brand-new-model'],
    dynamicModels: [{ id: 'cline-pass/old', name: 'Old' }],
    customModels: [
      { id: 'cline-pass/mine', name: 'Mine' },
      { id: 'cline-pass/some-brand-new-model', name: 'New' },
    ],
  }, 'stream_429', {
    replace: async (next) => { saved = next },
  })
  assert.equal(result.rotated, true)
  assert.equal(result.activeAccount, 'CLINEBOT_API_KEY_2')
  assert.equal(saved.activeAccount, 'CLINEBOT_API_KEY_2')
  assert.deepEqual(saved.discoveredPlanIds, [])
  assert.deepEqual(saved.dynamicModels, [])
  assert.deepEqual(saved.customModels, [{ id: 'cline-pass/mine', name: 'Mine' }])
  assert.deepEqual(result.config.customModels, saved.customModels)
})
