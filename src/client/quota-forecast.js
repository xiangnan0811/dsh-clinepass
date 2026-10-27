function createQuotaPaceTracker() {
  let identity = '', previous = null
  const project = (sample, now) => Object.fromEntries(Object.entries(sample.result).filter(([key]) => Date.parse(sample.windows[key]?.resetsAt) > now)
    .map(([key, value]) => [key, { ...value, remainingMs: value.remainingMs === null ? null : Math.max(0, value.remainingMs - (now - sample.at)) }]))
  return {
    sample(nextIdentity, usage, now = Date.now()) {
      if (identity !== nextIdentity || !usage?.ok) { identity = nextIdentity; previous = null }
      if (!usage?.ok) return {}
      const at = typeof usage.checkedAt === 'number' ? usage.checkedAt : Date.parse(usage.checkedAt)
      if (!Number.isFinite(at) || Math.abs(now - at) > 15 * 60000) { previous = null; return {} }
      if (previous && at <= previous.at) return project(previous, now)
      const comparable = previous && ['fiveHour', 'weekly', 'monthly'].every(key => {
        const current = usage.windows?.[key], prior = previous.windows?.[key]
        return !current && !prior || current?.resetsAt === prior?.resetsAt && Number.isFinite(current?.percentUsed) && Number.isFinite(prior?.percentUsed) && current.percentUsed >= prior.percentUsed
      })
      // Frequent refreshes must not keep moving the observation baseline.
      if (comparable && at - previous.at < 60000) return project(previous, now)
      const result = {}
      for (const key of ['fiveHour', 'weekly', 'monthly']) {
        const current = usage.windows?.[key], prior = previous?.windows?.[key]
        const elapsed = previous ? at - previous.at : 0
        const reset = Date.parse(current?.resetsAt)
        if (!prior || elapsed < 60000 || elapsed > 15 * 60000 || current?.resetsAt !== prior.resetsAt || !Number.isFinite(reset) || reset <= now) continue
        const used = current.percentUsed, before = prior.percentUsed
        if (!Number.isFinite(used) || !Number.isFinite(before) || used < before || used < 0 || used >= 100) continue
        const pace = (used - before) / elapsed
        const remainingMs = pace ? (100 - used) / pace : Infinity
        result[key] = { holds: remainingMs >= reset - at, remainingMs: Number.isFinite(remainingMs) ? remainingMs : null }
      }
      previous = { at, windows: structuredClone(usage.windows || {}), result }
      return project(previous, now)
    },
  }
}

function QuotaForecast({ usage, identity, enabled, t }) {
  const tracker = React.useRef(null)
  const [sample, setSample] = React.useState(null)
  React.useEffect(() => {
    if (!enabled) { tracker.current = null; setSample(null); return }
    tracker.current ||= createQuotaPaceTracker()
    const update = () => setSample({ identity, usage, forecast: tracker.current.sample(identity, usage) })
    update()
    const timer = setInterval(update, 60000)
    return () => clearInterval(timer)
  }, [enabled, identity, usage])
  if (!enabled || !usage?.ok) return null
  const rows = Object.entries(sample?.identity === identity && sample?.usage === usage ? sample.forecast : {})
  return React.createElement('div', { className: 'cb-footnote', title: t('forecast.hint') }, rows.length ? rows.map(([key, value]) => React.createElement('div', { key }, `${t(`surface.${key}`)} · `,
    value.holds ? t('forecast.holds') : t('forecast.left', { time: `${Math.max(1, Math.round(value.remainingMs / 60000))} min` }))) : t('forecast.wait'))
}
