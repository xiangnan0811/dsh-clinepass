function UpstreamObservation({ record, t }) {
  const state = record?.upstreamPinStatus || 'unrecorded'
  const target = typeof record?.upstreamPin === 'string' ? record.upstreamPin || t('pin.auto') : t('routing.unrecorded')
  const attached = record?.upstreamPinAttached === true ? t('routing.attached_yes')
    : record?.upstreamPinAttached === false ? t('routing.attached_no') : t('surface.unknown')
  const evidence = Object.entries(record?.routingEvidence || {}).filter(([key, value]) =>
    ['responseId', 'responseModel', 'canonicalModel', 'resolvedProvider', 'deepseekFingerprint'].includes(key) && typeof value === 'string')
  return React.createElement(React.Fragment, null, React.createElement('div', { className: 'cb-routing-facts' },
    [[t('routing.target'), target], [t('routing.actual'), record?.upstream || t('surface.unknown')],
      [t('routing.attached'), attached], [t('routing.result'), t(`routing.state_${state}`)]].map(([label, value]) =>
      React.createElement('div', { key: label }, React.createElement('span', null, label), React.createElement('b', null, value)))),
    evidence.length ? React.createElement('details', { className: 'cb-routing-evidence' },
      React.createElement('summary', null, t('routing.evidence')),
      React.createElement('p', { className: 'cb-section-desc' }, t('routing.evidence_hint')),
      React.createElement('div', { className: 'cb-routing-facts' }, evidence.map(([key, value]) =>
        React.createElement('div', { key }, React.createElement('span', null, t(`routing.${key}`)), React.createElement('b', null, value))))) : null)
}

const ROUTING_PAGE = 20
const ROUTING_TONE = { matched: 'cb-badge-ok', mismatch: 'cb-badge-bad', unverified: 'cb-badge-warn', 'not-attached': 'cb-badge-warn' }

function routingTime(stamp) {
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function RoutingRecord({ row, t }) {
  const state = row.upstreamPinStatus || 'unrecorded'
  const failure = row.ok ? '' : row.attempts?.at(-1)?.code || ''
  return React.createElement('details', { className: 'cb-routing-row' },
    React.createElement('summary', null,
      React.createElement('span', { className: row.ok ? 'cb-routing-dot' : 'cb-routing-dot cb-routing-dot-bad', role: 'img', 'aria-label': t(row.ok ? 'routing.request_ok' : 'routing.request_failed') }),
      React.createElement('span', { className: 'cb-routing-model', title: row.model }, row.model),
      React.createElement('span', { className: 'cb-routing-meta' },
        React.createElement('span', { className: 'cb-routing-time' }, routingTime(row.completedAt)),
        React.createElement('span', { className: 'cb-routing-account', title: row.account }, row.account)),
      React.createElement('span', { className: 'cb-routing-result' },
        row.upstream ? React.createElement('span', { className: 'cb-routing-upstream', title: row.upstream }, row.upstream) : null,
        React.createElement('span', { className: `cb-badge ${ROUTING_TONE[state] || ''}` }, t(`routing.state_${state}`)))),
    React.createElement('div', { className: 'cb-routing-body' },
      React.createElement('div', { className: 'cb-row' },
        React.createElement('span', { className: row.ok ? 'cb-badge cb-badge-ok' : 'cb-badge cb-badge-bad' }, t(row.ok ? 'routing.request_ok' : 'routing.request_failed')),
        failure ? React.createElement('code', null, failure) : null,
        React.createElement('span', { className: 'cb-footnote' }, [new Date(row.completedAt).toLocaleString(), Number.isFinite(row.latencyMs) ? `${row.latencyMs.toLocaleString()} ms` : '', row.purpose || ''].filter(Boolean).join(' · '))),
      React.createElement(UpstreamObservation, { record: row, t }),
      row.attempts?.length > 1 ? React.createElement('details', null, React.createElement('summary', null, t('routing.attempts', { count: row.attempts.length })),
        row.attempts.map((attempt, index) => React.createElement('div', { key: index, className: 'cb-routing-attempt' },
          React.createElement('b', null, `${index + 1}. ${attempt.account}`), React.createElement(UpstreamObservation, { record: attempt, t })))) : null))
}

function RoutingHistory({ records, t }) {
  const [limit, setLimit] = React.useState(ROUTING_PAGE)
  const rows = records || []
  return React.createElement('section', { className: 'cb-routing-history' },
    React.createElement('div', { className: 'cb-subtitle' }, t('routing.history')),
    React.createElement('p', { className: 'cb-footnote' }, t('routing.history_hint')),
    !rows.length ? React.createElement('p', { className: 'cb-section-desc' }, t('routing.empty')) :
      React.createElement('div', { className: 'cb-routing-list', 'aria-label': t('routing.history') }, rows.slice(0, limit).map((row) =>
        React.createElement(RoutingRecord, { row, t, key: row.id }))),
    rows.length > limit ? React.createElement('div', { className: 'cb-row' }, React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm', onClick: () => setLimit(limit + ROUTING_PAGE) }, t('routing.more', { count: rows.length - limit }))) : null)
}

// Session identity gates rendering as well as fetch completion. Never show a
// previous session's provider or fill missing evidence from current settings.
function useRecentRouting(sessionId, projection, refreshKey) {
  const request = useClientRequests()
  const [state, setState] = React.useState({ sessionId: '', records: [], loading: true, error: '' })
  React.useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await request(`${ROUTE_PREFIX}/stats`, { cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`)
        if (!controller.signal.aborted) setState({ sessionId, records: (data.recent || []).filter((row) => row.sessionId === sessionId), loading: false, error: data.error || '' })
      } catch (error) {
        if (!controller.signal.aborted) setState({ sessionId, records: [], loading: false, error: String(error.message || error) })
      }
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [sessionId, projection, refreshKey, request])
  return state.sessionId === sessionId ? state : { records: [], loading: !!sessionId, error: '' }
}
