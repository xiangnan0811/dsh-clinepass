function KeyDiscoverySection({ apiKeyInput, onImported, t }) {
  const request = useClientRequests()
  const [discovery, setDiscovery] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState(null)
  const [label, setLabel] = React.useState('')
  const [envName, setEnvName] = React.useState('')
  async function run(action, id) {
    setBusy(true)
    setNotice(null)
    try {
      const endpoint = action === 'import' ? '/accounts' : `/keys/${action}`
      const res = await request(`${ROUTE_PREFIX}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discoveryId: id, apiKey: id ? undefined : apiKeyInput, label, apiKeyEnv: envName }) })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (action === 'discover') {
        setDiscovery(data)
        setNotice({ ok: true, message: t('keys.found', { count: data.keys.length }) })
      } else if (action === 'import') {
        setDiscovery((current) => ({ ...current, keys: current.keys.filter((key) => key.id !== id) }))
        setNotice({ ok: true, message: t('keys.imported', { name: data.account.apiKeyEnv }) })
        await onImported()
      } else setNotice({ ok: data.validated, message: data.validated ? t('keys.valid', { plan: typeof data.plan === 'string' ? data.plan : data.plan?.name || '—' }) : data.error })
    } catch (error) {
      setNotice({ ok: false, message: String(error.message || error) })
    } finally { setBusy(false) }
  }
  return React.createElement('details', null,
    React.createElement('summary', null, t('keys.title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('keys.hint')),
    React.createElement('div', { className: 'cb-row' },
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy || !apiKeyInput.trim(), onClick: () => run('validate') }, t('keys.validate_input')),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy, onClick: () => run('discover') }, busy ? '…' : t('keys.discover'))),
    discovery ? React.createElement(React.Fragment, null,
      React.createElement('label', { className: 'cb-field' }, t('keys.label'), React.createElement('input', { className: 'cb-input', value: label, onChange: (event) => setLabel(event.target.value) })),
      React.createElement('label', { className: 'cb-field' }, t('keys.destination'), React.createElement('input', { className: 'cb-input', value: envName, placeholder: 'CLINEBOT_API_KEY_2', onChange: (event) => setEnvName(event.target.value) })),
      discovery.keys.map((key) => React.createElement('div', { className: 'cb-bar-container', key: key.id },
        React.createElement('code', null, key.maskedKey),
        React.createElement('div', { className: 'cb-model-id' }, key.sources.join(' · ')),
        React.createElement('div', { className: 'cb-row' },
          React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy, onClick: () => run('validate', key.id) }, t('keys.validate')),
          React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy, onClick: () => run('import', key.id) }, t('keys.import'))))),
      React.createElement('details', null, React.createElement('summary', null, t('keys.sources')),
        discovery.sources.filter((source) => source.status !== 'missing').map((source) => React.createElement('div', { className: 'cb-model-id', key: source.path }, `${source.path} · ${t(`keys.source_${source.status}`)}`)))) : null,
    notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad' }, notice.message) : null)
}
