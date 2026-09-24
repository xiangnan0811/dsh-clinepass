import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

test('built client declares settingsScope and does not touch the removed host services', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'dsh-clinepass')
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
  ])
  assert.equal(source.includes("ctx.get('lanSettings')"), false)
  assert.equal(source.includes('configForms'), false)
  assert.equal(source.includes("name: 'plugins.row.config'"), false)
  assert.equal(source.includes("name: 'plugins.item'"), false)
  let loaded
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) { loaded = entry },
      },
    },
    console,
  }
  vm.runInNewContext(source, sandbox)
  const exports = loaded.factory((id) => {
    if (id === 'react') {
      return {
        createElement: () => null,
        Fragment: 'fragment',
        useState: (value) => [value, () => {}],
        useEffect: () => {},
        useMemo: (fn) => fn(),
        useCallback: (fn) => fn,
        useRef: (value) => ({ current: value }),
        useSyncExternalStore: () => ({ status: 'ready' }),
        Component: class {},
      }
    }
    return {}
  })
  assert.equal(loaded.id, 'dsh-clinepass')
  assert.ok(exports.inject.includes('settingsScope'))
  assert.ok(exports.inject.includes('slots'))
  assert.ok(exports.inject.includes('locale'))
})
