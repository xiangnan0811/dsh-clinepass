const INJECT = ['settingsScope', 'slots', 'locale']

function bindScope(ctx) {
  try {
    if (!ctx || typeof ctx.settingsScope?.bind !== 'function') {
      return { scope: null, scopeError: 'This DSH build did not provide settingsScope. The plugin needs @deepseek-ai/dsh-client-ui-settings (tested on DSH 0.1.5-rc.2).' }
    }
    return { scope: ctx.settingsScope.bind({ namespace: NS }), scopeError: '' }
  } catch (err) {
    return { scope: null, scopeError: String(err?.message || err) }
  }
}

function refreshScope(ctx) {
  try {
    const face = ctx.settingsScope?.describe?.()
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
      let off = () => {}
      try {
        off = ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: NS,
            order: 60,
            locale: NS,
          },
          card,
        )) || (() => {})
      } catch (err) {
        console.warn('[dsh-clinebot] settings.plugin.item registration failed:', err)
      }
      return () => {
        try { off() } catch { /* slot already disposed */ }
        try { bound.scope?.dispose?.() } catch { /* scope already disposed */ }
      }
    }, 'dsh-clinebot: settings card')
  }

  return { scope: bound.scope, scopeError: bound.scopeError }
}

module.exports = { apply, inject: INJECT }
