function StatsSection({ status, t }) {
  const request = useClientRequests()
  const [data, setData] = React.useState(null)
  const [filters, setFilters] = React.useState({})
  const [applied, setApplied] = React.useState({})
  const [group, setGroup] = React.useState('day')
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const download = React.useRef(null)
  const query = new URLSearchParams(Object.entries(applied).filter(([, value]) => value)).toString()
  const load = React.useCallback(async () => {
    const res = await request(`${ROUTE_PREFIX}/stats?${query}`)
    const result = await res.json()
    if (!res.ok || !result.ok) throw new Error(result.error || `HTTP ${res.status}`)
    setData(result)
  }, [request, query])
  React.useEffect(() => { load().catch((failure) => setError(String(failure.message || failure))) }, [load])
  React.useEffect(() => () => { if (download.current) URL.revokeObjectURL(download.current) }, [])
  async function action(kind) {
    setBusy(kind); setError('')
    try {
      if (kind === 'export') {
        const res = await request(`${ROUTE_PREFIX}/stats/export?${query}`, { responseType: 'text' })
        if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`)
        if (download.current) URL.revokeObjectURL(download.current)
        download.current = URL.createObjectURL(new Blob(['\uFEFF', await res.text()], { type: 'text/csv;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = download.current; link.download = 'clinepass-statistics.csv'
        document.body.appendChild(link); link.click(); link.remove()
      } else {
        if (kind === 'reset') {
          const res = await request(`${ROUTE_PREFIX}/stats/reset`, { method: 'POST' })
          if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`)
        }
        await load()
      }
    } catch (failure) { setError(String(failure.message || failure)) }
    finally { setBusy('') }
  }
  const measured = (totals, field, average = false) => {
    const value = totals.measurements[field]
    if (!value.samples) return t('durable.unknown')
    const amount = average ? Math.round(value.sum / value.samples) : value.sum
    return `${amount.toLocaleString()}${average ? ' ms' : ''} · ${value.samples}/${totals.requests}`
  }
  const summary = data?.summary
  const choices = (key) => {
    const options = new Map((key === 'model' ? status.availableModels || [] : status.accounts || []).map((row) => [key === 'model' ? row.id : row.apiKeyEnv, row.name || row.label || row.apiKeyEnv]))
    for (const row of data?.grouped?.[key] || []) if (!options.has(row.value)) options.set(row.value, row.value)
    if (key === 'account') for (const row of data?.attemptAccounts || []) if (!options.has(row.value)) options.set(row.value, row.value)
    return [...options]
  }
  const fields = ['inputTokens', 'promptTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'latencyMs', 'ttftMs']
  return React.createElement('div', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('durable.title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('durable.desc')),
    React.createElement('div', { className: 'cb-editor' },
      ['from', 'to'].map((key) => React.createElement('label', { className: 'cb-field', key }, t(`durable.${key}`), React.createElement('input', { className: 'cb-input', type: 'date', value: filters[key] || '', onChange: (event) => setFilters({ ...filters, [key]: event.target.value }) }))),
      ['model', 'account'].map((key) => React.createElement('label', { className: 'cb-field', key }, t(`durable.${key}`), React.createElement('select', { className: 'cb-input', value: filters[key] || '', onChange: (event) => setFilters({ ...filters, [key]: event.target.value }) },
        React.createElement('option', { value: '' }, t('durable.all')), choices(key).map(([value, name]) => React.createElement('option', { key: value, value }, name))))),
      React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => { setError(''); setApplied({ ...filters }) } }, t('durable.apply'))),
    React.createElement('div', { className: 'cb-row' },
      ['refresh', 'export', 'reset'].map((kind) => React.createElement('button', { type: 'button', className: kind === 'reset' ? 'cb-btn cb-btn-danger' : 'cb-btn', key: kind, disabled: !!busy || (kind === 'export' && (!data || !!data.error)), onClick: () => action(kind) }, t(`durable.${kind}`)))),
    React.createElement('div', { className: 'cb-section-desc' }, t('durable.reset_hint')),
    error || data?.error ? React.createElement('div', { className: 'cb-alert-bad' }, error || data.error) : null,
    summary ? React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'cb-section-desc' }, t('durable.requests', { requests: summary.requests, success: summary.success, failure: summary.failure, attempts: summary.attempts, limited: summary.rateLimits })),
      React.createElement('div', { className: 'cb-section-desc' }, data.persisted ? t('durable.saved') : t('durable.pending', { count: data.pendingRequests })),
      React.createElement('table', { className: 'cb-table cb-facts' }, React.createElement('tbody', null,
        fields.map((field) => React.createElement('tr', { key: field }, React.createElement('th', { scope: 'row' }, t(`durable.${field}`)), React.createElement('td', { className: 'cb-num' }, measured(summary, field, field.endsWith('Ms'))))))),
      React.createElement('div', { className: 'cb-section-desc' }, t('durable.samples')),
      React.createElement('div', { className: 'cb-section-desc' }, t('durable.attempt_accounts')),
      React.createElement('div', { className: 'cb-table-scroll' }, React.createElement('table', { className: 'cb-table' },
        React.createElement('tbody', null, data.attemptAccounts.map((row) => React.createElement('tr', { key: row.value },
          React.createElement('th', { scope: 'row' }, row.value), React.createElement('td', null, t('durable.attempt_counts', { attempts: row.totals.requests, failed: row.totals.failure, limited: row.totals.rateLimits }))))))),
      React.createElement('label', { className: 'cb-field' }, t('durable.group'), React.createElement('select', { className: 'cb-input', value: group, onChange: (event) => setGroup(event.target.value) }, ['day', 'model', 'account'].map((value) => React.createElement('option', { key: value, value }, t(`durable.${value}`))))),
      React.createElement('div', { className: 'cb-table-scroll' }, React.createElement('table', { className: 'cb-table' },
        React.createElement('thead', null, React.createElement('tr', null, [t(`durable.${group}`), t('durable.request_count'), t('durable.totalTokens')].map((value) => React.createElement('th', { key: value }, value)))),
        React.createElement('tbody', null, data.grouped[group].map((row) => React.createElement('tr', { key: row.value }, React.createElement('td', null, row.value), React.createElement('td', { className: 'cb-num' }, row.totals.requests), React.createElement('td', { className: 'cb-num' }, measured(row.totals, 'totalTokens')))))))
    ) : React.createElement('div', { className: 'cb-section-desc' }, t('durable.loading')))
}
