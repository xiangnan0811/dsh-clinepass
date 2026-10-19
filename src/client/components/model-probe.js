function ModelProbe({ status, t }) {
  const request = useClientRequests()
  const models = (status.availableModels || []).filter((row) => status.config.enabledModels.includes(row.id))
  const [model, setModel] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const controller = React.useRef(null)
  React.useEffect(() => () => controller.current?.abort(), [])
  const run = async () => {
    const id = model || models[0]?.id
    if (!id) return
    const current = new AbortController()
    controller.current = current
    setBusy(true); setResult(null)
    try {
      const response = await request(`${ROUTE_PREFIX}/probe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id }), signal: current.signal })
      const data = await response.json()
      setResult(data)
    } catch (error) { setResult({ ok: false, error: current.signal.aborted ? t('surface.cancelled') : String(error.message || error) }) }
    finally { setBusy(false); if (controller.current === current) controller.current = null }
  }
  return React.createElement('div', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('surface.probe_title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('surface.probe_hint')),
    React.createElement('select', { className: 'cb-input', value: model || models[0]?.id || '', disabled: busy, 'aria-label': t('surface.probe_model'), onChange: (event) => setModel(event.target.value) }, models.map((row) => React.createElement('option', { value: row.id, key: row.id }, row.name))),
    React.createElement('div', { className: 'cb-row' }, React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy || !models.length, onClick: run }, t('surface.probe_run')), busy ? React.createElement('button', { type: 'button', className: 'cb-btn', onClick: () => controller.current?.abort() }, t('surface.cancel')) : null),
    result ? React.createElement('div', { className: result.ok ? 'cb-alert-ok' : 'cb-alert-bad', role: 'status' }, result.ok ? t('surface.probe_result', { ttft: result.ttftMs, total: result.totalMs }) : t('surface.probe_error', { error: result.error })) : null)
}
