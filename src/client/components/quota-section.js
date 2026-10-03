function earliestReset(windows) {
  const stamps = [windows?.fiveHour?.resetsAt, windows?.weekly?.resetsAt, windows?.monthly?.resetsAt]
    .filter((value) => value && !Number.isNaN(new Date(value).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  return stamps[0] || ''
}

function windowPercent(window) {
  return typeof window?.percentUsed === 'number' ? `${Math.round(window.percentUsed)}%` : '—'
}

function emailText(masked, full, shown) {
  if (shown && full) return full
  return masked || '—'
}

function canReveal(masked, full) {
  return Boolean(full) && Boolean(masked) && full !== masked
}

function QuotaSection({ keyPresent, status, usage, accountUsage, busy, handleRefreshQuota, t }) {
  const [showEmail, setShowEmail] = React.useState(false)
  const checkedAt = formatResetTime(usage?.checkedAt)
  const activeEnv = status?.key?.envName || ''
  const others = (Array.isArray(accountUsage) ? accountUsage : []).filter((row) => row?.apiKeyEnv && row.apiKeyEnv !== activeEnv)
  const activeMasked = usage?.user?.email || ''
  const activeFull = usage?.user?.emailFull || ''
  const emailToggle = canReveal(activeMasked, activeFull) || others.some((row) => canReveal(row.email, row.emailFull))
  const metaRows = [
    [t('quota.col_plan'), usage?.plan || '—'],
    usage?.canceledAt ? [t('quota.canceled'), formatResetTime(usage.canceledAt) || usage.canceledAt] : null,
    usage?.cancelAtPeriodEnd ? [t('quota.cancel_period'), t('quota.cancel_period_yes')] : null,
    [t('quota.col_checked'), checkedAt || '—'],
  ].filter(Boolean)
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
              React.createElement('tr', { key: 'account' },
                React.createElement('th', { scope: 'row' }, t('quota.col_account')),
                React.createElement('td', null,
                  React.createElement('span', { className: 'cb-email-line' },
                    React.createElement('span', null, emailText(activeMasked, activeFull, showEmail)),
                    emailToggle
                      ? React.createElement('button', {
                          type: 'button',
                          className: 'cb-btn cb-email-toggle',
                          'aria-pressed': showEmail ? 'true' : 'false',
                          onClick: () => setShowEmail((current) => !current),
                        }, showEmail ? t('quota.email_hide') : t('quota.email_show'))
                      : null,
                  ),
                ),
              ),
              metaRows.map(([label, value]) => React.createElement('tr', { key: label },
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
          ),
          others.length
            ? React.createElement(
                'div',
                { className: 'cb-quota-scroll' },
                React.createElement('div', { className: 'cb-section-desc' }, t('quota.other_accounts')),
                React.createElement(
                  'table',
                  { className: 'cb-table cb-quota-others' },
                  React.createElement('thead', null, React.createElement('tr', null,
                    React.createElement('th', null, t('quota.col_account')),
                    React.createElement('th', null, t('quota.window_5h')),
                    React.createElement('th', null, t('quota.window_weekly')),
                    React.createElement('th', null, t('quota.window_monthly')),
                    React.createElement('th', null, t('quota.col_reset')),
                  )),
                  React.createElement('tbody', null, others.map((row) => {
                    const cells = row.ok
                      ? [
                          React.createElement('td', { key: '5h' }, windowPercent(row.windows?.fiveHour)),
                          React.createElement('td', { key: 'week' }, windowPercent(row.windows?.weekly)),
                          React.createElement('td', { key: 'month' }, windowPercent(row.windows?.monthly)),
                          React.createElement('td', { key: 'reset' }, formatResetTime(earliestReset(row.windows)) || '—'),
                        ]
                      : [React.createElement('td', { key: 'error', colSpan: 4 }, row.error || t('quota.account_failed'))]
                    const address = emailText(row.email, row.emailFull, showEmail)
                    const accountLabel = row.email || (showEmail && row.emailFull)
                      ? `${row.label || row.apiKeyEnv} · ${address}`
                      : (row.label || row.apiKeyEnv)
                    return React.createElement('tr', { key: row.apiKeyEnv },
                      React.createElement('th', { scope: 'row' }, accountLabel),
                      ...cells,
                    )
                  })),
                ),
              )
            : null,
        )
      : null
  )
}
