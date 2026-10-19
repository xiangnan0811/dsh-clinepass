function DisplaySettings({ status, draft, busy, saveSettings, t }) {
  const [model, setModel] = React.useState('')
  const [input, setInput] = React.useState('')
  const [output, setOutput] = React.useState('')
  const [notice, setNotice] = React.useState(null)
  const edit = (id) => {
    setModel(id)
    const rate = draft.costRates?.find((entry) => entry.model === id)
    setInput(rate ? String(rate.inputPerMillion) : ''); setOutput(rate ? String(rate.outputPerMillion) : '')
  }
  const save = async () => {
    const inRate = Number(input), outRate = Number(output)
    if (!model || input.trim() === '' || output.trim() === '' || !Number.isFinite(inRate) || !Number.isFinite(outRate) || inRate < 0 || outRate < 0) { setNotice({ ok: false, message: t('surface.bad_rate') }); return }
    setNotice(await saveSettings({ costRates: [...(draft.costRates || []).filter((rate) => rate.model !== model), { model, inputPerMillion: inRate, outputPerMillion: outRate }] }))
  }
  return React.createElement('div', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('surface.preferences')),
    ['showSidebarQuota', 'showComposerUsage'].map((key) => React.createElement('label', { className: 'cb-check', key }, React.createElement('input', { type: 'checkbox', checked: draft[key] !== false, disabled: !!busy, onChange: (event) => saveSettings({ [key]: event.target.checked }) }), t(`surface.${key}`))),
    React.createElement('details', null, React.createElement('summary', null, t('surface.rates_title')),
      React.createElement('p', { className: 'cb-section-desc' }, t('surface.cost_hint', { currency: draft.costCurrency || 'USD' })),
      React.createElement('div', { className: 'cb-editor' },
        React.createElement('label', { className: 'cb-field' }, t('surface.currency'), React.createElement('select', { className: 'cb-input', value: draft.costCurrency || 'USD', disabled: !!busy, onChange: (event) => saveSettings({ costCurrency: event.target.value }) }, ['USD', 'CNY', 'EUR', 'GBP', 'JPY'].map((value) => React.createElement('option', { value, key: value }, value)))),
        React.createElement('label', { className: 'cb-field' }, t('surface.rate_model'), React.createElement('select', { className: 'cb-input', value: model, onChange: (event) => edit(event.target.value) }, React.createElement('option', { value: '' }, t('surface.select_model')), (status.availableModels || []).map((row) => React.createElement('option', { value: row.id, key: row.id }, row.name)))),
        React.createElement('label', { className: 'cb-field' }, t('surface.input_rate'), React.createElement('input', { className: 'cb-input', type: 'number', min: 0, step: 'any', value: input, onChange: (event) => setInput(event.target.value) })),
        React.createElement('label', { className: 'cb-field' }, t('surface.output_rate'), React.createElement('input', { className: 'cb-input', type: 'number', min: 0, step: 'any', value: output, onChange: (event) => setOutput(event.target.value) })),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy || !model, onClick: save }, t('surface.save_rate'))),
      (draft.costRates || []).map((rate) => React.createElement('div', { className: 'cb-row', key: rate.model }, React.createElement('span', { className: 'cb-model-id' }, `${rate.model} · ${draft.costCurrency} ${rate.inputPerMillion}/${rate.outputPerMillion}`), React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => edit(rate.model) }, t('models.edit')), React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => saveSettings({ costRates: draft.costRates.filter((row) => row.model !== rate.model) }) }, t('surface.remove_rate'))))),
    notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad' }, notice.message) : null)
}
