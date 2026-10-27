import { join } from 'node:path'
import { createPriceCatalog } from './price-catalog.js'
import { effectiveRate, estimateRows, budgetStatus, referenceRate } from './pricing.js'

export function createEconomy(ctx, { live, statistics, now = Date.now }) {
  let prices, lastAutoAttempt = 0
  ctx.inject?.(['profileContext'], inner => { prices = createPriceCatalog(join(inner.profileContext.dir, 'clinepass', 'prices.json')) })
  const snapshot = () => prices?.snapshot() || { models: [], syncedAt: null, error: 'Reference prices require a DSH profile.' }
  const api = {
    async references(model = '', sessionModels = []) {
      await prices?.ready
      const catalog = snapshot(), cfg = live()
      const key = model.replace(/^cline-pass\//, '').toLowerCase()
      const binding = cfg.priceBindings?.find(row => row.model === model)
      const matches = catalog.models.filter(row => row.id.toLowerCase() === key || row.id.toLowerCase().split('/').at(-1) === key || row.canonical?.toLowerCase().split('/').at(-1) === key || row.provider === binding?.provider && row.id === binding?.sourceModel)
      const rank = row => row.provider === binding?.provider && row.id === binding?.sourceModel ? 0 : row.provider === 'cline-pass' ? 1 : 2
      matches.sort((a, b) => rank(a) - rank(b) || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id))
      return { model, syncedAt: catalog.syncedAt, source: catalog.source, error: catalog.error, count: catalog.models.length,
        matches: matches.slice(0, 100), effective: effectiveRate(model, cfg, catalog),
        rates: (cfg.priceBindings || []).map(row => effectiveRate(row.model, cfg, catalog)).filter(Boolean),
        sessionRates: sessionModels.map(name => referenceRate(name, cfg, catalog)).filter(Boolean) }
    },
    async syncPrices() { if (!prices) throw new Error('Reference prices require a DSH profile.'); await prices.sync(); return api.references() },
    async autoSync() {
      if (!live().priceAutoSync || !prices || now() - lastAutoAttempt < 6 * 3600000) return
      await prices.ready
      if (snapshot().syncedAt && now() - snapshot().syncedAt < 6 * 3600000) return
      lastAutoAttempt = now()
      await prices.sync().catch(() => {}) // User-facing status retains the error and last successful catalog.
    },
    async estimate(rows) { await prices?.ready; return estimateRows(rows, live(), snapshot()) },
    async status() {
      await prices?.ready
      const date = new Date(now()).toISOString().slice(0, 10), cfg = live()
      const [day, month] = await Promise.all([statistics.query({ from: date, to: date }), statistics.query({ from: date.slice(0, 7) + '-01', to: date })])
      const estimate = result => result.available && !result.error ? estimateRows(result.rows, cfg, snapshot()) : { amount: null, currency: cfg.costCurrency || 'USD' }
      const dayCost = estimate(day), monthCost = estimate(month)
      return { ...budgetStatus(cfg, dayCost, monthCost), day: dayCost, month: monthCost, currency: cfg.costCurrency || 'USD' }
    },
    async guard() {
      const cfg = live()
      if (!(cfg.dailyBudget > 0 || cfg.monthlyBudget > 0)) return
      const status = await api.status()
      if (status.blocked) throw Object.assign(new Error('Local estimated ClinePass budget reached. Review the budget in Usage & rates.'), { code: status.code })
    },
    close: () => prices?.close(),
  }
  return api
}
