function earliestReset(windows) {
  const stamps = [windows?.fiveHour?.resetsAt, windows?.weekly?.resetsAt, windows?.monthly?.resetsAt]
    .filter((value) => value && !Number.isNaN(new Date(value).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  return stamps[0] || ''
}

function windowPercent(window) {
  return typeof window?.percentUsed === 'number' ? `${Math.round(window.percentUsed)}%` : '—'
}

// Same thresholds as the window cards.
function windowTone(window) {
  const pct = window?.percentUsed
  return typeof pct !== 'number' ? 'cb-num' : pct >= 95 ? 'cb-num cb-quota-pct-bad' : pct >= 80 ? 'cb-num cb-quota-pct-warn' : 'cb-num'
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
  return React.createElement(
    React.Fragment,
    null,
    usage?.ok === false ? React.createElement('div', { className: 'cb-alert-bad', role: 'alert' }, usage.error || t('surface.quota_error')) : null,
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
                className: 'cb-btn cb-btn-sm',
                disabled: !!busy,
                onClick: handleRefreshQuota,
              },
              busy === 'refresh-quota' ? t('quota.refreshing') : t('quota.refresh')
            )
          ),
          React.createElement(
            'div',
            { className: 'cb-quota-summary' },
            React.createElement('b', null, React.createElement('span', { className: 'cb-sr-only' }, `${t('quota.col_account')}: `), emailText(activeMasked, activeFull, showEmail)),
            emailToggle
              ? React.createElement('button', {
                  type: 'button',
                  className: 'cb-link-btn',
                  'aria-pressed': showEmail ? 'true' : 'false',
                  onClick: () => setShowEmail((current) => !current),
                }, showEmail ? t('quota.email_hide') : t('quota.email_show'))
              : null,
            usage?.plan ? React.createElement('span', { className: 'cb-dot-sep', 'aria-hidden': true }) : null,
            usage?.plan ? React.createElement('span', null, React.createElement('span', { className: 'cb-sr-only' }, `${t('quota.col_plan')}: `), usage.plan) : null,
            usage?.canceledAt ? React.createElement('span', { className: 'cb-badge cb-badge-warn' }, `${t('quota.canceled')} ${formatResetTime(usage.canceledAt) || usage.canceledAt}`) : null,
            usage?.cancelAtPeriodEnd ? React.createElement('span', { className: 'cb-badge cb-badge-warn' }, t('quota.cancel_period_yes')) : null,
            React.createElement('span', { className: 'cb-footnote cb-push' }, t('quota.updated', { time: checkedAt || '—' })),
          ),
          React.createElement('div', { className: 'cb-quota-windows' },
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
          others.length
            ? React.createElement(
                'div',
                { className: 'cb-quota-scroll' },
                React.createElement('div', { className: 'cb-subtitle' }, t('quota.other_accounts')),
                React.createElement('div', { className: 'cb-table-box' }, React.createElement(
                  'table',
                  { className: 'cb-table cb-quota-others' },
                  React.createElement('thead', null, React.createElement('tr', null,
                    React.createElement('th', null, t('quota.col_account')),
                    React.createElement('th', { className: 'cb-num' }, t('quota.window_5h')),
                    React.createElement('th', { className: 'cb-num' }, t('quota.window_weekly')),
                    React.createElement('th', { className: 'cb-num' }, t('quota.window_monthly')),
                    React.createElement('th', null, t('quota.col_reset')),
                  )),
                  React.createElement('tbody', null, others.map((row) => {
                    const cells = row.ok
                      ? [
                          React.createElement('td', { key: '5h', className: windowTone(row.windows?.fiveHour) }, windowPercent(row.windows?.fiveHour)),
                          React.createElement('td', { key: 'week', className: windowTone(row.windows?.weekly) }, windowPercent(row.windows?.weekly)),
                          React.createElement('td', { key: 'month', className: windowTone(row.windows?.monthly) }, windowPercent(row.windows?.monthly)),
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
                )),
              )
            : null,
        )
      : null
  )
}
