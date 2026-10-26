function ModelTools({ config, modelsList, saveModelPatch, busy, t }) {
  const request = useClientRequests()
  const [batch, setBatch] = React.useState({})
  const [custom, setCustom] = React.useState({ id: '', name: '', contextWindow: '', outputCapability: '', requestOutputBudget: '', inputMode: 'inherit' })
  const [notice, setNotice] = React.useState(null)
  const [discovery, setDiscovery] = React.useState(null)
  const [discovering, setDiscovering] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [lane, setLane] = React.useState('pass')
  const discoveryRun = React.useRef(0)
  React.useEffect(() => {
    discoveryRun.current++
    setDiscovery(null); setDiscovering(false)
    setCustom({ id: '', name: '', inputMode: 'inherit' })
    return () => { discoveryRun.current++ }
  }, [config.baseUrl, config.apiKeyEnv, config.activeAccount])
  const defaults = config.batchModelDefaults || {}
  React.useEffect(() => {
    setBatch(Object.fromEntries(['contextWindow', 'outputCapability', 'requestOutputBudget'].map((key) => [key, defaults[key] === 'inherit' ? '' : String(defaults[key] || '')])))
  }, [defaults.contextWindow, defaults.outputCapability, defaults.requestOutputBudget])
  const fields = [['contextWindow', 'models.context_ph'], ['outputCapability', 'models.cap_ph'], ['requestOutputBudget', 'models.budget_ph']]
  const input = (form, set, key, label) => React.createElement('label', { className: 'cb-field', key },
    React.createElement('span', { className: 'cb-field-label' }, t(label)),
    React.createElement('input', { className: 'cb-input', value: form[key] || '', disabled: !!busy || (form.builtIn && key !== 'id'), onChange: (event) => set(key === 'id' && (form.metadataId || form.builtIn) ? { id: event.target.value, name: '', inputMode: 'inherit' } : { ...form, [key]: event.target.value }) }))
  async function discover() {
    const run = ++discoveryRun.current
    setDiscovering(true); setNotice(null); setDiscovery(null)
    try {
      const response = await request(`${ROUTE_PREFIX}/models/discover`)
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`)
      if (run === discoveryRun.current) setDiscovery(data)
    } catch (error) {
      if (run === discoveryRun.current) setNotice({ ok: false, message: String(error.message || error) })
    } finally {
      if (run === discoveryRun.current) setDiscovering(false)
    }
  }
  function chooseModel(id) {
    const model = discovery?.models.find((row) => row.id === id)
    if (!model) return
    // Selecting an existing custom row preserves its explicit edits.
    if (config.customModels?.some((row) => row.id === id) && !model.builtIn) { editCustom(id); return }
    setCustom({ id, name: model.name, builtIn: model.builtIn, metadataId: model.metadataId,
      ...Object.fromEntries(fields.map(([key]) => [key, String(model.parameters?.[key] || '')])), inputMode: model.parameters?.inputMode || 'inherit' })
    setNotice(null)
  }
  async function save(kind) {
    if (kind === 'custom' && custom.builtIn) {
      const result = await saveModelPatch({ enableModel: custom.id })
      setNotice(result)
      return
    }
    const form = kind === 'batch' ? batch : custom
    const parameters = {}
    for (const [key] of fields) {
      const count = parseTokenCount(form[key])
      if (!count.ok) { setNotice({ ok: false, message: t('models.bad_number') }); return }
      parameters[key] = count.value
    }
    const result = await saveModelPatch(kind === 'batch'
      ? { batchModelDefaults: parameters }
      : { customModel: { id: custom.id.trim(), name: custom.name, parameters: { ...parameters, inputMode: custom.inputMode } }, enableModel: custom.id.trim() })
    setNotice(result)
  }
  function editCustom(id) {
    const model = config.customModels?.find((item) => item.id === id)
    const override = config.modelOverrides?.find((item) => item.id === id) || {}
    setCustom({ id: model?.id || '', name: model?.name || '', builtIn: !!config.availableModels?.find((row) => row.id === id)?.known, inputMode: override.inputMode || 'inherit',
      ...Object.fromEntries(fields.map(([key]) => [key, override[key] === 'inherit' ? '' : String(override[key] || '')])) })
  }
  const candidates = (discovery?.models || []).filter((model) => model.lane === lane && `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase()))
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'cb-row' },
      [['none', 'models.select_none'], ['plan', 'models.select_plan'], ['clean', 'models.clean_selection']].map(([action, label]) =>
        React.createElement('button', { key: action, type: 'button', className: 'cb-btn cb-btn-sm', disabled: !!busy || (action === 'plan' && !config.planVerified), onClick: () => saveModelPatch({ selectionAction: action }) }, t(label))),
      React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm', disabled: !!busy, onClick: () => saveModelPatch({ selectionKind: 'explicit', explicitModels: modelsList.map((model) => model.id) }) }, t('models.select_visible'))),
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
      React.createElement('div', { className: 'cb-section-desc' }, t('models.custom_hint')),
      React.createElement('div', { className: 'cb-row' },
        React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-primary', disabled: !!busy || discovering, onClick: discover }, t(discovering ? 'models.discovering' : 'models.discover'))),
      discovery ? React.createElement('div', { className: 'cb-discovery' },
        React.createElement('div', { className: 'cb-toolbar' },
          React.createElement('select', { className: 'cb-input', value: lane, 'aria-label': t('models.discovery_lane'), onChange: (event) => setLane(event.target.value) },
            React.createElement('option', { value: 'pass' }, t('models.discovery_pass')),
            React.createElement('option', { value: 'api' }, t('models.discovery_api'))),
          React.createElement('input', { className: 'cb-input cb-grow', type: 'search', value: search, placeholder: t('models.search'), 'aria-label': t('models.search'), onChange: (event) => setSearch(event.target.value) })),
        React.createElement('div', { className: 'cb-section-desc' }, t(lane === 'pass' ? 'models.discovery_pass_hint' : 'models.discovery_api_hint')),
        React.createElement('label', { className: 'cb-field' }, t('models.discovery_choose', { count: candidates.length }),
          React.createElement('select', { className: 'cb-input', value: candidates.some((row) => row.id === custom.id) ? custom.id : '', disabled: !!busy, onChange: (event) => chooseModel(event.target.value) },
            React.createElement('option', { value: '' }, t('models.discovery_placeholder')),
            candidates.map((model) => React.createElement('option', { key: model.id, value: model.id }, `${model.name} · ${model.id}`)))),
        discovery.warnings?.length ? React.createElement('div', { className: 'cb-banner-warning' }, t('models.discovery_partial'), ' ', discovery.warnings.join('; ')) : null) : null,
      React.createElement('label', { className: 'cb-field' }, t('models.custom_title'),
      React.createElement('select', { className: 'cb-input', value: config.customModels?.some((model) => model.id === custom.id) ? custom.id : '', onChange: (event) => editCustom(event.target.value), 'aria-label': t('models.custom_title') },
        React.createElement('option', { value: '' }, t('models.custom_new')),
        (config.customModels || []).map((model) => React.createElement('option', { key: model.id, value: model.id }, model.name || model.id)))),
      React.createElement('div', { className: 'cb-editor' },
        input(custom, setCustom, 'id', 'models.custom_id'), input(custom, setCustom, 'name', 'models.custom_name')),
      custom.metadataId ? React.createElement('div', { className: 'cb-section-desc' }, t(custom.builtIn ? 'models.discovery_builtin' : 'models.discovery_prefilled', { model: custom.metadataId })) : null,
      custom.id && config.planFilterEnabled && config.planVerified && !config.discoveredPlanIds?.includes(custom.id) ? React.createElement('div', { className: 'cb-banner-warning' }, t('models.discovery_filtered')) : null,
      !custom.builtIn ? React.createElement('details', null,
        React.createElement('summary', null, t('models.custom_advanced')),
        React.createElement('div', { className: 'cb-section-desc' }, t('models.custom_optional')),
        React.createElement('div', { className: 'cb-editor' },
        fields.map(([key, label]) => input(custom, setCustom, key, label)),
        React.createElement('label', { className: 'cb-check' }, React.createElement('input', { type: 'checkbox', disabled: !!busy, checked: custom.inputMode === 'text+image', onChange: (event) => setCustom({ ...custom, inputMode: event.target.checked ? 'text+image' : 'text' }) }), t('models.custom_image')))) : null,
      React.createElement('div', { className: 'cb-row' },
        React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-primary', disabled: !!busy || !custom.id.trim(), onClick: () => save('custom') }, t(custom.builtIn ? 'models.discovery_enable' : 'models.custom_save')),
        React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-danger', disabled: !!busy || !config.customModels?.some((model) => model.id === custom.id), onClick: async () => { const result = await saveModelPatch({ deleteCustomModel: custom.id }); setNotice(result); if (result.ok) editCustom('') } }, t('models.custom_delete')))),
    notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad' }, notice.message) : null)
}
