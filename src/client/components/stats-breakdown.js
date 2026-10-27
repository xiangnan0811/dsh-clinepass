const BREAKDOWN_PAGE = 8

// 日期按新到旧，模型和账户按 token 由多到少；账户视图并入实际调用账户的尝试次数。
function breakdownRows(data, group) {
  const grouped = (data.grouped[group] || []).map((row) => ({ value: row.value, totals: row.totals }))
  if (group === 'day') return grouped.sort((a, b) => b.value.localeCompare(a.value))
  const attempts = new Map(group === 'account' ? (data.attemptAccounts || []).map((row) => [row.value, row.totals]) : [])
  const known = new Set(grouped.map((row) => row.value))
  const rows = [
    ...grouped.map((row) => ({ ...row, attempts: attempts.get(row.value) })),
    ...[...attempts].filter(([value]) => !known.has(value)).map(([value, totals]) => ({ value, totals: null, attempts: totals })),
  ]
  const tokens = (row) => row.totals?.measurements.totalTokens.sum || 0
  return rows.sort((a, b) => tokens(b) - tokens(a) || a.value.localeCompare(b.value))
}

function StatsBreakdown({ data, t }) {
  const [group, setGroup] = React.useState('day')
  const [expanded, setExpanded] = React.useState(false)
  const rows = breakdownRows(data, group)
  const total = rows.reduce((sum, row) => sum + (row.totals?.measurements.totalTokens.sum || 0), 0)
  const costs = new Map((data.cost?.models || []).map((row) => [row.model, row]))
  const currency = data.cost?.currency || 'USD'
  const shown = expanded ? rows : rows.slice(0, BREAKDOWN_PAGE)
  const extra = group === 'model' ? t('cost.title') : group === 'account' ? t('breakdown.attempts') : null
  const tokenCell = (totals) => {
    if (!totals) return '—'
    const value = totals.measurements.totalTokens
    const partial = isPartial(value.samples, totals.requests)
    return React.createElement('span', { title: partial ? t('durable.coverage_title', { samples: value.samples, total: totals.requests }) : value.sum.toLocaleString() },
      formatCompact(value.sum), partial ? React.createElement('sup', { className: 'cb-partial' }, '*') : null)
  }
  const extraCell = (row) => {
    if (group === 'model') {
      const cost = costs.get(row.value)
      return cost?.rate ? formatMoney(cost.amount, currency) : '—'
    }
    const attempts = row.attempts
    return attempts ? `${attempts.requests.toLocaleString()} · ${attempts.failure.toLocaleString()} · ${attempts.rateLimits.toLocaleString()}` : '—'
  }
  return React.createElement('section', { className: 'cb-block' },
    React.createElement('div', { className: 'cb-subhead' },
      React.createElement('span', { className: 'cb-subtitle' }, t('breakdown.title')),
      React.createElement('div', { className: 'cb-tabs cb-tabs-sm', role: 'group', 'aria-label': t('durable.group') }, ['day', 'model', 'account'].map((value) =>
        React.createElement('button', { type: 'button', className: 'cb-tab', key: value, 'aria-pressed': group === value, onClick: () => { setGroup(value); setExpanded(false) } }, t(`durable.${value}`))))),
    React.createElement('div', { className: 'cb-table-box' }, React.createElement('table', { className: 'cb-table cb-breakdown' },
      React.createElement('thead', null, React.createElement('tr', null,
        React.createElement('th', null, t(`durable.${group}`)),
        React.createElement('th', { className: 'cb-num' }, t('durable.request_count')),
        React.createElement('th', { className: 'cb-num' }, t('durable.totalTokens')),
        extra ? React.createElement('th', { className: 'cb-num' }, extra) : null,
        React.createElement('th', { className: 'cb-share-col' }, t('breakdown.share')))),
      React.createElement('tbody', null, shown.map((row) => {
        const tokens = row.totals?.measurements.totalTokens.sum || 0
        return React.createElement('tr', { key: row.value },
          React.createElement('th', { scope: 'row', className: 'cb-nowrap' }, group === 'day' ? row.value : React.createElement('code', null, row.value)),
          React.createElement('td', { className: 'cb-num' }, row.totals ? row.totals.requests.toLocaleString() : '—'),
          React.createElement('td', { className: 'cb-num' }, tokenCell(row.totals)),
          extra ? React.createElement('td', { className: 'cb-num' }, extraCell(row)) : null,
          React.createElement('td', { className: 'cb-share-col' }, React.createElement('span', { className: 'cb-share' },
            React.createElement('span', { className: 'cb-share-track', 'aria-hidden': true }, React.createElement('span', { className: 'cb-share-fill', style: { width: total ? `${tokens / total * 100}%` : 0 } })),
            React.createElement('span', { className: 'cb-share-pct' }, formatPercent(tokens, total)))))
      })))),
    rows.length > BREAKDOWN_PAGE ? React.createElement('div', { className: 'cb-row' }, React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm cb-btn-ghost', 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) },
      expanded ? t('breakdown.collapse') : t('breakdown.show_all', { count: rows.length }))) : null,
    group === 'account' ? React.createElement('p', { className: 'cb-footnote' }, t('durable.attempt_accounts')) : null)
}
