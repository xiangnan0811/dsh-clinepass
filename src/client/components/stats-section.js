// Floors so that any unmeasured request keeps the share below 100%; a few
// measured requests never read as none.
function coveragePercent(samples, total) {
  if (!total || !samples) return '—'
  if (samples === total) return '100%'
  const share = Math.floor(samples / total * 1000) / 10
  return share ? `${share}%` : '<0.1%'
}

function StatsSection({ status, t }) {
  const request = useClientRequests()
  const [data, setData] = React.useState(null)
  const [filters, setFilters] = React.useState({})
  const [applied, setApplied] = React.useState({})
  const [group, setGroup] = React.useState('day')
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const [confirmReset, setConfirmReset] = React.useState(false)
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
          setConfirmReset(false)
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
    return `${amount.toLocaleString()}${average ? ' ms' : ''}`
  }
  const coverageTitle = (totals, field) => t('durable.coverage_title', { samples: totals.measurements[field].samples, total: totals.requests })
  const coverage = (totals, field) => React.createElement('span', { className: 'cb-coverage', title: coverageTitle(totals, field) }, coveragePercent(totals.measurements[field].samples, totals.requests))
  const summary = data?.summary
  const choices = (key) => {
    const options = new Map((key === 'model' ? status.availableModels || [] : status.accounts || []).map((row) => [key === 'model' ? row.id : row.apiKeyEnv, row.name || row.label || row.apiKeyEnv]))
    for (const row of data?.grouped?.[key] || []) if (!options.has(row.value)) options.set(row.value, row.value)
    if (key === 'account') for (const row of data?.attemptAccounts || []) if (!options.has(row.value)) options.set(row.value, row.value)
    return [...options]
  }
  const fields = ['inputTokens', 'promptTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'latencyMs', 'ttftMs']
  const percent = (part, total) => total ? `${Math.floor(part / total * 1000) / 10}%` : '—'
  const compact = (field) => {
    const value = summary.measurements[field]
    return value.samples ? value.sum.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 }) : t('durable.unknown')
  }
  const covered = (field) => ({ note: `${t('durable.col_coverage')} ${coveragePercent(summary.measurements[field].samples, summary.requests)}`, noteTitle: coverageTitle(summary, field) })
  const kpis = summary ? [
    { label: t('durable.kpi_requests'), value: summary.requests.toLocaleString(), note: t('durable.kpi_requests_sub', { attempts: summary.attempts.toLocaleString(), failure: summary.failure, limited: summary.rateLimits }) },
    { label: t('durable.kpi_success'), value: percent(summary.success, summary.requests), note: `${summary.success.toLocaleString()} / ${summary.requests.toLocaleString()}` },
    { label: t('durable.totalTokens'), value: compact('totalTokens'), valueTitle: measured(summary, 'totalTokens'), ...covered('totalTokens') },
    { label: t('durable.latencyMs'), value: measured(summary, 'latencyMs', true), ...covered('latencyMs') },
    { label: t('durable.ttftMs'), value: measured(summary, 'ttftMs', true), ...covered('ttftMs') },
  ] : []
  const table = (head, rows) => React.createElement('div', { className: 'cb-table-box' }, React.createElement('table', { className: 'cb-table' },
    head ? React.createElement('thead', null, React.createElement('tr', null, head.map(([label, numeric]) => React.createElement('th', { key: label, className: numeric ? 'cb-num' : undefined }, label)))) : null,
    React.createElement('tbody', null, rows)))
  return React.createElement('div', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('durable.title'),
      summary ? React.createElement('span', { className: 'cb-footnote' }, data.persisted ? t('durable.saved') : t('durable.pending', { count: data.pendingRequests })) : null),
    React.createElement('div', { className: 'cb-section-desc' }, t('durable.desc')),
    React.createElement('div', { className: 'cb-filter-grid' },
      ['from', 'to'].map((key) => React.createElement('label', { className: 'cb-field', key }, t(`durable.${key}`), React.createElement('input', { className: 'cb-input', type: 'date', value: filters[key] || '', onChange: (event) => setFilters({ ...filters, [key]: event.target.value }) }))),
      ['model', 'account'].map((key) => React.createElement('label', { className: 'cb-field', key }, t(`durable.${key}`), React.createElement('select', { className: 'cb-input', value: filters[key] || '', onChange: (event) => setFilters({ ...filters, [key]: event.target.value }) },
        React.createElement('option', { value: '' }, t('durable.all')), choices(key).map(([value, name]) => React.createElement('option', { key: value, value }, name)))))),
    React.createElement('div', { className: 'cb-toolbar' },
      React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-primary', disabled: !!busy, onClick: () => { setError(''); setApplied({ ...filters }) } }, t('durable.apply')),
      ['refresh', 'export'].map((kind) => React.createElement('button', { type: 'button', className: 'cb-btn', key: kind, disabled: !!busy || (kind === 'export' && (!data || !!data.error)), onClick: () => action(kind) }, t(`durable.${kind}`))),
      React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-danger cb-push', title: t('durable.reset_hint'), 'aria-expanded': confirmReset, disabled: !!busy, onClick: () => setConfirmReset(true) }, t('durable.reset'))),
    confirmReset ? React.createElement('div', { className: 'cb-confirm', role: 'alertdialog', 'aria-label': t('durable.reset') },
      React.createElement('div', null, t('durable.reset_hint')),
      React.createElement('div', { className: 'cb-row' },
        React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-danger', disabled: !!busy, onClick: () => action('reset') }, t('durable.reset_confirm')),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => setConfirmReset(false) }, t('durable.cancel')))) : null,
    error || data?.error ? React.createElement('div', { className: 'cb-alert-bad' }, error || data.error) : null,
    summary ? React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'cb-kpis' }, kpis.map((kpi) => React.createElement('div', { className: 'cb-kpi', key: kpi.label },
        React.createElement('span', null, kpi.label), React.createElement('b', { title: kpi.valueTitle }, kpi.value), React.createElement('small', { title: kpi.noteTitle }, kpi.note)))),
      React.createElement('div', { className: 'cb-block' },
        table([[t('durable.col_metric')], [t('durable.col_value'), true], [t('durable.col_coverage'), true]],
          fields.map((field) => React.createElement('tr', { key: field }, React.createElement('th', { scope: 'row' }, t(`durable.${field}`)),
            React.createElement('td', { className: 'cb-num' }, measured(summary, field, field.endsWith('Ms'))), React.createElement('td', { className: 'cb-num' }, coverage(summary, field))))),
        React.createElement('div', { className: 'cb-footnote' }, t('durable.samples'))),
      React.createElement('div', { className: 'cb-block' },
        React.createElement('div', { className: 'cb-subtitle' }, t('durable.attempt_title')),
        table(null, data.attemptAccounts.map((row) => React.createElement('tr', { key: row.value },
          React.createElement('th', { scope: 'row' }, React.createElement('code', null, row.value)), React.createElement('td', { className: 'cb-end' }, t('durable.attempt_counts', { attempts: row.totals.requests, failed: row.totals.failure, limited: row.totals.rateLimits }))))),
        React.createElement('div', { className: 'cb-footnote' }, t('durable.attempt_accounts'))),
      React.createElement('div', { className: 'cb-block' },
        React.createElement('div', { className: 'cb-subhead' }, React.createElement('span', { className: 'cb-subtitle' }, t('durable.group')),
          React.createElement('div', { className: 'cb-tabs cb-tabs-sm', role: 'group', 'aria-label': t('durable.group') }, ['day', 'model', 'account'].map((value) =>
            React.createElement('button', { type: 'button', className: 'cb-tab', key: value, 'aria-pressed': group === value, onClick: () => setGroup(value) }, t(`durable.${value}`))))),
        table([[t(`durable.${group}`)], [t('durable.request_count'), true], [t('durable.totalTokens'), true], [t('durable.col_coverage'), true]],
          data.grouped[group].map((row) => React.createElement('tr', { key: row.value },
            React.createElement('td', { className: 'cb-nowrap' }, group === 'day' ? row.value : React.createElement('code', null, row.value)), React.createElement('td', { className: 'cb-num' }, row.totals.requests.toLocaleString()),
            React.createElement('td', { className: 'cb-num' }, measured(row.totals, 'totalTokens')), React.createElement('td', { className: 'cb-num' }, coverage(row.totals, 'totalTokens')))))),
      React.createElement(RoutingHistory, { records: data.recent, t })
    ) : React.createElement('div', { className: 'cb-section-desc' }, t('durable.loading')))
}
