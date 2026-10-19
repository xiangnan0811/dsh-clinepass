const INJECT = ['configForms', 'slots', 'locale']
const ROW_KEY = `${PACKAGE_NAME}#${NS}`

function bindScope(ctx) {
  try {
    if (!ctx || typeof ctx.configForms?.get !== 'function') {
      return { scope: null, scopeError: 'This DSH build did not provide configForms. The plugin needs @deepseek-ai/dsh-client-ui-settings (tested on DSH 0.1.7-rc.2 and 0.2.1-rc.2).' }
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
  ensureCss()
  const bound = bindScope(ctx)
  const quota = createQuotaResource(bound.scope)
  ctx.effect?.(() => () => quota.dispose(), 'dsh-clinebot: quota observers')
  const card = (props) => React.createElement(
    ErrorBoundary,
    null,
    React.createElement(PluginCard, {
      ...props,
      scope: bound.scope,
      scopeError: bound.scopeError,
      refreshScope: () => refreshScope(ctx),
      onStatus: (status) => quota.acceptStatus(status),
    }),
  )
  function SettingsSurface(props) {
    const [open, setOpen] = React.useState(false)
    const detailProps = { ...props, scope: bound.scope, refreshScope: () => refreshScope(ctx), onStatus: (status) => quota.acceptStatus(status) }
    return React.createElement(React.Fragment, null, card({ ...props, view: props?.view || 'page', openDetails: () => setOpen(true) }),
      open ? React.createElement(ClineDetails, { ...detailProps, insideDetails: true, onClose: () => setOpen(false) }) : null)
  }
  function SidebarSurface(props) {
    const [open, setOpen] = React.useState(false)
    return React.createElement(React.Fragment, null, React.createElement(SidebarQuota, { ...props, scope: bound.scope, quota, openDetails: () => setOpen(true) }),
      open ? React.createElement(ClineDetails, { ...props, scope: bound.scope, refreshScope: () => refreshScope(ctx), onStatus: (status) => quota.acceptStatus(status), insideDetails: true, onClose: () => setOpen(false) }) : null)
  }

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
      const surface = (props) => React.createElement(SettingsSurface, props)
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
      listen(() => ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register(
        { name: 'settings.models.provider-card', key: NS, locale: NS },
        (props) => props?.provider?.provider === 'clinebot' ? React.createElement(ErrorBoundary, null, React.createElement(NativeModelEditor, props)) : null,
      )))
      listen(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'clinepass-quota', order: 20, locale: NS },
        (props) => React.createElement(ErrorBoundary, null, React.createElement(SidebarSurface, props)),
      )))
      listen(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
        { name: 'conversation.composer.dock', id: 'clinepass-session-usage', order: 10, locale: NS },
        (props) => React.createElement(ErrorBoundary, null, React.createElement(ComposerUsage, { ...props, scope: bound.scope })),
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
