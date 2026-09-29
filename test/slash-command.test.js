import assert from 'node:assert/strict'
import test from 'node:test'
import { registerSlashCommand } from '../lib/slash-command.js'

function registeredCommand() {
  let definition
  registerSlashCommand({
    inject(_services, apply) {
      apply({
        commands: {
          register(value) {
            definition = value
            return () => {}
          },
        },
      })
    },
  }, {
    live: () => ({}),
    getSettingsApi: () => null,
    syncProviderState: async () => ({ ok: true }),
  })
  return definition
}

test('/cline models returns a DSH command result in plain text', async () => {
  const definition = registeredCommand()
  assert.equal(typeof definition.handler, 'function')
  assert.equal(definition.execute, undefined)
  const result = await definition.handler({ rawInput: 'models' })
  assert.equal(result.kind, 'success')
  assert.equal(result.text.includes('###'), false)
  assert.equal(result.text.includes('**'), false)
  assert.ok(result.text.split('\n')[0].length <= 120)
  assert.match(result.text, /cline-pass\/deepseek-v4\.1-flash/)
  const usage = await definition.handler({ rawInput: 'switch' })
  assert.equal(usage.kind, 'success')
  assert.match(usage.text, /CLINEBOT_API_KEY_2/)
  const unknown = await definition.handler({ rawInput: 'switch OPENAI_API_KEY' })
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /not a saved account/)
  const unready = await definition.handler({ rawInput: 'switch CLINEBOT_API_KEY' })
  assert.equal(unready.kind, 'error')
  assert.match(unready.text, /not ready/)
})
