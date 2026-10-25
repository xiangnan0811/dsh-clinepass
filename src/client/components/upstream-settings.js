function UpstreamPinEditor({ model, config, busy, saveModelPatch, t }) {
  const saved = config.upstreamPins?.find((row) => row.model === model)?.provider || ''
  const [provider, setProvider] = React.useState(saved)
  const [notice, setNotice] = React.useState(null)
  React.useEffect(() => { setProvider(saved); setNotice(null) }, [model, saved])
  const save = async (value) => {
    const result = await saveModelPatch({ upstreamPin: { model, provider: value } })
    if (result?.ok) setProvider(value)
    setNotice(result)
  }
  return React.createElement('div', { className: 'cb-pin-editor' },
    React.createElement('label', { className: 'cb-field' }, t('pin.label'),
      React.createElement('input', { className: 'cb-input', value: provider, placeholder: 'deepseek', autoCapitalize: 'none', spellCheck: false, disabled: !!busy || !model, onChange: (event) => setProvider(event.target.value) })),
    React.createElement('p', { className: 'cb-section-desc' }, t('pin.hint')),
    React.createElement('div', { className: 'cb-row' },
      React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-primary', disabled: !!busy || !model, onClick: () => save(provider.trim()) }, t('pin.save')),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy || !model || !saved, onClick: () => save('') }, t('pin.clear'))),
    notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad', role: 'status' }, notice.message) : null)
}

function UpstreamSettings({ status, config, busy, saveModelPatch, t }) {
  const models = status.availableModels || []
  const [selected, setModel] = React.useState(() => models.some((row) => row.id === config.defaultModel) ? config.defaultModel : '')
  const model = models.some((row) => row.id === selected) ? selected : ''
  React.useEffect(() => { if (selected && !model) setModel('') }, [selected, model])
  return React.createElement('section', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('pin.title')),
    React.createElement('p', { className: 'cb-section-desc' }, t('pin.section_hint')),
    React.createElement('label', { className: 'cb-field' }, t('pin.model'),
      React.createElement('select', { className: 'cb-input', value: model, disabled: !!busy, onChange: (event) => setModel(event.target.value) },
        React.createElement('option', { value: '' }, t('surface.select_model')),
        models.map((row) => React.createElement('option', { key: row.id, value: row.id }, row.name)))),
    React.createElement(UpstreamPinEditor, { key: model, model, config, busy, saveModelPatch, t }),
    (config.upstreamPins || []).map((pin) => React.createElement('div', { className: 'cb-row', key: pin.model },
      React.createElement('span', { className: 'cb-model-id' }, pin.model), React.createElement('span', { className: 'cb-badge' }, pin.provider))))
}
