function QuotaSection({ keyPresent, status, usage, busy, handleRefreshQuota, t }) {
  const checkedAt = formatResetTime(usage?.checkedAt)
  return React.createElement(
    React.Fragment,
    null,
    status.quotaWarning
      ? React.createElement(
          'div',
          { className: status.quotaWarning.level === 'exhausted' ? 'cb-banner-exhausted' : 'cb-banner-warning' },
          React.createElement('span', { style: { fontSize: '16px' } }, status.quotaWarning.level === 'exhausted' ? '🚨' : '⚠️'),
          React.createElement(
            'div',
            { style: { flex: 1 } },
            React.createElement('div', null, status.quotaWarning.message),
            status.quotaWarning.resetsAt
              ? React.createElement(
                  'div',
                  { style: { fontSize: '11px', opacity: 0.9, marginTop: '2px' } },
                  t('quota.reset_at', { time: formatResetTime(status.quotaWarning.resetsAt) })
                )
              : null
          )
        )
      : null,
    keyPresent
      ? React.createElement(
          'div',
          { className: 'cb-section-card' },
          React.createElement(
            'div',
            { className: 'cb-section-title' },
            t('quota.title'),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'cb-btn',
                disabled: !!busy,
                onClick: handleRefreshQuota,
              },
              busy === 'refresh-quota' ? t('quota.refreshing') : t('quota.refresh')
            )
          ),
          React.createElement(
            'table',
            { className: 'cb-table cb-facts cb-quota-meta' },
            React.createElement('tbody', null,
              [
                [t('quota.col_account'), usage?.user?.email || '—'],
                [t('quota.col_plan'), usage?.plan || '—'],
                [t('quota.col_checked'), checkedAt || '—'],
              ].map(([label, value]) => React.createElement('tr', { key: label },
                React.createElement('th', { scope: 'row' }, label),
                React.createElement('td', null, value),
              )),
            ),
          ),
          React.createElement(
            'table',
            { className: 'cb-table cb-quota' },
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                React.createElement('th', null, t('quota.col_limit')),
                React.createElement('th', null, t('quota.col_used')),
                React.createElement('th', null, t('quota.col_meter')),
                React.createElement('th', null, t('quota.col_reset')),
              ),
            ),
            React.createElement(
              'tbody',
              null,
            React.createElement(ProgressBar, {
              label: t('quota.window_5h'),
              known: typeof usage?.windows?.fiveHour?.percentUsed === 'number',
              percentUsed: usage?.windows?.fiveHour?.percentUsed,
              remainingPercent: usage?.windows?.fiveHour?.remainingPercent,
              resetsAt: usage?.windows?.fiveHour?.resetsAt,
              t,
            }),
            React.createElement(ProgressBar, {
              label: t('quota.window_weekly'),
              known: typeof usage?.windows?.weekly?.percentUsed === 'number',
              percentUsed: usage?.windows?.weekly?.percentUsed,
              remainingPercent: usage?.windows?.weekly?.remainingPercent,
              resetsAt: usage?.windows?.weekly?.resetsAt,
              t,
            }),
            React.createElement(ProgressBar, {
              label: t('quota.window_monthly'),
              known: typeof usage?.windows?.monthly?.percentUsed === 'number',
              percentUsed: usage?.windows?.monthly?.percentUsed,
              remainingPercent: usage?.windows?.monthly?.remainingPercent,
              resetsAt: usage?.windows?.monthly?.resetsAt,
              t,
            }),
            ),
          )
        )
      : null
  )
}
