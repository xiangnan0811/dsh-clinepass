function formatResetTime(isoString) {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}

function ProgressBar({ label, known = true, percentUsed, resetsAt, t }) {
  const pct = known ? Math.max(0, Math.min(100, Math.round(Number(percentUsed)))) : null
  const tone = pct == null ? '' : pct >= 95 ? 'bad' : pct >= 80 ? 'warn' : 'ok'
  const resetLabel = formatResetTime(resetsAt)
  return React.createElement(
    'tr',
    null,
    React.createElement('th', { scope: 'row' }, label),
    React.createElement(
      'td',
      { className: pct == null ? 'cb-quota-pct' : `cb-quota-pct cb-quota-pct-${tone}` },
      pct == null ? t('quota.unknown') : `${pct}%`,
    ),
    React.createElement(
      'td',
      null,
      React.createElement(
        'div',
        { className: 'cb-bar-track', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct == null ? undefined : pct, 'aria-label': label },
        React.createElement('div', {
          className: pct == null ? 'cb-bar-fill' : `cb-bar-fill cb-bar-fill-${tone}`,
          style: { width: pct == null ? '0%' : `${pct}%`, minWidth: pct > 0 ? '6px' : 0 },
        }),
      ),
    ),
    React.createElement('td', { className: 'cb-quota-reset' }, resetLabel || '—'),
  )
}
