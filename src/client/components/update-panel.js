function UpdatePanel(props) {
  const t = props.t || makeT(en, en)
  const request = useClientRequests()
  const [data, setData] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [archive, setArchive] = React.useState('')
  const active = React.useRef(null), generation = React.useRef(0)
  React.useEffect(() => () => active.current?.abort(), [])
  const load = React.useCallback(async (target, fresh = false) => {
    active.current?.abort()
    const controller = new AbortController(), turn = ++generation.current
    active.current = controller; setBusy(true); setError('')
    const query = new URLSearchParams({ ...(target ? { target } : {}), ...(fresh ? { fresh: '1' } : {}) })
    try {
      const response = await request(`${ROUTE_PREFIX}/update?${query}`, { signal: controller.signal })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
      if (turn === generation.current) setData(result)
    } catch (failure) { if (turn === generation.current) setError(controller.signal.aborted ? 'cancelled' : String(failure.message || failure)) }
    finally { if (turn === generation.current) { setBusy(false); active.current = null } }
  }, [request])
  React.useEffect(() => { void load() }, [load])
  const install = () => {
    try { props.install(data.target) } catch (failure) { setError(String(failure.message || failure)) }
  }
  return React.createElement('div', { className: 'cb-section-card cb-update-panel' },
    React.createElement('div', { className: 'cb-section-title' }, t('updates.title')),
    busy ? React.createElement('p', { role: 'status' }, t('update.checking')) : null,
    React.createElement('p', { className: 'cb-section-desc' }, t('updates.host_owner')),
    data ? React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'cb-usage-row' }, t('updates.running'), React.createElement('b', null, data.currentVersion || t('surface.unknown'))),
      React.createElement('div', { className: 'cb-usage-row' }, t('updates.installed'), React.createElement('b', null, data.installedVersion || t('surface.unknown'))),
      React.createElement('p', null, t(`updates.source_${data.source.kind}`), ' · ', React.createElement('code', null, data.source.label)),
      React.createElement('p', { role: 'status' }, t(`updates.state_${data.state}`)),
      data.runtimeMismatch && data.state !== 'runtime-unverified' ? React.createElement('p', { className: 'cb-alert-bad' }, t('updates.state_runtime-unverified')) : null,
      data.target ? React.createElement('div', { className: 'cb-update-target' }, React.createElement('b', null, t('updates.target', { version: data.target.version })), React.createElement('code', null, data.target.spec), data.target.url ? React.createElement('a', { href: data.target.url, target: '_blank', rel: 'noreferrer' }, t('updates.changes')) : null) : null,
      data.sourceChange && data.target ? React.createElement('p', { className: 'cb-section-desc' }, t('updates.source_change')) : null) : null,
    error ? React.createElement('div', { className: 'cb-alert-bad', role: 'status' }, error === 'cancelled' ? t('updates.cancelled') : t('updates.check_error', { error })) : null,
    React.createElement('div', { className: 'cb-row' },
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy || !data?.canAutoUpdate, onClick: () => load('github', true) }, t('updates.check_github')),
      busy ? React.createElement('button', { type: 'button', className: 'cb-btn', onClick: () => active.current?.abort() }, t('updates.cancel_check')) : null,
      props.install && data?.target ? React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-primary', disabled: busy || !!error || data.state === 'current', onClick: install }, t('updates.install')) : null,
      props.openPluginUpdates ? React.createElement('button', { type: 'button', className: 'cb-btn', onClick: props.openPluginUpdates }, t('updates.open_plugins')) : null),
    props.install && data?.canAutoUpdate ? React.createElement('details', null, React.createElement('summary', null, t('updates.local_archive')),
      React.createElement('p', { className: 'cb-section-desc' }, t('updates.local_hint')),
      React.createElement('label', { className: 'cb-field' }, t('updates.archive'), React.createElement('input', { className: 'cb-input', value: archive, disabled: busy, onChange: (event) => setArchive(event.target.value) })),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy || !archive.trim(), onClick: () => load(archive.trim(), true) }, t('updates.check_archive'))) : null)
}
