const TOKEN_PARTS = ['cacheReadTokens', 'inputTokens', 'cacheWriteTokens', 'outputTokens']

// 覆盖率低于该比例才标记为部分上报；悬停仍显示精确次数。
function isPartial(samples, total) {
  return total > 0 && samples / total < 0.95
}

function formatCompact(value) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 }) : '—'
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '—'
  return ms >= 1000 ? `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: ms >= 10000 ? 1 : 2 })} s` : `${Math.round(ms)} ms`
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
  if (amount > 0 && amount < 0.01) return `< ${formatMoney(0.01, currency)}`
  try {
    return amount.toLocaleString(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function formatPercent(part, total) {
  if (!total) return '—'
  const share = part / total * 100
  return share > 0 && share < 0.1 ? '<0.1%' : `${share.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function percentileText(value) {
  if (!value?.samples) return '—'
  return value.overflow ? `> ${formatDuration(value.lowerMs)}` : `≤ ${formatDuration(value.upperMs)}`
}

function meanOf(totals, field) {
  const value = totals.measurements[field]
  return value.samples ? value.sum / value.samples : NaN
}

// 缓存命中率：缓存读取占全部输入（缓存读取 + 未缓存输入 + 缓存写入）的比例。
function cacheHitRate(totals) {
  const read = totals.measurements.cacheReadTokens.sum
  const all = read + totals.measurements.inputTokens.sum + totals.measurements.cacheWriteTokens.sum
  return all ? formatPercent(read, all) : '—'
}

function KpiRow({ summary, cost, analytics, t }) {
  const items = [
    { key: 'requests', label: t('durable.kpi_requests'), value: summary.requests.toLocaleString(), note: t('stats.kpi_requests_sub', { failure: summary.failure.toLocaleString(), limited: summary.rateLimits.toLocaleString() }), tone: summary.requests && summary.failure / summary.requests >= 0.05 ? 'warn' : '' },
    { key: 'success', label: t('durable.kpi_success'), value: formatPercent(summary.success, summary.requests), note: `${summary.success.toLocaleString()} / ${summary.requests.toLocaleString()}` },
    { key: 'tokens', label: t('durable.totalTokens'), value: formatCompact(summary.measurements.totalTokens.sum), title: summary.measurements.totalTokens.sum.toLocaleString(), note: t('stats.kpi_tokens_sub', { rate: cacheHitRate(summary) }) },
    { key: 'cost', label: t('cost.title'), value: cost?.amount == null ? '—' : `≈ ${formatMoney(cost.amount, cost.currency)}`, note: cost?.cacheSavings ? t('cost.saved', { amount: formatMoney(cost.cacheSavings, cost.currency) }) : '' },
    { key: 'ttft', label: t('stats.kpi_ttft'), value: percentileText(analytics?.percentiles?.ttftMs?.p50), note: t('stats.kpi_ttft_sub', { mean: formatDuration(meanOf(summary, 'ttftMs')) }) },
  ]
  return React.createElement('div', { className: 'cb-kpis' }, items.map((item) => React.createElement('div', { className: 'cb-kpi', key: item.key },
    React.createElement('span', null, item.label),
    React.createElement('b', { title: item.title }, item.value),
    React.createElement('small', { className: item.tone ? `cb-kpi-note-${item.tone}` : undefined }, item.note))))
}

function TokenComposition({ summary, t }) {
  const parts = TOKEN_PARTS.map((key) => ({ key, ...summary.measurements[key] }))
  const total = parts.reduce((sum, part) => sum + part.sum, 0)
  if (!total) return null
  const partial = parts.some((part) => isPartial(part.samples, summary.requests))
  const reasoning = summary.measurements.reasoningTokens
  return React.createElement('section', { className: 'cb-panel' },
    React.createElement('div', { className: 'cb-subhead' },
      React.createElement('span', { className: 'cb-subtitle' }, t('tokens.title')),
      React.createElement('span', { className: 'cb-metric-inline', title: t('tokens.hit_rate_hint') }, t('tokens.hit_rate'), React.createElement('b', null, cacheHitRate(summary)))),
    React.createElement('div', { className: 'cb-stack', role: 'img', 'aria-label': parts.map((part) => `${t(`tokens.${part.key}`)} ${formatPercent(part.sum, total)}`).join(' · ') },
      parts.filter((part) => part.sum > 0).map((part) => React.createElement('span', { key: part.key, className: `cb-stack-seg cb-seg-${part.key}`, style: { flexGrow: part.sum / total * 1000 }, title: `${t(`tokens.${part.key}`)} · ${part.sum.toLocaleString()} · ${formatPercent(part.sum, total)}` }))),
    React.createElement('div', { className: 'cb-legend' }, parts.map((part) => React.createElement('div', { className: 'cb-legend-item', key: part.key },
      React.createElement('span', { className: 'cb-legend-label' }, React.createElement('i', { className: `cb-swatch cb-seg-${part.key}`, 'aria-hidden': true }), t(`tokens.${part.key}`)),
      React.createElement('b', { title: part.sum.toLocaleString() }, formatCompact(part.sum), React.createElement('span', { className: 'cb-legend-pct' }, formatPercent(part.sum, total))),
      part.key === 'outputTokens' && reasoning.samples ? React.createElement('small', null, t('tokens.reasoning', { value: formatCompact(reasoning.sum) })) : null,
      isPartial(part.samples, summary.requests) ? React.createElement('small', { className: 'cb-partial', title: t('durable.coverage_title', { samples: part.samples, total: summary.requests }) }, t('tokens.partial', { pct: coveragePercent(part.samples, summary.requests) })) : null))),
    partial ? React.createElement('p', { className: 'cb-footnote' }, t('tokens.partial_hint')) : null)
}

function LatencyPanel({ summary, analytics, t }) {
  const fields = ['ttftMs', 'latencyMs']
  const samples = analytics?.percentiles?.latencyMs?.p50?.samples || 0
  return React.createElement('section', { className: 'cb-panel' },
    React.createElement('span', { className: 'cb-subtitle' }, t('latency.title')),
    React.createElement('div', { className: 'cb-latency-grid', role: 'table', 'aria-label': t('latency.title') },
      React.createElement('div', { className: 'cb-latency-row cb-latency-head', role: 'row' }, ['', 'P50', 'P95', t('latency.mean')].map((label, index) => React.createElement('span', { key: index, role: 'columnheader' }, label))),
      fields.map((field) => React.createElement('div', { className: 'cb-latency-row', role: 'row', key: field },
        React.createElement('span', { role: 'rowheader' }, t(`latency.${field}`)),
        React.createElement('b', { role: 'cell' }, percentileText(analytics?.percentiles?.[field]?.p50)),
        React.createElement('span', { role: 'cell' }, percentileText(analytics?.percentiles?.[field]?.p95)),
        React.createElement('span', { role: 'cell', title: t('durable.coverage_title', { samples: summary.measurements[field].samples, total: summary.requests }) }, formatDuration(meanOf(summary, field)))))),
    React.createElement('p', { className: 'cb-footnote' }, t('latency.hint', { count: samples.toLocaleString() })))
}

function CostPanel({ cost: reference, syncing, onSync, t }) {
  if (!reference) return null
  const currency = reference.currency
  const rateTitle = (rate) => rate ? t('cost.rate_title', { provider: rate.source === 'manual' ? t('cost.source_manual') : `${rate.provider} / ${rate.id}`, input: rate.inputPerMillion ?? '—', output: rate.outputPerMillion ?? '—', read: rate.cacheReadPerMillion ?? '—' }) : t('cost.unpriced')
  const unpriced = reference.models.some((row) => !row.rate)
  return React.createElement('section', { className: 'cb-panel' },
    React.createElement('div', { className: 'cb-subhead' },
      React.createElement('span', { className: 'cb-subtitle cb-hint', title: t('cost.hint') }, t('cost.title')),
      React.createElement('span', { className: 'cb-cost-total' }, reference.amount == null ? '—' : `≈ ${formatMoney(reference.amount, currency)}`)),
    reference.cacheSavings ? React.createElement('p', { className: 'cb-footnote' }, t('cost.saved', { amount: formatMoney(reference.cacheSavings, currency) })) : null,
    React.createElement('ul', { className: 'cb-cost-list' }, reference.models.map((row) => React.createElement('li', { key: row.model, title: `${row.model}\n${rateTitle(row.rate)}` },
      React.createElement('code', { className: 'cb-cost-model' }, row.model.replace(/^cline-pass\//, '')),
      React.createElement('span', { className: row.rate ? 'cb-badge' : 'cb-badge cb-badge-warn' }, row.rate ? t(`cost.source_${row.rate.source}`) : t('cost.unpriced')),
      React.createElement('span', { className: 'cb-cost-amount' }, row.rate ? formatMoney(row.amount, currency) : '—')))),
    unpriced && currency !== 'USD' ? React.createElement('p', { className: 'cb-footnote' }, t('cost.currency_manual', { currency })) : null,
    React.createElement('div', { className: 'cb-row cb-cost-foot' },
      React.createElement('span', { className: 'cb-footnote' }, reference.syncedAt ? t('cost.synced', { time: new Date(reference.syncedAt).toLocaleString() }) : t('cost.no_catalog')),
      React.createElement('button', { type: 'button', className: reference.syncedAt ? 'cb-btn cb-btn-sm cb-btn-ghost cb-push' : 'cb-btn cb-btn-sm cb-push', disabled: syncing, onClick: onSync }, syncing ? t('cost.syncing') : t('cost.sync'))))
}
