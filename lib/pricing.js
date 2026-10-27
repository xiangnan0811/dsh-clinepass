export const RATE_FIELDS = ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion']
const TOKENS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function effectiveRate(model, config, catalog) {
  const manual = config.costRates?.find(row => row.model === model)
  if (manual) return { ...manual, source: 'manual', currency: config.costCurrency || 'USD' }
  if (config.costCurrency && config.costCurrency !== 'USD') return null
  const binding = config.priceBindings?.find(row => row.model === model)
  if (!binding) return null
  const row = catalog?.models?.find(entry => entry.provider === binding.provider && entry.id === binding.sourceModel)
  return row ? { ...row, model, source: 'public', currency: 'USD', syncedAt: catalog.syncedAt } : null
}

const lastSegment = value => String(value || '').toLowerCase().split('/').at(-1)

// 未手动设价也未绑定时，按模型名在公共目录中挑一个参考价：ClinePass 自身 > 官方厂商 > 其他提供方。
export function matchReference(model, catalog) {
  const rows = catalog?.models || []
  const base = lastSegment(model)
  for (const key of new Set([base, base.replace(/-\d{4}$/, '')])) {
    const found = rows.filter(row => (lastSegment(row.id) === key || lastSegment(row.canonical) === key)
      && finite(row.inputPerMillion) && finite(row.outputPerMillion) && row.inputPerMillion + row.outputPerMillion > 0)
    if (!found.length) continue
    const rank = row => [row.provider === 'cline-pass' ? 0 : row.canonical?.toLowerCase().startsWith(`${row.provider.toLowerCase()}/`) ? 1 : 2,
      lastSegment(row.id) === key ? 0 : 1, finite(row.cacheReadPerMillion) ? 0 : 1]
    found.sort((a, b) => {
      const left = rank(a), right = rank(b)
      return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)
    })
    return { ...found[0], model, source: 'auto', currency: 'USD', syncedAt: catalog.syncedAt }
  }
  return null
}

export function referenceRate(model, config, catalog) {
  const rate = effectiveRate(model, config, catalog)
  if (rate || (config.costCurrency && config.costCurrency !== 'USD')) return rate
  return matchReference(model, catalog)
}

// 参考估算：ClinePass 订阅不按请求计费，这里只给出量级参考。缺失的缓存单价按输入单价计，
// 未上报的 token 计为 0，完全没有用量的请求（如失败请求）不计费，没有价格的模型不计入。
export function estimateRows(rows, config, catalog) {
  const models = new Map()
  let amount = 0, priced = false, cacheSavings = 0
  for (const row of rows) {
    const total = row.totals
    const entry = models.get(row.model) || { model: row.model, requests: 0, amount: 0, rate: null }
    entry.requests += total.requests
    models.set(row.model, entry)
    const rate = referenceRate(row.model, config, catalog)
    if (!rate || !finite(rate.inputPerMillion) || !finite(rate.outputPerMillion)) continue
    priced = true
    entry.rate = { source: rate.source, provider: rate.provider || '', id: rate.id || '', ...Object.fromEntries(RATE_FIELDS.map(field => [field, finite(rate[field]) ? rate[field] : null])) }
    const price = field => finite(rate[field]) ? rate[field] : rate.inputPerMillion
    const cost = TOKENS.reduce((sum, field, index) => sum + total.measurements[field].sum * price(RATE_FIELDS[index]) / 1e6, 0)
    entry.amount += cost
    amount += cost
    cacheSavings += total.measurements.cacheReadTokens.sum * (rate.inputPerMillion - price('cacheReadPerMillion')) / 1e6
  }
  return { amount: priced ? amount : null, cacheSavings: priced ? cacheSavings : null, currency: config.costCurrency || 'USD',
    syncedAt: catalog?.syncedAt || null, models: [...models.values()].sort((a, b) => b.amount - a.amount || b.requests - a.requests) }
}

// 预算只在参考估算达到上限时拦截；没有价格或统计不可用时视为 0，不阻断请求。
export function budgetStatus(config, day, month) {
  const enabled = (config.dailyBudget || 0) > 0 || (config.monthlyBudget || 0) > 0
  for (const [scope, estimate, limit] of [['day', day, config.dailyBudget], ['month', month, config.monthlyBudget]]) {
    if (limit > 0 && (estimate?.amount || 0) >= limit) return { enabled, blocked: true, code: 'BUDGET_EXCEEDED', scope, limit }
  }
  return { enabled, blocked: false, code: '' }
}
