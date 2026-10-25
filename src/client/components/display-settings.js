function DisplaySettings({ status, draft, busy, saveSettings, t }) {
  const fields = [['inputPerMillion', 'rate_col_input'], ['outputPerMillion', 'rate_col_output'], ['cacheReadPerMillion', 'rate_col_cache_read'], ['cacheWritePerMillion', 'rate_col_cache_write']]
  const unit = `${draft.costCurrency || 'USD'}/1M`
  const [model, setModel] = React.useState('')
  const [values, setValues] = React.useState({})
  const [notice, setNotice] = React.useState(null)
  const edit = (id) => {
    setModel(id); setNotice(null)
    const rate = draft.costRates?.find((entry) => entry.model === id)
    setValues(Object.fromEntries(fields.map(([key]) => [key, rate?.[key] == null ? '' : String(rate[key])])))
  }
  const save = async () => {
    if (!model || fields.some(([key]) => !values[key]?.trim() || !Number.isFinite(Number(values[key])) || Number(values[key]) < 0)) {
      setNotice({ ok: false, message: t('surface.bad_rate') }); return
    }
    const rate = { model, ...Object.fromEntries(fields.map(([key]) => [key, Number(values[key])])) }
    setNotice(await saveSettings({ costRates: [...(draft.costRates || []).filter((entry) => entry.model !== model), rate] }))
  }
  return React.createElement('div', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('surface.preferences')),
    ['showSidebarQuota', 'showComposerUsage'].map((key) => React.createElement('label', { className: 'cb-check', key }, React.createElement('input', { type: 'checkbox', checked: draft[key] !== false, disabled: !!busy, onChange: (event) => saveSettings({ [key]: event.target.checked }) }), t(`surface.${key}`))),
    React.createElement('details', null, React.createElement('summary', null, t('surface.rates_title')),
      React.createElement('p', { className: 'cb-section-desc' }, t('surface.cost_hint', { currency: draft.costCurrency || 'USD' })),
      React.createElement('div', { className: 'cb-grid-2' },
        React.createElement('label', { className: 'cb-field' }, t('surface.currency'), React.createElement('select', { className: 'cb-input', value: draft.costCurrency || 'USD', disabled: !!busy, onChange: (event) => saveSettings({ costCurrency: event.target.value }) }, ['USD', 'CNY', 'EUR', 'GBP', 'JPY'].map((value) => React.createElement('option', { value, key: value }, value)))),
        React.createElement('label', { className: 'cb-field' }, t('surface.rate_model'), React.createElement('select', { className: 'cb-input', value: model, onChange: (event) => edit(event.target.value) }, React.createElement('option', { value: '' }, t('surface.select_model')), (status.availableModels || []).map((row) => React.createElement('option', { value: row.id, key: row.id }, row.name)))),
        fields.map(([key, label]) => React.createElement('label', { className: 'cb-field', key }, `${t(`surface.${label}`)} (${unit})`, React.createElement('input', { className: 'cb-input', type: 'number', min: 0, step: 'any', value: values[key] || '', disabled: !!busy, placeholder: '—', onChange: (event) => setValues({ ...values, [key]: event.target.value }) })))),
      React.createElement('div', { className: 'cb-row' }, React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-primary', disabled: !!busy || !model, onClick: save }, t('surface.save_rate'))),
      notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad', role: 'status' }, notice.message) : null,
      draft.costRates?.length ? React.createElement('div', { className: 'cb-table-box' }, React.createElement('table', { className: 'cb-table' },
        React.createElement('thead', null, React.createElement('tr', null,
          React.createElement('th', null, t('durable.model')),
          fields.map(([key, label]) => React.createElement('th', { key, className: 'cb-num' }, `${t(`surface.${label}`)} (${unit})`)),
          React.createElement('th', { className: 'cb-actions' }, t('accounts.col_action')))),
        React.createElement('tbody', null, draft.costRates.map((rate) => React.createElement('tr', { key: rate.model },
          React.createElement('td', null, React.createElement('code', null, rate.model)),
          fields.map(([key]) => React.createElement('td', { key, className: 'cb-num' }, rate[key] == null ? t('surface.unknown') : rate[key])),
          React.createElement('td', { className: 'cb-actions' }, React.createElement('div', { className: 'cb-row' },
            React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm', disabled: !!busy, onClick: () => edit(rate.model) }, t('models.edit')),
            React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm cb-btn-ghost', disabled: !!busy, onClick: () => saveSettings({ costRates: draft.costRates.filter((row) => row.model !== rate.model) }) }, t('surface.remove_rate'))))))))) : null))
}
