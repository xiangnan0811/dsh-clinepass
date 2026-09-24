import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const require = createRequire(realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()))
const { Context, Service } = require('@deepseek-ai/cordis')

class SlotsService extends Service {
  constructor(ctx) {
    super(ctx, 'slots')
  }
}

class SettingsScopeService extends Service {
  constructor(ctx) {
    super(ctx, 'settingsScope')
  }

  bind(spec) {
    return { namespace: spec.namespace, status: 'bound' }
  }
}

test('cordis refuses settingsScope when the plugin did not inject it', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotsService)
  await assert.rejects(
    () => Promise.resolve(ctx.plugin({
      name: 'missing-scope',
      inject: ['slots'],
      apply(inner) {
        return inner.settingsScope
      },
    })),
    /cannot get property "settingsScope" without inject/,
  )
})

test('cordis allows settingsScope after the plugin injects it', async () => {
  const ctx = new Context()
  await ctx.plugin(SettingsScopeService)
  let namespace = ''
  await ctx.plugin({
    name: 'with-scope',
    inject: ['settingsScope'],
    apply(inner) {
      namespace = inner.settingsScope.bind({ namespace: 'dsh-clinebot' }).namespace
    },
  })
  assert.equal(namespace, 'dsh-clinebot')
})
