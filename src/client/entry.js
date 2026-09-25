const INJECT = ['configForms', 'slots', 'locale']
const ROW_KEY = `${PACKAGE_NAME}#${NS}`

function bindScope(ctx) {
  try {
    if (!ctx || typeof ctx.configForms?.get !== 'function') {
      return { scope: null, scopeError: 'This DSH build did not provide configForms. The plugin needs @deepseek-ai/dsh-client-ui-settings (tested on DSH 0.1.7-rc.2).' }
    }
    return { scope: ctx.configForms.get(NS), scopeError: '' }
  } catch (err) {
    return { scope: null, scopeError: String(err?.message || err) }
  }
}

function refreshScope(ctx) {
  try {
    const face = ctx.configForms?.describe?.()
    if (typeof face?.ensure === 'function') return face.ensure()
  } catch (err) {
    return Promise.reject(err)
  }
  return Promise.resolve()
}

function apply(ctx) {
  const bound = bindScope(ctx)
  const card = (props) => React.createElement(
    ErrorBoundary,
    null,
    React.createElement(PluginCard, {
      ...props,
      scope: bound.scope,
      scopeError: bound.scopeError,
      refreshScope: () => refreshScope(ctx),
    }),
  )

  const addLocale = (locale, dictionary) => {
    try {
      return ctx.locale.register(NS, locale, dictionary)
    } catch (_) {
      return () => {}
    }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const undo = []
      if (ctx.locale && ctx.locale.register) {
        undo.push(addLocale('en', en), addLocale('zh', zh))
      }
      return () => {
        for (const off of undo) {
          try { off?.() } catch { /* already gone */ }
        }
      }
    }, 'dsh-clinebot: dictionaries')

    ctx.effect(() => {
      if (!ctx.slots || typeof ctx.slots.inject !== 'function') return undefined
      const surface = (props) => card({ ...props, view: props?.view || 'page' })
      const label = () => {
        try {
          const translate = ctx.locale?.bind?.(NS)
          if (typeof translate === 'function') return translate('title')
        } catch (_) {}
        return 'ClineBot'
      }
      const offs = []
      const listen = (register) => {
        try {
          const off = register()
          if (typeof off === 'function') offs.push(off)
        } catch (err) {
          console.warn('[dsh-clinebot] settings registration failed:', err)
        }
      }
      listen(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
        {
          name: 'settings.section',
          id: NS,
          order: 80,
          label,
          locale: NS,
        },
        surface,
      )))
      listen(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
        {
          name: 'plugins.row.config',
          key: ROW_KEY,
          locale: NS,
        },
        surface,
      )))
      return () => {
        for (const off of offs) {
          try { off() } catch { /* slot already disposed */ }
        }
      }
    }, 'dsh-clinebot: settings card')
  }

  return { scope: bound.scope, scopeError: bound.scopeError }
}

module.exports = { apply, inject: INJECT }
