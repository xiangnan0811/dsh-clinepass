function optionLabel(mode, t) {
  if (mode === 'inherit') return t('models.opt_inherit')
  if (mode === 'text') return t('models.opt_text')
  if (mode === 'text+image') return t('models.opt_image')
  if (mode === 'off') return t('models.opt_off')
  if (mode === 'vendor') return t('models.opt_vendor')
  return mode
}

function formatK(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n % 1024 === 0) return `${n / 1024}k`
  return `${Math.round(n / 1000)}k`
}

function reasoningLabel(model, t) {
  if (model.reasoningSource === 'user-off') return t('models.reasoning_off')
  const active = model.reasoningLevelIds || []
  if (active.length) return active.join(' / ')
  const available = model.catalogReasoningLevels || []
  if (available.length) return available.join(' / ')
  return '—'
}

function ModelsSection({
  modelsList,
  enabledSet,
  enabledCount,
  totalCount,
  keyPresent,
  busy,
  modelsFilter,
  providerReasoning,
  handleSyncPlanModels,
  handleSetModelsFilter,
  handleToggleModel,
  saveModelPatch,
  t,
}) {
  const [editing, setEditing] = React.useState('')
  const [form, setForm] = React.useState(null)
  const [notice, setNotice] = React.useState(null)

  function openEditor(model) {
    const override = model.override || {}
    setEditing(model.id)
    setForm({
      contextWindow: override.contextWindow === 'inherit' ? '' : String(override.contextWindow ?? ''),
      outputCapability: override.outputCapability === 'inherit' ? '' : String(override.outputCapability ?? ''),
      requestOutputBudget: override.requestOutputBudget === 'inherit' ? '' : String(override.requestOutputBudget ?? ''),
      inputMode: override.inputMode || 'inherit',
      reasoningMode: override.reasoningMode || 'inherit',
    })
  }

  async function saveEditor(model, restore) {
    const counts = restore ? null : {
      contextWindow: parseTokenCount(form.contextWindow),
      outputCapability: parseTokenCount(form.outputCapability),
      requestOutputBudget: parseTokenCount(form.requestOutputBudget),
    }
    if (counts && (!counts.contextWindow.ok || !counts.outputCapability.ok || !counts.requestOutputBudget.ok)) {
      setNotice({ id: model.id, ok: false, text: t('models.bad_number') })
      return
    }
    const result = await saveModelPatch({
      modelOverride: {
        id: model.id,
        contextWindow: restore ? 'inherit' : counts.contextWindow.value,
        outputCapability: restore ? 'inherit' : counts.outputCapability.value,
        requestOutputBudget: restore ? 'inherit' : counts.requestOutputBudget.value,
        inputMode: restore ? 'inherit' : form.inputMode,
        reasoningMode: restore ? 'inherit' : form.reasoningMode,
      },
    })
    if (result) setNotice({ id: model.id, ok: result.ok, text: result.message })
  }

  return React.createElement(
    'div',
    { className: 'cb-section-card' },
    React.createElement(
      'div',
      { className: 'cb-section-title cb-section-title-stack' },
      t('models.title', { enabled: enabledCount, total: totalCount }),
      React.createElement(
        'div',
        { className: 'cb-row' },
        [['all', 'models.all'], ['vision', 'models.vision'], ['coding', 'models.coding'], ['recommended', 'models.recommended']].map(([id, key]) => React.createElement(
          'button',
          {
            key: id,
            type: 'button',
            className: modelsFilter === id ? 'cb-btn cb-btn-active' : 'cb-btn',
            onClick: () => handleSetModelsFilter(id),
          },
          t(key),
        )),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => saveModelPatch({ selectionKind: 'all-except-disabled', disabledModels: [], explicitModels: [] }) }, t('models.enable_all')),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy || !keyPresent, onClick: handleSyncPlanModels }, busy === 'sync-models' ? t('models.syncing') : t('models.sync')),
      )
    ),
    React.createElement('div', { className: 'cb-section-desc' }, t('models.desc')),
    React.createElement(
      'label',
      { className: 'cb-field' },
      React.createElement('span', { className: 'cb-field-label' }, t('models.route_reasoning')),
      React.createElement('select', {
        className: 'cb-input',
        value: providerReasoning || '',
        onChange: (event) => saveModelPatch({ providerReasoning: event.target.value }),
      }, ['', 'low', 'high', 'max'].map((level) => React.createElement('option', { key: level || 'inherit', value: level }, level || t('models.provider_default'))))
    ),
    React.createElement(
      'div',
      { className: 'cb-model-list' },
      modelsList.map((model) => React.createElement(
        'div',
        { key: model.id },
        React.createElement('div', { className: 'cb-model' },
          React.createElement('input', {
            type: 'checkbox',
            checked: enabledSet.has(model.id),
            onChange: () => handleToggleModel(model.id),
            'aria-label': model.name,
          }),
          React.createElement('div', { className: 'cb-model-main' },
            React.createElement('div', { className: 'cb-model-head' },
              React.createElement('strong', null, model.name),
              React.createElement('button', {
                type: 'button',
                className: 'cb-btn',
                onClick: () => (editing === model.id ? setEditing('') : openEditor(model)),
              }, editing === model.id ? t('models.close') : t('models.edit')),
            ),
            React.createElement('span', { className: 'cb-model-id' }, model.id),
            model.channelListed ? null : React.createElement('span', { className: 'cb-badge cb-badge-warn' }, t('models.channel_unlisted')),
            React.createElement('div', { className: 'cb-metrics' },
              [[t('models.th_ctx'), model.contextKnown ? formatK(model.contextLength) : '—'],
                [t('models.output_cap'), formatK(model.outputCapability)],
                [t('models.request_budget'), formatK(model.requestOutputBudget)],
                [t('models.th_input'), model.input?.includes('image') ? t('models.image_on') : t('models.image_off')],
                [t('models.th_reasoning'), reasoningLabel(model, t)],
              ].map(([label, value]) => React.createElement('div', { className: 'cb-metric', key: label },
                React.createElement('span', null, label),
                React.createElement('b', null, value),
              )),
            ),
          ),
        ),
        editing === model.id && form ? React.createElement('div', { className: 'cb-editor' },
            model.channelListed && !model.vendorReasoningNote ? null : React.createElement('div', { className: 'cb-section-desc cb-editor-note' }, model.channelListed ? model.vendorReasoningNote : t('models.unlisted_note')),
            React.createElement('div', { className: 'cb-section-desc cb-editor-note' }, t('models.count_hint')),
            React.createElement('label', { className: 'cb-field' }, React.createElement('span', { className: 'cb-field-label' }, t('models.context_ph')), React.createElement('input', { className: 'cb-input', value: form.contextWindow, onChange: (event) => setForm({ ...form, contextWindow: event.target.value }) })),
            React.createElement('label', { className: 'cb-field' }, React.createElement('span', { className: 'cb-field-label' }, t('models.cap_ph')), React.createElement('input', { className: 'cb-input', value: form.outputCapability, onChange: (event) => setForm({ ...form, outputCapability: event.target.value }) })),
            React.createElement('label', { className: 'cb-field' }, React.createElement('span', { className: 'cb-field-label' }, t('models.budget_ph')), React.createElement('input', { className: 'cb-input', value: form.requestOutputBudget, onChange: (event) => setForm({ ...form, requestOutputBudget: event.target.value }) })),
            React.createElement('label', { className: 'cb-field' }, React.createElement('span', { className: 'cb-field-label' }, t('models.th_input')), React.createElement('select', { className: 'cb-input', value: form.inputMode, onChange: (event) => setForm({ ...form, inputMode: event.target.value }) },
              ['inherit', 'text', 'text+image'].map((mode) => React.createElement('option', { key: mode, value: mode }, optionLabel(mode, t))))),
            React.createElement('label', { className: 'cb-field' }, React.createElement('span', { className: 'cb-field-label' }, t('models.th_reasoning')), React.createElement('select', { className: 'cb-input', value: form.reasoningMode, onChange: (event) => setForm({ ...form, reasoningMode: event.target.value }) },
              (model.vendorReasoningAvailable ? ['inherit', 'off', 'vendor'] : ['inherit', 'off']).map((mode) => React.createElement('option', { key: mode, value: mode }, optionLabel(mode, t))))),
            notice && notice.id === model.id ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok cb-editor-note' : 'cb-alert-bad cb-editor-note' }, notice.text) : null,
            React.createElement('div', { className: 'cb-editor-actions' },
              React.createElement('button', {
                type: 'button',
                className: 'cb-btn cb-btn-primary',
                disabled: !!busy,
                onClick: () => saveEditor(model, false),
              }, t('models.save')),
              React.createElement('button', {
                type: 'button',
                className: 'cb-btn',
                disabled: !!busy,
                onClick: () => saveEditor(model, true),
              }, t('models.restore')),
            ),
          )
        : null,
      )),
    )
  )
}
