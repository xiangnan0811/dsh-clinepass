const { Modal: NativeModal } = require('@deepseek-ai/dsh-client-ui-primitives')

function useClinePreferences(scope) {
  const subscribe = React.useCallback((listener) => scope?.subscribe?.(listener) || (() => {}), [scope])
  const snapshot = React.useCallback(() => scope?.getSnapshot?.() || SNAPSHOT_LOADING, [scope])
  return React.useSyncExternalStore(subscribe, snapshot, () => SNAPSHOT_LOADING).value || {}
}

function createQuotaResource(scope) {
  let state = { data: null, loading: false, error: '' }, timer, controller, epoch = 0, stopped = false
  const listeners = new Set()
  const publish = (next) => { state = next; for (const listener of listeners) listener() }
  const identity = (value) => JSON.stringify([value?.baseUrl, value?.apiKeyEnv, value?.activeAccount])
  let currentIdentity = identity(scope?.getSnapshot?.().value)
  const cancel = () => { epoch++; clearTimeout(timer); controller?.abort(); controller = undefined }
  const refresh = async () => {
    if (stopped || !listeners.size || document.visibilityState === 'hidden') return
    cancel()
    const generation = epoch
    controller = new AbortController()
    publish({ ...state, loading: true, error: '' })
    try {
      const res = await fetchJson(`${ROUTE_PREFIX}/usage`, { cache: 'no-store', signal: controller.signal })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (generation === epoch) publish({ data, loading: false, error: '' })
    } catch (error) {
      if (generation === epoch) publish({ data: null, loading: false, error: String(error.message || error) })
    } finally { if (!stopped && listeners.size && generation === epoch) timer = setTimeout(refresh, 60000) }
  }
  const visibility = () => { if (document.visibilityState === 'hidden') cancel(); else void refresh() }
  const offScope = scope?.subscribe?.(() => {
    const next = identity(scope.getSnapshot().value)
    if (next === currentIdentity) return
    currentIdentity = next; cancel(); publish({ data: null, loading: false, error: '' }); void refresh()
  })
  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) { document.addEventListener('visibilitychange', visibility); void refresh() }
      return () => { listeners.delete(listener); if (!listeners.size) { cancel(); document.removeEventListener('visibilitychange', visibility) } }
    },
    refresh,
    acceptStatus(status) {
      if (stopped || identity(status.config) !== currentIdentity) return
      cancel()
      const data = status.usage
      publish({ data: data?.ok ? data : null, loading: false, error: data && !data.ok ? data.error : '' })
      if (listeners.size) timer = setTimeout(refresh, 60000)
    },
    dispose() { stopped = true; cancel(); offScope?.(); listeners.clear(); document.removeEventListener('visibilitychange', visibility) },
  }
}

function useQuota(resource, enabled) {
  const subscribe = React.useCallback((listener) => enabled ? resource.subscribe(listener) : () => {}, [resource, enabled])
  return React.useSyncExternalStore(subscribe, resource.snapshot, resource.snapshot)
}

function quotaPercent(window) {
  return typeof window?.percentUsed === 'number' && Number.isFinite(window.percentUsed) ? Math.max(0, Math.min(100, window.percentUsed)) : null
}

function SidebarQuota(props) {
  const { scope, quota, wide, openDetails } = props
  const t = props.t || makeT(en, en)
  const prefs = useClinePreferences(scope)
  const enabled = prefs.showSidebarQuota !== false && prefs.enabled !== false
  const snapshot = useQuota(quota, enabled)
  if (!enabled) return null
  const keys = ['fiveHour', 'weekly', 'monthly']
  const values = keys.map((key) => quotaPercent(snapshot.data?.windows?.[key]))
  const measured = values.filter((value) => value !== null)
  const percent = measured.length ? Math.max(...measured) : null
  const text = snapshot.error ? t('surface.quota_error') : snapshot.loading && !snapshot.data ? t('surface.loading') : keys.map((key, index) => `${t(`surface.${key}`)} ${values[index] === null ? t('surface.unknown') : Math.round(values[index]) + '%'}`).join(' · ')
  const radius = 7, circumference = Math.PI * 2 * radius
  const ring = React.createElement('svg', { width: 22, height: 22, viewBox: '0 0 20 20', 'aria-hidden': true },
    React.createElement('circle', { cx: 10, cy: 10, r: radius, fill: 'none', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 2.5 }),
    percent === null ? React.createElement('text', { x: 10, y: 14, textAnchor: 'middle', fill: 'currentColor', fontSize: 12 }, '?') :
      React.createElement('circle', { cx: 10, cy: 10, r: radius, fill: 'none', stroke: percent >= 95 ? 'var(--dsw-alias-state-error-primary)' : 'currentColor', strokeWidth: 2.5, strokeDasharray: circumference, strokeDashoffset: circumference * (1 - percent / 100), transform: 'rotate(-90 10 10)' }))
  return React.createElement('button', { type: 'button', className: wide ? 'cb-sidebar-quota cb-sidebar-quota-wide' : 'cb-sidebar-quota', title: text, 'aria-label': `${t('surface.details')} · ${text}`, onClick: openDetails }, ring,
    wide ? React.createElement('span', { className: 'cb-sidebar-copy' }, React.createElement('b', null, 'ClinePass'), React.createElement('span', null, text),
      React.createElement(QuotaForecast, { usage: snapshot.data, identity: JSON.stringify([prefs.baseUrl, prefs.apiKeyEnv, prefs.activeAccount, snapshot.data?.user?.email]), enabled: prefs.quotaForecastEnabled, t })) : null)
}

