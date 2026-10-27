// Floors so that any unmeasured request keeps the share below 100%; a few
// measured requests never read as none.
function coveragePercent(samples, total) {
  if (!total || !samples) return '—'
  if (samples === total) return '100%'
  const share = Math.floor(samples / total * 1000) / 10
  return share ? `${share}%` : '<0.1%'
}

function StatsExportMenu({ disabled, onExport, t }) {
  const menu = React.useRef(null)
  const choose = (kind) => { if (menu.current) menu.current.open = false; onExport(kind) }
  return React.createElement('details', { className: 'cb-menu', ref: menu },
    React.createElement('summary', { className: 'cb-btn cb-btn-sm cb-btn-ghost', 'aria-disabled': disabled }, t('stats.export'), React.createElement(Chevron)),
    React.createElement('div', { className: 'cb-menu-list', role: 'menu' },
      React.createElement('button', { type: 'button', role: 'menuitem', disabled, onClick: () => choose('export') }, 'CSV'),
      React.createElement('button', { type: 'button', role: 'menuitem', disabled, onClick: () => choose('json') }, 'JSON')))
}

function StatsSection({ status, t }) {
  const request = useClientRequests()
  const [data, setData] = React.useState(null)
  const [range, setRange] = React.useState('all')
  const [timeWindow, setTimeWindow] = React.useState({ since: '', until: '' })
  const [filters, setFilters] = React.useState({ model: '', account: '', errorsOnly: '' })
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const [confirmReset, setConfirmReset] = React.useState(false)
  const download = React.useRef(null)
  const generation = React.useRef(0)
  const query = new URLSearchParams(Object.entries({ ...filters, ...timeWindow, timezoneOffsetMinutes: new Date().getTimezoneOffset() }).filter(([, value]) => value !== '')).toString()
  const load = React.useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    try {
      const res = await request(`${ROUTE_PREFIX}/stats?${query}`)
      const result = await res.json()
      if (!res.ok || !result.ok) throw new Error(result.error || `HTTP ${res.status}`)
      if (current === generation.current) { setData(result); setError('') }
    } catch (failure) {
      if (current === generation.current) setError(String(failure.message || failure))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [request, query])
  // 切换筛选时保留上一份结果并淡化显示，避免整块内容闪烁。
  React.useEffect(() => { void load(); return () => { generation.current++ } }, [load])
  React.useEffect(() => () => { if (download.current) URL.revokeObjectURL(download.current) }, [])
  const chooseRange = (value) => {
    setRange(value)
    if (value === 'all') setTimeWindow({ since: '', until: '' })
    else if (value !== 'custom') setTimeWindow(presetWindow(Number(value)))
  }
  async function action(kind) {
    setBusy(kind); setError('')
    try {
      if (kind === 'export' || kind === 'json') {
        const json = kind === 'json'
        const res = await request(`${ROUTE_PREFIX}/stats/export?${query}&format=${json ? 'json' : 'csv'}`, { responseType: 'text' })
        if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`)
        if (download.current) URL.revokeObjectURL(download.current)
        download.current = URL.createObjectURL(new Blob([json ? '' : '\uFEFF', await res.text()], { type: json ? 'application/json' : 'text/csv;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = download.current; link.download = `clinepass-statistics.${json ? 'json' : 'csv'}`
        document.body.appendChild(link); link.click(); link.remove()
      } else if (kind === 'sync') {
        const res = await request(`${ROUTE_PREFIX}/prices/sync`, { method: 'POST' })
        const result = await res.json()
        if (!res.ok || !result.ok) throw new Error(result.error || `HTTP ${res.status}`)
        await load()
      } else if (kind === 'reset') {
        const res = await request(`${ROUTE_PREFIX}/stats/reset`, { method: 'POST' })
        if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`)
        setConfirmReset(false)
        await load()
      } else {
        // 预设范围随刷新滚动到当前时间；同一分钟内时间窗不变，直接重新读取。
        const next = range !== 'all' && range !== 'custom' ? presetWindow(Number(range)) : null
        if (next && next.until !== timeWindow.until) setTimeWindow(next)
        else await load()
      }
    } catch (failure) { setError(String(failure.message || failure)) }
    finally { setBusy('') }
  }
  const choices = (key) => {
    const options = new Map((key === 'model' ? status.availableModels || [] : status.accounts || []).map((row) => [key === 'model' ? row.id : row.apiKeyEnv, row.name || row.label || row.apiKeyEnv]))
    for (const row of data?.grouped?.[key] || []) if (!options.has(row.value)) options.set(row.value, row.value)
    if (key === 'account') for (const row of data?.attemptAccounts || []) if (!options.has(row.value)) options.set(row.value, row.value)
    return [...options]
  }
  const summary = data?.summary
  const analytics = data?.analytics
  const exportable = !!data && !data.error && !busy
  return React.createElement('div', { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' },
      React.createElement('span', { className: 'cb-title-group' }, t('stats.title'),
        data && !data.persisted ? React.createElement('span', { className: 'cb-badge cb-badge-warn' }, t('durable.pending', { count: data.pendingRequests })) : null),
      React.createElement('span', { className: 'cb-row' },
        React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm cb-btn-ghost', disabled: !!busy || loading, onClick: () => action('refresh') }, t('durable.refresh')),
        React.createElement(StatsExportMenu, { disabled: !exportable, onExport: action, t }))),
    React.createElement(StatsFilters, { range, timeWindow, filters, choices, detailedOnly: !!analytics?.detailedOnly, disabled: !!busy, onRange: chooseRange, onWindow: setTimeWindow, onFilters: setFilters, t }),
    error || data?.error ? React.createElement('div', { className: 'cb-alert-bad', role: 'alert' }, error || data.error) : null,
    summary ? React.createElement('div', { className: loading ? 'cb-results cb-results-loading' : 'cb-results', 'aria-busy': loading },
      summary.requests ? React.createElement(React.Fragment, null,
        React.createElement(KpiRow, { summary, cost: data.cost, analytics, t }),
        React.createElement(TokenComposition, { summary, t }),
        React.createElement('div', { className: 'cb-insight-grid' },
          React.createElement(CostPanel, { cost: data.cost, syncing: busy === 'sync', onSync: () => action('sync'), t }),
          React.createElement(LatencyPanel, { summary, analytics, t })),
        React.createElement(ActivityHeatmap, { analytics, t }),
        React.createElement(StatsBreakdown, { data, t })) : React.createElement('p', { className: 'cb-empty' }, t('stats.empty')),
      React.createElement(RoutingHistory, { records: data.recent, t })) : !error ? React.createElement('div', { className: 'cb-section-desc' }, t('durable.loading')) : null,
    React.createElement('div', { className: 'cb-card-foot' },
      React.createElement('p', { className: 'cb-footnote' }, t('stats.footer', { days: analytics?.retentionDays || t('analytics.forever'), since: analytics?.detailSince ? formatShortTime(analytics.detailSince) : '—' })),
      React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm cb-btn-ghost cb-btn-danger-text', title: t('durable.reset_hint'), 'aria-expanded': confirmReset, disabled: !!busy, onClick: () => setConfirmReset(true) }, t('durable.reset'))),
    confirmReset ? React.createElement('div', { className: 'cb-confirm', role: 'alertdialog', 'aria-label': t('durable.reset') },
      React.createElement('div', null, t('durable.reset_hint')),
      React.createElement('div', { className: 'cb-row' },
        React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-danger', disabled: !!busy, onClick: () => action('reset') }, t('durable.reset_confirm')),
        React.createElement('button', { type: 'button', className: 'cb-btn', disabled: !!busy, onClick: () => setConfirmReset(false) }, t('durable.cancel')))) : null)
}
