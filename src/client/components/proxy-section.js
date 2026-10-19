function ProxySection({ status, draft, busy, saveSettings, reload, t }) {
  const request = useClientRequests()
  const [model, setModel] = React.useState('')
  const [account, setAccount] = React.useState('')
  const [limits, setLimits] = React.useState({})
  const [images, setImages] = React.useState({})
  const [notice, setNotice] = React.useState(null)
  const limitFields = ['maxRequestBytes', 'connectTimeoutMs', 'firstOutputTimeoutMs', 'bodyTimeoutMs', 'idleTimeoutMs', 'totalTimeoutMs']
  const imageFields = ['maxRequestImageBytes', 'requestImagePixelBudget', 'requestImageMaxBytes']
  const limitKey = JSON.stringify(draft.proxyLimits || {})
  const imageKey = JSON.stringify(status.imageControls || {})
  React.useEffect(() => { setLimits(JSON.parse(limitKey)) }, [limitKey])
  React.useEffect(() => { setImages(JSON.parse(imageKey)) }, [imageKey])
  const post = async (path, body) => {
    try {
      const res = await request(`${ROUTE_PREFIX}/proxy/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setNotice({ ok: true, message: t('models.saved') }); await reload()
    } catch (error) { setNotice({ ok: false, message: String(error.message || error) }) }
  }
  const saveLimits = async () => {
    const next = Object.fromEntries(limitFields.map((key) => [key, Number(limits[key])]))
    if (limitFields.some((key) => !Number.isSafeInteger(next[key]) || next[key] < (key === 'maxRequestBytes' ? 1024 : 50))) {
      setNotice({ ok: false, message: t('proxy.bad_limits') }); return
    }
    setNotice(await saveSettings({ proxyLimits: next }))
  }
  return React.createElement('div', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('proxy.title')),
    React.createElement('label', { className: 'cb-check' }, React.createElement('input', { type: 'checkbox', checked: !!draft.proxyEnabled, disabled: !!busy, onChange: (event) => saveSettings({ proxyEnabled: event.target.checked }) }), t('proxy.enabled')),
    React.createElement('div', { className: 'cb-section-desc' }, t('proxy.desc')),
    status.proxy?.error || status.nativeAdapter?.error ? React.createElement('div', { className: 'cb-alert-bad' }, status.proxy?.error || status.nativeAdapter.error) : null,
    React.createElement('label', { className: 'cb-field' }, t('proxy.strategy'), React.createElement('select', { className: 'cb-input', value: draft.accountMode || 'least-used', disabled: !!busy, onChange: (event) => saveSettings({ accountMode: event.target.value }) },
      React.createElement('option', { value: 'least-used' }, t('proxy.least_used')), React.createElement('option', { value: 'round-robin' }, t('proxy.round_robin')))),
    React.createElement('div', { className: 'cb-section-desc' }, t('proxy.precedence')),
    React.createElement('div', { className: 'cb-row' },
      React.createElement('select', { className: 'cb-input', value: model, 'aria-label': t('proxy.model'), onChange: (event) => setModel(event.target.value) },
        React.createElement('option', { value: '' }, t('proxy.model')), (status.availableModels || []).map((row) => React.createElement('option', { value: row.id, key: row.id }, row.name))),
      React.createElement('select', { className: 'cb-input', value: account, 'aria-label': t('proxy.account'), onChange: (event) => setAccount(event.target.value) },
        React.createElement('option', { value: '' }, t('proxy.account')), (status.accounts || []).map((row) => React.createElement('option', { value: row.apiKeyEnv, key: row.apiKeyEnv }, row.label || row.apiKeyEnv))),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy || !model || !account, onClick: () => saveSettings({ modelRoutes: [...(draft.modelRoutes || []).filter((row) => row.model !== model), { model, account }] }) }, t('proxy.route_save'))),
    (draft.modelRoutes || []).map((row) => React.createElement('div', { className: 'cb-row', key: row.model }, React.createElement('span', { className: 'cb-model-id' }, `${row.model} → ${row.account}`),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => saveSettings({ modelRoutes: draft.modelRoutes.filter((route) => route.model !== row.model) }) }, t('proxy.route_remove')))),
    React.createElement('div', { className: 'cb-section-desc' }, t('proxy.runtime', { requests: status.proxy?.activeRequests || 0, sessions: status.proxy?.sessions || 0 })),
    (status.proxy?.cooldowns || []).map((entry) => React.createElement('div', { className: 'cb-row', key: entry.account },
      React.createElement('span', { className: 'cb-model-id' }, `${entry.account} · ${entry.reason} · ${Math.ceil(entry.remainingMs / 1000)}s`),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => post('cooldown', { account: entry.account }) }, t('proxy.recover')))),
    React.createElement('details', null, React.createElement('summary', null, t('proxy.limits')),
      React.createElement('div', { className: 'cb-editor' }, limitFields.map((key) => React.createElement('label', { className: 'cb-field', key }, t(`proxy.${key}`),
        React.createElement('input', { className: 'cb-input', type: 'number', min: key === 'maxRequestBytes' ? 1024 : 50, value: limits[key] ?? '', onChange: (event) => setLimits({ ...limits, [key]: event.target.value }) })))),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: saveLimits }, t('proxy.save_limits'))),
    React.createElement('details', null, React.createElement('summary', null, t('proxy.images')),
      React.createElement('div', { className: 'cb-section-desc' }, t('proxy.images_hint')),
      React.createElement('label', { className: 'cb-check' }, React.createElement('input', { type: 'checkbox', checked: !!draft.historyImageOffload, disabled: !!busy, onChange: (event) => saveSettings({ historyImageOffload: event.target.checked }) }), t('proxy.image_offload')),
      React.createElement('label', { className: 'cb-field' }, t('proxy.history_keep'), React.createElement('input', { className: 'cb-input', type: 'number', min: 0, value: draft.historyImagesToKeep ?? 2, disabled: !!busy,
        onChange: (event) => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value >= 0) saveSettings({ historyImagesToKeep: value }) } })),
      React.createElement('div', { className: 'cb-editor' }, imageFields.map((key) => React.createElement('label', { className: 'cb-field', key }, t(`proxy.${key}`),
        React.createElement('input', { className: 'cb-input', type: 'number', min: 1, value: images[key] ?? '', onChange: (event) => setImages({ ...images, [key]: event.target.value }) })))),
      React.createElement('div', { className: 'cb-row' },
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => post('images', Object.fromEntries(imageFields.map((key) => [key, images[key] === '' || images[key] == null ? 'inherit' : Number(images[key])]))) }, t('proxy.image_save')),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => post('images', Object.fromEntries(imageFields.map((key) => [key, 'inherit']))) }, t('proxy.image_reset')))),
    notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad' }, notice.message) : null)
}
