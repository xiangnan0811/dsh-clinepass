import { registerAuthenticatedRoute, assertTrustedSettingsRequest } from '../access.js'
import { writeJson } from '../http.js'
import { statsCsv } from '../stats-store.js'

function filtersFor(req) {
  const params = new URL(req.url, 'http://localhost').searchParams
  const filters = {}
  for (const key of ['from', 'to', 'model', 'account', 'source', 'transport']) {
    const value = params.get(key)
    if (!value) continue
    if (value.length > 256) throw new Error('Statistics filter is too long')
    if (['from', 'to'].includes(key) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Dates must be valid UTC YYYY-MM-DD values')
    filters[key] = value
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('Start date must not follow end date')
  for (const key of ['since', 'until']) {
    const value = params.get(key)
    if (!value) continue
    const time = Date.parse(value)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 16) !== value.slice(0, 16)) throw new Error('Detailed times must be UTC ISO dates aligned to a minute')
    filters[key] = new Date(time).toISOString()
  }
  if (filters.since && filters.until && filters.since >= filters.until) throw new Error('End time must follow start time')
  if (params.has('errorsOnly')) {
    if (!['0', '1'].includes(params.get('errorsOnly'))) throw new Error('errorsOnly must be 0 or 1')
    filters.errorsOnly = params.get('errorsOnly') === '1'
  }
  const offset = Number(params.get('timezoneOffsetMinutes') || 0)
  if (!Number.isInteger(offset) || Math.abs(offset) > 840) throw new Error('Invalid timezone offset')
  filters.timezoneOffsetMinutes = offset
  return filters
}

export function registerStatsRoutes(ctx, { statistics, economy }) {
  ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact', path: '/dsh-clinebot/accounts/history',
    handler: async (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'GET only' })
      const result = await statistics.events()
      writeJson(res, result.available ? 200 : 503, { ok: result.available, ...result })
    },
  }), 'dsh-clinebot: account history')
  for (const action of ['', '/export', '/reset']) ctx.effect(() => registerAuthenticatedRoute(ctx, {
    kind: 'exact', path: `/dsh-clinebot/stats${action}`,
    handler: async (req, res) => {
      if (req.method !== (action === '/reset' ? 'POST' : 'GET')) return writeJson(res, 405, { ok: false, error: 'Invalid method' })
      if (action === '/reset' && !assertTrustedSettingsRequest(req, res)) return
      try {
        if (action === '/reset') return writeJson(res, 200, await statistics.reset())
        const result = await statistics.query(filtersFor(req))
        if (!result.available) return writeJson(res, 503, { ok: false, ...result })
        if (economy) result.cost = await economy.estimate(result.rows)
        if (action === '/export') {
          if (result.error) return writeJson(res, 503, { ok: false, error: result.error })
          const format = new URL(req.url, 'http://localhost').searchParams.get('format') || 'csv'
          if (!['csv', 'json'].includes(format)) return writeJson(res, 400, { ok: false, error: 'Unknown export format' })
          if (format === 'json') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="clinepass-statistics.json"', 'Cache-Control': 'no-store' })
            return res.end(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...result }))
          }
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="clinepass-statistics.csv"', 'Cache-Control': 'no-store' })
          return res.end('\uFEFF' + statsCsv([...result.rows.map((row) => ({ ...row, scope: 'request' })), ...result.attemptRows.map((row) => ({ ...row, scope: 'attempt' }))]))
        }
        writeJson(res, 200, { ok: true, ...result })
      } catch (error) { writeJson(res, action === '/reset' ? 503 : 400, { ok: false, error: String(error.message || error) }) }
    },
  }), `dsh-clinebot: statistics${action}`)
}
