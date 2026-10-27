function EconomySettings({ draft, busy, saveSettings, model, t }) {
  const request = useClientRequests()
  const [loadedCatalog, setCatalog] = React.useState(null), [budget, setBudget] = React.useState(null), [error, setError] = React.useState(''), [working, setWorking] = React.useState(false)
  const catalog = loadedCatalog?.model === (model || '') ? loadedCatalog : null
  const generation = React.useRef(0)
  const [selection, setSelection] = React.useState(''), [limits, setLimits] = React.useState({})
  const binding = draft.priceBindings?.find(row => row.model === model)
  React.useEffect(() => { setLimits({ dailyBudget: draft.dailyBudget || 0, monthlyBudget: draft.monthlyBudget || 0 }) }, [draft.dailyBudget, draft.monthlyBudget])
  React.useEffect(() => { setSelection(binding ? JSON.stringify([binding.provider, binding.sourceModel]) : '') }, [model, binding?.provider, binding?.sourceModel])
  const load = React.useCallback(async () => {
    const current = ++generation.current
    const [prices, cost] = await Promise.all([request(`${ROUTE_PREFIX}/prices?model=${encodeURIComponent(model || '')}`), request(`${ROUTE_PREFIX}/budget`)])
    const [data, estimate] = await Promise.all([prices.json(), cost.json()])
    if (!prices.ok || !data.ok || !cost.ok || !estimate.ok) throw new Error(data.error || estimate.error || 'Unable to load reference prices')
    if (current === generation.current) { setCatalog(data); setBudget(estimate) }
  }, [request, model, draft.costCurrency, draft.costRates, draft.priceBindings, draft.dailyBudget, draft.monthlyBudget])
  React.useEffect(() => { let active = true; load().catch(failure => { if (active) setError(String(failure.message || failure)) }); return () => { active = false; generation.current++ } }, [load])
  async function run(action) {
    setWorking(true); setError('')
    try { await action(); await load() } catch (failure) { setError(String(failure.message || failure)) } finally { setWorking(false) }
  }
  const save = async patch => { const result = await saveSettings(patch); if (!result.ok) throw new Error(result.message) }
  const disabled = !!busy || working
  const amount = value => value?.amount == null ? t('surface.cost_unknown') : `≈ ${formatMoney(value.amount, draft.costCurrency || 'USD')}`
  return React.createElement('div', { className: 'cb-block' },
    React.createElement('div', { className: 'cb-subtitle' }, t('prices.title')),
    React.createElement('p', { className: 'cb-section-desc' }, t('prices.hint')),
    React.createElement('div', { className: 'cb-row' },
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled, onClick: () => run(async () => { const res = await request(`${ROUTE_PREFIX}/prices/sync`, { method: 'POST' }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error) }) }, t('prices.sync')),
      React.createElement('label', { className: 'cb-check' }, React.createElement('input', { type: 'checkbox', checked: draft.priceAutoSync === true, disabled, onChange: event => run(() => save({ priceAutoSync: event.target.checked })) }), t('prices.auto'))),
    React.createElement('p', { className: 'cb-footnote' }, `models.dev · ${catalog?.syncedAt ? new Date(catalog.syncedAt).toLocaleString() : '—'} · ${catalog?.count || 0}`),
    catalog?.error ? React.createElement('p', { className: 'cb-alert-bad' }, catalog.error) : null,
    model ? React.createElement('div', { className: 'cb-grid-2' },
      React.createElement('label', { className: 'cb-field' }, t('prices.reference'), React.createElement('select', { className: 'cb-input', value: selection, disabled, onChange: event => setSelection(event.target.value) },
        React.createElement('option', { value: '' }, t('prices.none')),
        (catalog?.matches || []).map(row => React.createElement('option', { key: `${row.provider}/${row.id}`, value: JSON.stringify([row.provider, row.id]) }, `${row.provider} · ${row.id} · ${row.inputPerMillion ?? '—'} / ${row.outputPerMillion ?? '—'} USD/1M`)))),
      React.createElement('div', { className: 'cb-row' }, React.createElement('button', { type: 'button', className: 'cb-btn', disabled: disabled || !catalog || draft.costCurrency !== 'USD', onClick: () => run(() => {
        const next = (draft.priceBindings || []).filter(row => row.model !== model)
        if (selection) { const [provider, sourceModel] = JSON.parse(selection); next.push({ model, provider, sourceModel }) }
        return save({ priceBindings: next })
      }) }, t('prices.bind')))) : React.createElement('p', { className: 'cb-footnote' }, t('surface.select_model')),
    catalog?.effective ? React.createElement('p', { className: 'cb-footnote' }, `${t('prices.effective')}: ${catalog.effective.source === 'manual' ? t('prices.manual') : `${catalog.effective.provider} / ${catalog.effective.id}`} · ${['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion'].map(field => catalog.effective[field] ?? '—').join(' / ')} ${catalog.effective.currency}/1M`) : null,
    React.createElement('div', { className: 'cb-subtitle cb-block' }, t('budget.title')),
    React.createElement('p', { className: 'cb-section-desc' }, t('budget.hint')),
    React.createElement('div', { className: 'cb-grid-2' }, ['dailyBudget', 'monthlyBudget'].map(field => React.createElement('label', { className: 'cb-field', key: field }, `${t(`budget.${field}`)} (${draft.costCurrency || 'USD'})`,
      React.createElement('input', { type: 'number', className: 'cb-input', min: 0, step: 'any', value: limits[field] ?? 0, disabled, onChange: event => setLimits({ ...limits, [field]: event.target.value }) })))),
    React.createElement('div', { className: 'cb-row' }, React.createElement('button', { type: 'button', className: 'cb-btn', disabled, onClick: () => run(() => {
      const patch = Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, Number(value)]))
      if (Object.values(patch).some(value => !Number.isFinite(value) || value < 0)) throw new Error(t('surface.bad_rate'))
      return save(patch)
    }) }, t('budget.save'))),
    budget ? React.createElement('p', { className: budget.blocked ? 'cb-alert-bad' : 'cb-footnote', role: 'status' }, `${t('budget.dailyBudget')}: ${amount(budget.day)} · ${t('budget.monthlyBudget')}: ${amount(budget.month)} · ${t(`budget.${budget.code || (budget.enabled ? 'ready' : 'off')}`)}`) : null,
    error ? React.createElement('p', { className: 'cb-alert-bad', role: 'alert' }, error) : null)
}
