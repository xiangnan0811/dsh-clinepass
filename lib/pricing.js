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

export function estimateRows(rows, config, catalog) {
  let measuredAmount = 0, measuredRequests = 0, requests = 0, cacheSavings = 0
  for (const row of rows) {
    const total = row.totals
    requests += total.requests
    const rate = effectiveRate(row.model, config, catalog)
    if (!rate || !RATE_FIELDS.every(field => finite(rate[field])) || !TOKENS.every(field => total.measurements[field].samples === total.requests)) continue
    measuredRequests += total.requests
    measuredAmount += TOKENS.reduce((sum, field, index) => sum + total.measurements[field].sum * rate[RATE_FIELDS[index]] / 1e6, 0)
    cacheSavings += total.measurements.cacheReadTokens.sum * (rate.inputPerMillion - rate.cacheReadPerMillion) / 1e6
  }
  return { amount: measuredRequests === requests ? measuredAmount : null, measuredAmount, measuredRequests, requests,
    cacheSavings: measuredRequests === requests ? cacheSavings : null, currency: config.costCurrency || 'USD' }
}

export function budgetStatus(config, day, month) {
  const enabled = (config.dailyBudget || 0) > 0 || (config.monthlyBudget || 0) > 0
  for (const [scope, estimate, limit] of [['day', day, config.dailyBudget], ['month', month, config.monthlyBudget]]) {
    if (!(limit > 0)) continue
    if (estimate?.amount == null) return { enabled, blocked: true, code: 'BUDGET_UNVERIFIED', scope, limit }
    if (estimate.amount >= limit) return { enabled, blocked: true, code: 'BUDGET_EXCEEDED', scope, limit }
  }
  return { enabled, blocked: false, code: '' }
}
