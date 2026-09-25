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

class ConfigFormsService extends Service {
  constructor(ctx) {
    super(ctx, 'configForms')
  }

  get(namespace) {
    return { namespace, status: 'bound' }
  }
}

test('cordis refuses configForms when the plugin did not inject it', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotsService)
  await assert.rejects(
    () => Promise.resolve(ctx.plugin({
      name: 'missing-forms',
      inject: ['slots'],
      apply(inner) {
        return inner.configForms
      },
    })),
    /cannot get property "configForms" without inject/,
  )
})

test('cordis allows configForms after the plugin injects it', async () => {
  const ctx = new Context()
  await ctx.plugin(ConfigFormsService)
  let namespace = ''
  await ctx.plugin({
    name: 'with-forms',
    inject: ['configForms'],
    apply(inner) {
      namespace = inner.configForms.get('dsh-clinebot').namespace
    },
  })
  assert.equal(namespace, 'dsh-clinebot')
})
