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

function resetCountdown(resetsAt, now) {
  const stamp = resetsAt ? new Date(resetsAt).getTime() : NaN
  if (!Number.isFinite(stamp)) return { kind: 'unknown' }
  if (stamp <= now) return { kind: 'resetting' }
  const seconds = Math.ceil((stamp - now) / 1000)
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60)
  return { kind: 'future', time: days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s` }
}

function ResetCountdown({ resetsAt, t }) {
  const [now, setNow] = React.useState(Date.now)
  const stamp = resetsAt ? new Date(resetsAt).getTime() : NaN
  React.useEffect(() => {
    setNow(Date.now())
    if (!Number.isFinite(stamp) || stamp <= Date.now()) return
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= stamp) clearInterval(timer) }, 1000)
    return () => clearInterval(timer)
  }, [stamp])
  const state = resetCountdown(resetsAt, now)
  return React.createElement('span', { className: 'cb-reset-countdown' }, state.kind === 'future' ? t('surface.reset_in', { time: state.time }) : t(`surface.reset_${state.kind}`))
}

function ProgressBar({ label, known = true, percentUsed, resetsAt, t }) {
  const pct = known && typeof percentUsed === 'number' && Number.isFinite(percentUsed) ? Math.max(0, Math.min(100, Math.round(percentUsed))) : null
  const tone = pct == null ? '' : pct >= 95 ? 'bad' : pct >= 80 ? 'warn' : 'ok'
  const resetLabel = formatResetTime(resetsAt)
  return React.createElement(
    'div',
    { className: 'cb-quota-window', role: 'group', 'aria-label': label },
    React.createElement(
      'div', { className: 'cb-quota-window-title' }, React.createElement('span', null, label),
      React.createElement('strong', { className: pct == null ? 'cb-quota-pct' : `cb-quota-pct cb-quota-pct-${tone}` }, pct == null ? t('surface.unknown') : `${pct}%`),
    ),
    React.createElement(
        'div',
        { className: 'cb-bar-track', role: pct == null ? 'img' : 'meter', 'aria-valuemin': pct == null ? undefined : 0, 'aria-valuemax': pct == null ? undefined : 100, 'aria-valuenow': pct == null ? undefined : pct, 'aria-label': pct == null ? `${label} · ${t('surface.unknown')}` : label },
        React.createElement('div', {
          className: pct == null ? 'cb-bar-fill' : `cb-bar-fill cb-bar-fill-${tone}`,
          style: { width: pct == null ? '0%' : `${pct}%`, minWidth: pct > 0 ? '6px' : 0 },
        }),
    ),
    React.createElement('div', { className: 'cb-quota-window-reset' }, resetLabel || '—', React.createElement(ResetCountdown, { resetsAt, t })),
  )
}
