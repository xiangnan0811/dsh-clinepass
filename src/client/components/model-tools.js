function ModelTools({ config, modelsList, saveModelPatch, busy, t }) {
  const [batch, setBatch] = React.useState({})
  const [custom, setCustom] = React.useState({ id: '', name: '', contextWindow: '', outputCapability: '', requestOutputBudget: '', inputMode: 'inherit' })
  const [notice, setNotice] = React.useState(null)
  const defaults = config.batchModelDefaults || {}
  React.useEffect(() => {
    setBatch(Object.fromEntries(['contextWindow', 'outputCapability', 'requestOutputBudget'].map((key) => [key, defaults[key] === 'inherit' ? '' : String(defaults[key] || '')])))
  }, [defaults.contextWindow, defaults.outputCapability, defaults.requestOutputBudget])
  const fields = [['contextWindow', 'models.context_ph'], ['outputCapability', 'models.cap_ph'], ['requestOutputBudget', 'models.budget_ph']]
  const input = (form, set, key, label) => React.createElement('label', { className: 'cb-field', key },
    React.createElement('span', { className: 'cb-field-label' }, t(label)),
    React.createElement('input', { className: 'cb-input', value: form[key] || '', onChange: (event) => set({ ...form, [key]: event.target.value }) }))
  async function save(kind) {
    const form = kind === 'batch' ? batch : custom
    const parameters = {}
    for (const [key] of fields) {
      const count = parseTokenCount(form[key])
      if (!count.ok) { setNotice({ ok: false, message: t('models.bad_number') }); return }
      parameters[key] = count.value
    }
    const result = await saveModelPatch(kind === 'batch'
      ? { batchModelDefaults: parameters }
      : { customModel: { id: custom.id, name: custom.name, parameters: { ...parameters, inputMode: custom.inputMode } } })
    setNotice(result)
  }
  function editCustom(id) {
    const model = config.customModels.find((item) => item.id === id)
    const override = config.modelOverrides?.find((item) => item.id === id) || {}
    setCustom({ id: model?.id || '', name: model?.name || '', inputMode: override.inputMode || 'inherit',
      ...Object.fromEntries(fields.map(([key]) => [key, override[key] === 'inherit' ? '' : String(override[key] || '')])) })
  }
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'cb-row' },
      [['none', 'models.select_none'], ['plan', 'models.select_plan'], ['clean', 'models.clean_selection']].map(([action, label]) =>
        React.createElement('button', { key: action, type: 'button', className: 'cb-btn', disabled: !!busy || (action === 'plan' && !config.planVerified), onClick: () => saveModelPatch({ selectionAction: action }) }, t(label))),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => saveModelPatch({ selectionKind: 'explicit', explicitModels: modelsList.map((model) => model.id) }) }, t('models.select_visible'))),
    React.createElement('label', { className: 'cb-check' }, React.createElement('input', { type: 'checkbox', checked: !!config.planFilterEnabled, disabled: !!busy, onChange: (event) => saveModelPatch({ planFilterEnabled: event.target.checked }) }), t('models.plan_filter')),
    config.planFilterEnabled && !config.planVerified ? React.createElement('div', { className: 'cb-banner-warning' }, t('models.plan_pending')) : null,
    React.createElement('details', null,
      React.createElement('summary', null, t('models.batch_title')),
      React.createElement('div', { className: 'cb-section-desc' }, t('models.batch_hint')),
      React.createElement('div', { className: 'cb-editor' }, fields.map(([key, label]) => input(batch, setBatch, key, label))),
      React.createElement('div', { className: 'cb-row' },
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => save('batch') }, t('models.batch_save')),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => saveModelPatch({ batchModelDefaults: { contextWindow: 'inherit', outputCapability: 'inherit' } }) }, t('models.batch_restore')))),
    React.createElement('details', null,
      React.createElement('summary', null, t('models.custom_title')),
      React.createElement('select', { className: 'cb-input', value: config.customModels?.some((model) => model.id === custom.id) ? custom.id : '', onChange: (event) => editCustom(event.target.value), 'aria-label': t('models.custom_title') },
        React.createElement('option', { value: '' }, t('models.custom_new')),
        (config.customModels || []).map((model) => React.createElement('option', { key: model.id, value: model.id }, model.name || model.id))),
      React.createElement('div', { className: 'cb-editor' },
        input(custom, setCustom, 'id', 'models.custom_id'), input(custom, setCustom, 'name', 'models.custom_name'),
        fields.map(([key, label]) => input(custom, setCustom, key, label)),
        React.createElement('label', { className: 'cb-check' }, React.createElement('input', { type: 'checkbox', checked: custom.inputMode === 'text+image', onChange: (event) => setCustom({ ...custom, inputMode: event.target.checked ? 'text+image' : 'inherit' }) }), t('models.custom_image'))),
      React.createElement('div', { className: 'cb-row' },
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy || !custom.id.trim(), onClick: () => save('custom') }, t('models.custom_save')),
        React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-danger', disabled: !!busy || !config.customModels?.some((model) => model.id === custom.id), onClick: async () => { const result = await saveModelPatch({ deleteCustomModel: custom.id }); setNotice(result); if (result.ok) editCustom('') } }, t('models.custom_delete')))),
    notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad' }, notice.message) : null)
}
