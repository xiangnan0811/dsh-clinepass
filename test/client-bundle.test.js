import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

test('built client injects configForms and registers the row settings page', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'dsh-clinepass')
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
  ])
  assert.equal(source.includes("ctx.get('lanSettings')"), false)
  assert.equal(source.includes('settingsScope'), false)
  assert.equal(source.includes("name: 'settings.plugin.item'"), false)
  assert.equal(source.includes("name: 'plugins.item'"), false)
  assert.equal(source.includes('configForms'), true)
  assert.match(source, /name\s*:\s*['"]plugins\.row\.config['"]/)
  assert.match(source, /name\s*:\s*['"]settings\.section['"]/)
  assert.match(source, /const ROW_KEY\s*=\s*`\$\{PACKAGE_NAME\}#\$\{NS\}`/)
  assert.match(source, /const PACKAGE_NAME\s*=\s*['"]dsh-clinepass['"]/)
  assert.match(source, /const NS\s*=\s*['"]dsh-clinebot['"]/)
  // The build aliases React.createElement as h; minified locals must never shadow it.
  assert.deepEqual(source.match(/\b(?:let|const|var|function)\s+h\b|[(,{]h(?=[,)=}:])|\bh=>/g), ['const h'])
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
  assert.deepEqual(Array.from(exports.inject), ['configForms', 'slots', 'locale', 'pluginNavigation'])
})

test('a hot-loaded bundle replaces its previous stylesheet without duplicating unchanged styles', () => {
  const source = readFileSync(new URL('../src/client/styles.js', import.meta.url), 'utf8')
  let css = '/* previous bundle stylesheet */', writes = 0, appended = 0
  const style = { dataset: {} }
  Object.defineProperty(style, 'textContent', { get: () => css, set: (value) => { css = value; writes++ } })
  const document = { getElementById: () => style, createElement: () => { throw Error('duplicate style') }, head: { appendChild() { appended++ } } }
  const context = vm.createContext({ document, NS: 'dsh-clinebot' })
  vm.runInContext(source + '\nensureCss()', context)
  assert.match(css, /\.cb-update-panel/)
  assert.equal(writes, 1); assert.equal(appended, 0)
  vm.runInContext('ensureCss()', context)
  assert.equal(writes, 1)
})

test('upstream selection clears a removed model and requires an explicit new choice', () => {
  const states = [], effects = []
  let cursor = 0
  const React = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = value }] },
    useEffect(callback) { effects.push(callback) },
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat() } },
  }
  const { UpstreamSettings, UpstreamPinEditor } = vm.runInNewContext(readFileSync(new URL('../src/client/components/upstream-settings.js', import.meta.url), 'utf8') + '\n({UpstreamSettings,UpstreamPinEditor})', { React })
  const custom = { id: 'custom', name: 'Custom' }, fallback = { id: 'other', name: 'Other' }
  const render = (models, defaultModel = 'custom') => {
    cursor = 0
    const tree = UpstreamSettings({ status: { availableModels: models }, config: { defaultModel }, t: key => key })
    const select = tree.children.find(child => child.type === 'label').children.find(child => child.type === 'select')
    const editor = tree.children.find(child => child.type === UpstreamPinEditor)
    return { select, editor }
  }
  let view = render([custom, fallback])
  assert.equal(view.select.props.value, custom.id)
  for (const effect of effects.splice(0)) effect()
  view = render([fallback])
  assert.equal(view.select.props.value, '')
  assert.equal(view.editor.props.model, '')
  // Saving is disabled in the same render, before effects clear retained state.
  const editor = UpstreamPinEditor(view.editor.props)
  assert.equal(editor.children[0].children[1].props.disabled, true)
  const actions = editor.children.find(child => child?.props?.className === 'cb-row')
  assert.equal(actions.children.find(child => child.children.includes('pin.save')).props.disabled, true)
  for (const effect of effects.splice(0)) effect()
  view = render([custom, fallback])
  assert.equal(view.select.props.value, '')
  view.select.props.onChange({ target: { value: fallback.id } })
  view = render([custom, fallback])
  assert.equal(view.editor.props.model, fallback.id)
  states.length = 0
  assert.equal(render([fallback]).select.props.value, '')
})
