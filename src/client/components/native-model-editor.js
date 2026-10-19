function NativeModelEditor(props) {
  const t = props?.t || makeT(en, en)
  const request = useClientRequests()
  const [models, setModels] = React.useState([])
  const [active, setActive] = React.useState(false)
  const [editing, setEditing] = React.useState('')
  const [draft, setDraft] = React.useState({})
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState(null)
  const load = React.useCallback(async () => {
    const response = await request(`${ROUTE_PREFIX}/native-models`)
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`)
    setActive(data.active); setModels(data.models)
  }, [request])
  React.useEffect(() => { load().catch((error) => setNotice({ ok: false, message: String(error.message || error) })) }, [load])
  async function save() {
    const context = parseTokenCount(draft.contextWindow)
    const budget = parseTokenCount(draft.maxTokens)
    if (!context.ok || !budget.ok) { setNotice({ ok: false, message: t('models.bad_number') }); return }
    setBusy(true)
    try {
      const response = await request(`${ROUTE_PREFIX}/native-models`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing, contextWindow: context.value, maxTokens: budget.value, input: draft.input }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setNotice({ ok: true, message: t('models.saved') }); await load()
    } catch (error) { setNotice({ ok: false, message: String(error.message || error) }) }
    finally { setBusy(false) }
  }
  if (!active) return notice ? React.createElement('div', { className: 'cb-alert-bad' }, notice.message) : null
  return React.createElement('details', { className: 'cb-page', style: { paddingTop: 12 } },
    React.createElement('summary', null, t('models.native_title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('models.native_hint')),
    models.map((model) => React.createElement('div', { key: model.id },
      React.createElement('div', { className: 'cb-row' }, React.createElement('span', { className: 'cb-model-id' }, model.name || model.id),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy, onClick: () => { setEditing(model.id); setDraft({ contextWindow: model.contextWindow == null ? '' : String(model.contextWindow), maxTokens: model.maxTokens == null ? '' : String(model.maxTokens), input: model.input.includes('image') ? 'text+image' : 'text' }) } }, t('models.edit'))),
      editing === model.id ? React.createElement('div', { className: 'cb-editor' },
        React.createElement('label', { className: 'cb-field' }, t('models.context_ph'), React.createElement('input', { className: 'cb-input', value: draft.contextWindow, onChange: (event) => setDraft({ ...draft, contextWindow: event.target.value }) })),
        React.createElement('label', { className: 'cb-field' }, t('models.budget_ph'), React.createElement('input', { className: 'cb-input', value: draft.maxTokens, onChange: (event) => setDraft({ ...draft, maxTokens: event.target.value }) })),
        React.createElement('label', { className: 'cb-field' }, t('models.th_input'), React.createElement('select', { className: 'cb-input', value: draft.input, onChange: (event) => setDraft({ ...draft, input: event.target.value }) }, ['text', 'text+image'].map((value) => React.createElement('option', { key: value, value }, optionLabel(value, t))))),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: busy, onClick: save }, t('models.save'))) : null)),
    notice ? React.createElement('div', { className: notice.ok ? 'cb-alert-ok' : 'cb-alert-bad' }, notice.message) : null)
}
