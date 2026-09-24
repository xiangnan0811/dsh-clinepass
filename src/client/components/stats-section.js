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
        [t('stats.last_req'), status.sessionStats?.lastRequestAt ? formatResetTime(status.sessionStats.lastRequestAt) : '—'],
      ].map(([label, value]) => React.createElement('tr', { key: label },
        React.createElement('th', { scope: 'row' }, label),
        React.createElement('td', { className: 'cb-num' }, value),
      )))
    )
  )
}
