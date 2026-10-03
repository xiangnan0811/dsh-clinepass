function lastRequestLine(status) {
  const recent = Array.isArray(status?.recentRequests) ? status.recentRequests : []
  const last = recent.length ? recent[recent.length - 1] : null
  const time = formatResetTime(last?.at || status?.sessionStats?.lastRequestAt)
  if (!time) return '—'
  const parts = [time]
  if (last?.model) parts.push(last.model)
  if (last?.upstream) parts.push(last.upstream)
  if (last && last.ok === false && last.reason) parts.push(last.reason)
  return parts.join(' · ')
}

function StatsSection({ status, t }) {
  return React.createElement(
    'div',
    { className: 'cb-section-card' },
    React.createElement('div', { className: 'cb-section-title' }, t('stats.title')),
    React.createElement('div', { className: 'cb-section-desc' }, t('stats.desc')),
    React.createElement(
      'table',
      { className: 'cb-table cb-facts' },
      React.createElement('thead', null, React.createElement('tr', null,
        React.createElement('th', null, t('stats.col_metric')),
        React.createElement('th', null, t('stats.col_value')),
      )),
      React.createElement('tbody', null, [
        [t('stats.requests'), `${status.sessionStats?.successfulRequests || 0} / ${status.sessionStats?.totalRequests || 0}`],
        [t('stats.tokens'), String(status.sessionStats?.totalTokensEst || 0)],
        [t('stats.latency'), status.sessionStats?.lastLatencyMs ? `${status.sessionStats.lastLatencyMs} ms` : '—'],
        [t('stats.last_req'), lastRequestLine(status)],
      ].map(([label, value]) => React.createElement('tr', { key: label },
        React.createElement('th', { scope: 'row' }, label),
        React.createElement('td', { className: 'cb-num' }, value),
      )))
    )
  )
}
