function PluginCard(props) {
  const page = !!(props && props.view === 'page')
  const [open, setOpen] = React.useState(!!page)
  const t = props?.t || makeT(en, en)
  React.useEffect(() => {
    ensureCss()
  }, [])

  // Summary view: the host page draws the title, so this is only the one-liner.
  if (props && props.view === 'summary') {
    return React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, t('subtitle'))
  }

  return React.createElement(
    page ? 'div' : 'li',
    { className: page ? 'cb-page' : 'cb-section-card', style: page ? undefined : { listStyle: 'none', marginBottom: '12px' } },
    React.createElement(
      'button',
      {
        type: 'button',
        style: {
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: page ? 'none' : 'flex',
          alignItems: 'center',
          width: '100%',
          padding: 0,
          textAlign: 'left',
        },
        'aria-expanded': page ? true : open,
        onClick: () => setOpen((v) => !v),
      },
      React.createElement(
        'div',
        { style: { flex: 1 } },
        React.createElement('div', { style: { fontWeight: 600, fontSize: '15px' } }, t('title')),
        React.createElement('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, t('subtitle'))
      ),
      React.createElement('span', { className: 'cb-chevron' + (open ? ' cb-chevron-open' : '') },
        React.createElement(Chevron)
      )
    ),
    (page || open)
      ? React.createElement(
          'div',
          { style: { marginTop: page ? 0 : '12px' } },
          React.createElement(
            ErrorBoundary,
            null,
            React.createElement(SettingsPage, props)
          )
        )
      : null
  )
}
