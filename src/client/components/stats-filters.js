const STATS_RANGES = ['all', '1', '7', '30', '90', 'custom']

// datetime-local 需要本地时间字符串；时间窗按分钟向上取整，与服务端的分钟对齐校验一致。
function localInputValue(stamp) {
  const date = new Date(stamp)
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
}

function presetWindow(days) {
  const until = Math.ceil(Date.now() / 60000) * 60000
  return { since: new Date(until - days * 86400000).toISOString(), until: new Date(until).toISOString() }
}

function rangeLabel(range, t) {
  if (range === 'all') return t('stats.range_all')
  if (range === 'custom') return t('stats.range_custom')
  return range === '1' ? t('stats.range_24h') : t('stats.range_days', { days: range })
}

function StatsFilters({ range, timeWindow, filters, choices, detailedOnly, disabled, onRange, onWindow, onFilters, t }) {
  const [draft, setDraft] = React.useState({ since: '', until: '' })
  const [invalid, setInvalid] = React.useState(false)
  const chooseRange = (value) => {
    setInvalid(false)
    if (value === 'custom') {
      const base = timeWindow.since ? timeWindow : presetWindow(7)
      setDraft({ since: localInputValue(base.since), until: localInputValue(base.until) })
    }
    onRange(value)
  }
  const applyCustom = () => {
    const since = new Date(draft.since), until = new Date(draft.until)
    if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || until <= since) { setInvalid(true); return }
    setInvalid(false)
    onWindow({ since: since.toISOString(), until: until.toISOString() })
  }
  const select = (key) => React.createElement('select', { className: 'cb-input cb-input-sm', 'aria-label': t(`durable.${key}`), value: filters[key], disabled, onChange: (event) => onFilters({ ...filters, [key]: event.target.value }) },
    React.createElement('option', { value: '' }, t(`stats.all_${key}s`)), choices(key).map(([value, name]) => React.createElement('option', { key: value, value }, name)))
  return React.createElement('div', { className: 'cb-filterbar' },
    React.createElement('div', { className: 'cb-filterbar-row' },
      React.createElement('div', { className: 'cb-tabs cb-tabs-sm', role: 'group', 'aria-label': t('stats.range') }, STATS_RANGES.map((value) =>
        React.createElement('button', { type: 'button', className: 'cb-tab', key: value, disabled, 'aria-pressed': range === value, onClick: () => chooseRange(value) }, rangeLabel(value, t)))),
      React.createElement('div', { className: 'cb-filterbar-selects' }, select('model'), select('account'),
        React.createElement('button', { type: 'button', className: 'cb-chip cb-chip-toggle', disabled, title: t('stats.errors_hint'), 'aria-pressed': filters.errorsOnly === '1', onClick: () => onFilters({ ...filters, errorsOnly: filters.errorsOnly === '1' ? '' : '1' }) }, t('stats.errors_only')))),
    range === 'custom' ? React.createElement('div', { className: 'cb-filterbar-row cb-filterbar-custom' },
      ['since', 'until'].map((key) => React.createElement('label', { className: 'cb-field', key }, t(`analytics.${key}`),
        React.createElement('input', { type: 'datetime-local', className: 'cb-input cb-input-sm', step: 60, value: draft[key], disabled, onChange: (event) => setDraft({ ...draft, [key]: event.target.value }) }))),
      React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm cb-btn-primary', disabled: disabled || !draft.since || !draft.until, onClick: applyCustom }, t('stats.apply')),
      invalid ? React.createElement('span', { className: 'cb-field-error', role: 'alert' }, t('analytics.invalid_range')) : null) : null,
    timeWindow.since || detailedOnly ? React.createElement('p', { className: 'cb-footnote cb-filterbar-scope' },
      timeWindow.since && timeWindow.until ? `${formatShortTime(timeWindow.since)} → ${formatShortTime(timeWindow.until)}` : null,
      detailedOnly ? React.createElement('span', { className: 'cb-hint', title: t('analytics.detailed_only') }, t('stats.errors_hint')) : null) : null)
}