function ClineDetails(props) {
  const t = props.t || makeT(en, en)
  const request = useClientRequests()
  const [tab, setTab] = React.useState('overview')
  const [status, setStatus] = React.useState(null)
  const [accounts, setAccounts] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const load = React.useCallback(async (fresh = false) => {
    setLoading(true); setError('')
    try {
      const res = await request(`${ROUTE_PREFIX}/status${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setStatus(data); props.onStatus?.(data)
      if ((data.accounts || []).filter((row) => row.present).length > 1) {
        const response = await request(`${ROUTE_PREFIX}/usage/accounts${fresh ? '?fresh=1' : ''}`)
        const result = await response.json()
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
        setAccounts(result.accounts)
      } else setAccounts([])
    } catch (failure) { setError(String(failure.message || failure)) }
    finally { setLoading(false) }
  }, [request])
  React.useEffect(() => { if (tab === 'overview') void load() }, [tab, load])
  // Only the body scrolls, so the tab bar never overlaps scrolled content.
  return React.createElement(NativeModal, { open: true, onClose: props.onClose, title: t('surface.details'), className: 'cb-details-modal', contentClassName: 'cb-details-content', closeLabel: t('surface.close'), children:
    React.createElement('div', { className: 'cb-detail-shell' },
      React.createElement('div', { className: 'cb-detail-head' },
        React.createElement('div', { className: 'cb-tabs', role: 'tablist', 'aria-label': t('surface.details') }, ['overview', 'configuration'].map((value) => React.createElement('button', { type: 'button', role: 'tab', id: `cb-details-tab-${value}`, 'aria-controls': 'cb-details-panel', className: 'cb-tab', key: value, 'aria-selected': tab === value, onClick: () => setTab(value) }, t(`surface.${value}`))))),
      React.createElement('div', { className: 'cb-detail-body', role: 'tabpanel', id: 'cb-details-panel', 'aria-labelledby': `cb-details-tab-${tab}`, key: tab },
        tab === 'configuration' ? React.createElement(PluginCard, { ...props, view: 'page', openPluginUpdates: props.openPluginUpdates ? () => { props.onClose?.(); props.openPluginUpdates() } : undefined }) : React.createElement('div', { className: 'cb-page' },
          error ? React.createElement('div', { className: 'cb-alert-bad' }, error) : null,
          // The quota card owns refresh; without it a failed load still needs a way back.
          error && !status?.key?.present ? React.createElement('div', { className: 'cb-row' }, React.createElement('button', { type: 'button', className: 'cb-btn', disabled: loading, onClick: () => load(true) }, t('settings.retry'))) : null,
          status ? React.createElement(React.Fragment, null,
            React.createElement(QuotaSection, { keyPresent: status.key.present, status, usage: status.usage, accountUsage: accounts, busy: loading ? 'refresh-quota' : '', handleRefreshQuota: () => load(true), t }),
            React.createElement(StatsSection, { status, t }),
            React.createElement(ModelProbe, { status, t })) : error ? null : React.createElement('div', { className: 'cb-section-desc' }, t('surface.loading'))))) })
}

// 与统计面板的参考估算一致：缺失缓存单价按输入单价计，未上报的用量按零计，没有价格的模型不计入。
function sessionEstimate(projection, preferences) {
  if (!projection) return { calls: null, tokens: null, amount: null, reason: 'loading' }
  const valid = (value) => Number.isFinite(value) && value >= 0
  let calls = 0, tokens = 0, amount = 0, priced = 0, completeTokens = true, missingRate = false
  for (const [model, row] of Object.entries(projection.models)) {
    if (!row.calls) continue
    calls += row.calls
    const totals = row.measurements
    if (totals.totalTokens.samples !== row.calls) completeTokens = false
    tokens += totals.totalTokens.sum
    const rate = preferences.costRates?.find((entry) => entry.model === model)
    if (!rate || !valid(rate.inputPerMillion) || !valid(rate.outputPerMillion)) { missingRate = true; continue }
    priced++
    for (const [field, price] of [['inputTokens', 'inputPerMillion'], ['outputTokens', 'outputPerMillion'], ['cacheReadTokens', 'cacheReadPerMillion'], ['cacheWriteTokens', 'cacheWritePerMillion']]) {
      amount += totals[field].sum * (valid(rate[price]) ? rate[price] : rate.inputPerMillion) / 1000000
    }
  }
  const reason = !calls ? 'empty' : !priced ? 'missing_rate' : missingRate ? 'cost_partial' : ''
  return { calls, tokens: completeTokens ? tokens : null, amount: priced ? amount : null, reason }
}

function ComposerUsage(props) {
  const preferences = useClinePreferences(props.scope)
  if (preferences.showComposerUsage === false || preferences.enabled === false) return null
  return React.createElement(ComposerUsageContent, { ...props, preferences })
}

function ComposerUsageContent(props) {
  const t = props.t || makeT(en, en)
  const preferences = props.preferences
  const projection = props.useProjection('clinepassUsage')
  const request = useClientRequests()
  const [referenceRates, setReferenceRates] = React.useState([])
  const [open, setOpen] = React.useState(false)
  const bindingKey = JSON.stringify(preferences.priceBindings || [])
  const sessionModels = Object.entries(projection?.models || {}).filter(([, row]) => row.calls).map(([model]) => model).sort().join(',')
  React.useEffect(() => {
    let active = true
    setReferenceRates([])
    // 费用只在弹窗中展示，打开时才按会话模型请求参考价。
    if (open && sessionModels && (preferences.costCurrency || 'USD') === 'USD') request(`${ROUTE_PREFIX}/prices?models=${encodeURIComponent(sessionModels)}`).then(async res => {
      if (!res.ok) return
      const data = await res.json()
      if (active && data.ok) setReferenceRates(data.sessionRates || [])
    }).catch(() => {}) // Unavailable references leave the estimate unknown.
    return () => { active = false }
  }, [request, open, bindingKey, preferences.costCurrency, sessionModels])
  const result = sessionEstimate(projection, { ...preferences, costRates: [...(preferences.costRates || []), ...referenceRates] })
  const [routingRefresh, setRoutingRefresh] = React.useState(0)
  const routing = useRecentRouting(props.sessionId, projection, `${open}:${routingRefresh}`)
  const latest = routing.records[0]
  const upstreamText = latest ? t('routing.last_response', { provider: latest.upstream || t('surface.unknown') })
    : routing.loading ? t('surface.loading') : routing.error ? t('routing.unavailable') : t('routing.empty')
  const cost = result.amount === null ? t('surface.cost_unknown') : `≈ ${formatMoney(result.amount, preferences.costCurrency || 'USD')}`
  return React.createElement('div', { className: 'cb-composer-usage' },
    React.createElement('button', { type: 'button', className: 'cb-composer-button', 'aria-expanded': open, onClick: () => setOpen((value) => !value) },
      `ClinePass · ${result.calls === null ? t('surface.loading') : t('surface.calls', { count: result.calls })} · ${result.tokens === null ? t('surface.unknown') : result.tokens.toLocaleString() + ' tok'} · ${upstreamText}${latest ? ' · ' + t(`routing.state_${latest.upstreamPinStatus || 'unrecorded'}`) : ''}`),
    open ? React.createElement(NativeModal, { open: true, onClose: () => setOpen(false), title: t('surface.session_title'), className: 'cb-session-modal', closeLabel: t('surface.close'), children:
      React.createElement('div', { className: 'cb-page cb-session-detail' }, React.createElement('p', null, t('surface.session_hint')),
        React.createElement('div', { className: 'cb-block' },
          React.createElement('p', { className: 'cb-section-desc' }, t('routing.session_hint')),
          React.createElement('div', { className: 'cb-row' }, React.createElement('button', { type: 'button', className: 'cb-btn cb-btn-sm', onClick: () => setRoutingRefresh((value) => value + 1) }, t('routing.refresh'))),
          routing.error ? React.createElement('p', { className: 'cb-alert-bad' }, routing.error) : null,
          routing.loading ? React.createElement('p', null, t('surface.loading')) : React.createElement(RoutingHistory, { records: routing.records, t })),
        React.createElement('div', { className: 'cb-cost-estimate' }, React.createElement('span', null, t('surface.estimated_cost')), React.createElement('strong', null, cost)),
        result.reason ? React.createElement('p', null, t(`surface.${result.reason}`)) : null,
        React.createElement('p', null, t('surface.cost_hint', { currency: preferences.costCurrency || 'USD' })),
        Object.entries(projection?.models || {}).filter(([, row]) => row.calls).map(([model, row]) => React.createElement('div', { className: 'cb-section-card', key: model },
          React.createElement('b', { className: 'cb-model-id' }, model), React.createElement('span', null, t('surface.calls', { count: row.calls })),
          ['promptTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'].map((field) => React.createElement('div', { className: 'cb-usage-row', key: field }, React.createElement('span', null, t(`durable.${field}`)), React.createElement('b', null, row.measurements[field].samples ? `${row.measurements[field].sum.toLocaleString()} · ${row.measurements[field].samples}/${row.calls}` : t('quota.unknown')))))) ) }) : null)
}
