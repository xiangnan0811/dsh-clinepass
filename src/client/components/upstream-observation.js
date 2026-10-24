function UpstreamObservation({ record, t }) {
  const state = record?.upstreamPinStatus || 'unrecorded'
  const target = typeof record?.upstreamPin === 'string' ? record.upstreamPin || t('pin.auto') : t('routing.unrecorded')
  const attached = record?.upstreamPinAttached === true ? t('routing.attached_yes')
    : record?.upstreamPinAttached === false ? t('routing.attached_no') : t('surface.unknown')
  return React.createElement('div', { className: 'cb-routing-facts' },
    [[t('routing.target'), target], [t('routing.actual'), record?.upstream || t('surface.unknown')],
      [t('routing.attached'), attached], [t('routing.result'), t(`routing.state_${state}`)]].map(([label, value]) =>
      React.createElement('div', { key: label }, React.createElement('span', null, label), React.createElement('b', null, value))))
}

function RoutingHistory({ records, t }) {
  return React.createElement('section', { className: 'cb-routing-history' },
    React.createElement('div', { className: 'cb-section-title' }, t('routing.history')),
    React.createElement('p', { className: 'cb-section-desc' }, t('routing.history_hint')),
    !records?.length ? React.createElement('p', { className: 'cb-section-desc' }, t('routing.empty')) :
      React.createElement('div', { className: 'cb-routing-list', tabIndex: 0, 'aria-label': t('routing.history') }, records.map((row) =>
        React.createElement('article', { className: 'cb-routing-row', key: row.id },
          React.createElement('div', { className: 'cb-row' }, React.createElement('strong', { className: 'cb-model-id' }, row.model),
            React.createElement('span', { className: 'cb-badge' }, t(row.ok ? 'routing.request_ok' : 'routing.request_failed'))),
          React.createElement('div', { className: 'cb-section-desc' }, new Date(row.completedAt).toLocaleString(), ' · ', row.account, row.purpose ? ` · ${row.purpose}` : ''),
          React.createElement(UpstreamObservation, { record: row, t }),
          row.attempts?.length > 1 ? React.createElement('details', null, React.createElement('summary', null, t('routing.attempts', { count: row.attempts.length })),
            row.attempts.map((attempt, index) => React.createElement('div', { key: index, className: 'cb-routing-attempt' },
              React.createElement('b', null, `${index + 1}. ${attempt.account}`), React.createElement(UpstreamObservation, { record: attempt, t })))) : null))))
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
