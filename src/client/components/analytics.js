function ActivityHeatmap({ analytics, t }) {
  const [cell, setCell] = React.useState(null)
  if (!analytics?.detailedRequests) return null
  const maximum = Math.max(1, ...analytics.heatmap.flat())
  const days = t('analytics.weekdays').split(',')
  const label = (day, hour) => `${days[day]} ${hour}:00–${hour + 1}:00 · ${t('surface.calls', { count: analytics.heatmap[day][hour].toLocaleString() })}`
  return React.createElement('section', { className: 'cb-panel' },
    React.createElement('div', { className: 'cb-subhead' },
      React.createElement('span', { className: 'cb-subtitle' }, t('activity.title')),
      React.createElement('span', { className: 'cb-footnote', role: 'status' }, cell ? label(cell.day, cell.hour) : t('activity.detail', { count: analytics.detailedRequests.toLocaleString() }))),
    React.createElement('div', { className: 'cb-heatmap-scroll' }, React.createElement('div', { className: 'cb-heatmap', role: 'group', 'aria-label': t('analytics.heatmap') },
      React.createElement('span'), Array.from({ length: 24 }, (_, hour) => React.createElement('span', { key: `h${hour}`, className: 'cb-heatmap-hour' }, hour % 3 === 0 ? hour : '')),
      analytics.heatmap.map((hours, day) => React.createElement(React.Fragment, { key: day }, React.createElement('span', { className: 'cb-heatmap-day' }, days[day]),
        hours.map((count, hour) => React.createElement('button', { type: 'button', key: hour, className: 'cb-heatmap-cell',
          style: { '--cb-heat': `${count ? 18 + count / maximum * 82 : 0}%` },
          title: label(day, hour), 'aria-label': label(day, hour), 'aria-pressed': cell?.day === day && cell?.hour === hour,
          onClick: () => setCell(cell?.day === day && cell?.hour === hour ? null : { day, hour }) })))))),
    React.createElement('div', { className: 'cb-heat-legend', 'aria-hidden': true }, t('activity.less'),
      [0, 25, 50, 75, 100].map((heat) => React.createElement('i', { key: heat, className: 'cb-heatmap-cell', style: { '--cb-heat': `${heat ? 18 + heat * 0.82 : 0}%` } })), t('activity.more')))
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
        React.createElement('th', { scope: 'row' }, React.createElement('code', null, event.account), event.model ? React.createElement('div', { className: 'cb-model-id' }, event.model) : null),
        React.createElement('td', null, t(`history.${event.type}`)),
        React.createElement('td', null, t(`history.reason_${event.reason}`)),
        React.createElement('td', null, event.until ? new Date(event.until).toLocaleTimeString() : '—')))))))
}
