function AnalyticsView({ data, t }) {
  const [cell, setCell] = React.useState(null)
  const analytics = data.analytics
  if (!analytics) return null
  const maximum = Math.max(1, ...analytics.heatmap.flat())
  const percentile = value => !value?.samples ? '—' : value.overflow ? `> ${value.lowerMs.toLocaleString()} ms` : `≤ ${value.upperMs.toLocaleString()} ms`
  const days = t('analytics.weekdays').split(',')
  return React.createElement('div', { className: 'cb-block cb-analytics' },
    React.createElement('div', { className: 'cb-subtitle' }, t('analytics.title')),
    React.createElement('p', { className: 'cb-footnote' }, t('analytics.coverage', { count: analytics.detailedRequests, total: data.summary.requests, since: analytics.detailSince ? new Date(analytics.detailSince).toLocaleString() : '—', days: analytics.retentionDays || t('analytics.forever') })),
    analytics.detailedOnly ? React.createElement('p', { className: 'cb-footnote' }, t('analytics.detailed_only')) : null,
    React.createElement('div', { className: 'cb-grid-2' }, ['latencyMs', 'ttftMs'].map(field => React.createElement('div', { key: field, className: 'cb-kpi' },
      React.createElement('span', null, t(`analytics.${field}`)),
      React.createElement('b', null, `P50 ${percentile(analytics.percentiles[field].p50)}`),
      React.createElement('small', null, `P95 ${percentile(analytics.percentiles[field].p95)} · ${analytics.percentiles[field].p50.samples}/${data.summary.requests}`)))),
    React.createElement('div', { className: 'cb-heatmap-scroll' }, React.createElement('div', { className: 'cb-heatmap', role: 'group', 'aria-label': t('analytics.heatmap') },
      React.createElement('span'), Array.from({ length: 24 }, (_, hour) => React.createElement('span', { key: `h${hour}`, className: 'cb-heatmap-hour' }, hour % 3 === 0 ? hour : '')),
      analytics.heatmap.map((hours, day) => React.createElement(React.Fragment, { key: day }, React.createElement('span', { className: 'cb-heatmap-day' }, days[day]),
        hours.map((count, hour) => React.createElement('button', { type: 'button', key: hour, className: 'cb-heatmap-cell',
          style: { '--cb-heat': `${count ? 20 + count / maximum * 70 : 0}%` },
          title: `${days[day]} ${hour}:00 · ${count}`, 'aria-label': `${days[day]} ${hour}:00 · ${count}`, 'aria-pressed': cell?.day === day && cell?.hour === hour,
          onClick: () => setCell({ day, hour }) })))))),
    React.createElement('div', { className: 'cb-footnote', role: 'status' }, cell ? `${days[cell.day]} ${cell.hour}:00–${cell.hour + 1}:00 · ${t('surface.calls', { count: analytics.heatmap[cell.day][cell.hour] })}` : t('analytics.heatmap')),
    data.cost ? React.createElement('div', { className: 'cb-usage-row' }, React.createElement('span', null, t('analytics.cost')),
      React.createElement('b', null, data.cost.amount === null ? t('surface.cost_unknown') : `${data.cost.currency} ${data.cost.amount.toFixed(6)}`)) : null,
    data.cost ? React.createElement('p', { className: 'cb-footnote' }, `${t('analytics.savings')}: ${data.cost.cacheSavings === null ? '—' : `${data.cost.currency} ${data.cost.cacheSavings.toFixed(6)}`} · ${data.cost.measuredRequests}/${data.cost.requests}`) : null)
}

function AccountHistory({ t }) {
  const request = useClientRequests()
  const [data, setData] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
  const load = async () => {
    setBusy(true); setError('')
    try { const res = await request(`${ROUTE_PREFIX}/accounts/history`); const result = await res.json(); if (!res.ok || !result.ok) throw new Error(result.error || `HTTP ${res.status}`); setData(result) }
    catch (failure) { setError(String(failure.message || failure)) }
    finally { setBusy(false) }
  }
  return React.createElement('details', { className: 'cb-block', onToggle: event => { if (event.currentTarget.open && !data && !busy) void load() } },
    React.createElement('summary', null, t('history.title')),
    React.createElement('p', { className: 'cb-footnote' }, t('history.hint')),
    React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm', disabled: busy, onClick: load }, t('durable.refresh')),
    error || data?.error ? React.createElement('p', { className: 'cb-alert-bad', role: 'alert' }, error || data.error) : null,
    data?.events.length === 0 ? React.createElement('p', { className: 'cb-footnote' }, t('history.empty')) : null,
    React.createElement('div', { className: 'cb-table-box' }, React.createElement('table', { className: 'cb-table' }, React.createElement('tbody', null,
      data?.events.map(event => React.createElement('tr', { key: event.id },
        React.createElement('td', { className: 'cb-nowrap' }, new Date(event.at).toLocaleString()),
        React.createElement('th', { scope: 'row' }, React.createElement('code', null, event.account)),
        React.createElement('td', null, t(`history.${event.type}`)),
        React.createElement('td', null, t(`history.reason_${event.reason}`)),
        React.createElement('td', null, event.until ? new Date(event.until).toLocaleTimeString() : '—')))))))
}
