import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { GROUP_FIELDS, MEASURE_FIELDS, normalizeRequest, normalizeUsage, emptyTotals, requestTotals, addTotals, aggregateRows } from './request-metrics.js'

const RECENT_LIMIT = 100
const empty = () => ({ version: 1, resetId: '', resetAt: null, groups: [], attemptGroups: [], recent: [] })
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const integer = (value) => Number.isSafeInteger(value) && value >= 0

function validate(document) {
  const bad = () => { throw Object.assign(new Error('Statistics file is invalid; reset statistics to recover it'), { code: 'STATS_CORRUPT' }) }
  if (!document || document.version !== 1 || typeof document.resetId !== 'string' || !(document.resetAt === null || finite(document.resetAt)) || !Array.isArray(document.groups) || !Array.isArray(document.attemptGroups) || !Array.isArray(document.recent)) bad()
  for (const row of [...document.groups, ...document.attemptGroups]) {
    if (!GROUP_FIELDS.every((key) => typeof row?.[key] === 'string') || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) bad()
    const totals = row.totals
    if (!totals || !['requests', 'success', 'failure', 'cancelled', 'attempts', 'rateLimits'].every((key) => integer(totals[key])) || totals.requests !== totals.success + totals.failure) bad()
    if (!MEASURE_FIELDS.every((key) => finite(totals.measurements?.[key]?.sum) && integer(totals.measurements[key].samples) && totals.measurements[key].samples <= totals.requests)) bad()
  }
  // Recent records are display-only; refuse malformed or future files rather
  // than silently loading an empty history or overwriting their counters.
  for (const row of document.recent) {
    if (typeof row?.id !== 'string' || !finite(row.completedAt) || !Array.isArray(row.attempts) || !row.usage || !GROUP_FIELDS.every((key) => typeof row[key] === 'string')) bad()
  }
  return document
}

function merged(base, pending) {
  return { ...base, groups: aggregateRows([...base.groups, ...pending.groups]), attemptGroups: aggregateRows([...base.attemptGroups, ...pending.attemptGroups]), recent: [...base.recent, ...pending.recent].slice(-RECENT_LIMIT) }
}

export function createStatsStore(filename, { fs = { readFile, mkdir, copyFile }, atomicWrite = writeFileAtomic, lock = withFileLock, now = Date.now } = {}) {
  let base = empty(), pending = empty(), error = '', errorCode = ''
  let loaded = false
  let hasSnapshot = false
  let tail = Promise.resolve()
  async function read() {
    try { return validate(JSON.parse(await fs.readFile(filename, 'utf8'))) }
    catch (failure) {
      if (failure.code === 'ENOENT') return empty()
      if (failure instanceof SyntaxError) throw Object.assign(new Error('Statistics file contains invalid JSON; reset statistics to recover it'), { code: 'STATS_CORRUPT' })
      throw failure
    }
  }
  function report(failure) {
    errorCode = typeof failure.code === 'string' ? failure.code : 'STATS_IO_ERROR'
    error = errorCode === 'STATS_CORRUPT' ? 'Statistics file is invalid and has not been overwritten. Reset statistics to archive it and start again.' : `Statistics storage failed (${errorCode}); new measurements remain in memory until storage recovers.`
  }
  function adopt(document) {
    if (hasSnapshot && document.resetId !== base.resetId) pending = empty()
    base = document
    loaded = true
    hasSnapshot = true
  }
  const ready = read().then((document) => { adopt(document) }, (failure) => { loaded = true; report(failure) })
  function enqueue(operation) {
    const result = tail.then(() => ready).then(operation)
    tail = result.catch(() => {})
    return result
  }
  function append(record) {
    pending.groups = aggregateRows([...pending.groups, { ...Object.fromEntries(GROUP_FIELDS.map((field) => [field, record[field]])), totals: requestTotals(record) }])
    const attempts = record.attempts.map((entry) => {
      const attempt = { ...record, account: entry.account || 'unknown', ok: entry.ok, attempts: [entry],
        cancelled: ['CANCELLED', 'ABORTED'].includes(entry.code) || (entry === record.attempts.at(-1) && record.cancelled),
        usage: normalizeUsage(), latencyMs: entry.latencyMs, ttftMs: null }
      return { ...Object.fromEntries(GROUP_FIELDS.map((field) => [field, attempt[field]])), totals: requestTotals(attempt) }
    })
    pending.attemptGroups = aggregateRows([...pending.attemptGroups, ...attempts])
    pending.recent.push(record)
    pending.recent = pending.recent.slice(-RECENT_LIMIT)
  }
  async function persist(record) {
    let appended = false
    try {
      await fs.mkdir(dirname(filename), { recursive: true, mode: 0o700 })
      await lock(filename, async () => {
        adopt(await read())
        if (record) { append(record); appended = true }
        const next = merged(base, pending)
        await atomicWrite(filename, JSON.stringify(next), { mode: 0o600, dirMode: 0o700 })
        base = next
        pending = empty()
        error = errorCode = ''
      })
      return true
    } catch (failure) {
      if (record && !appended) append(record)
      report(failure)
      return false
    }
  }
  return {
    ready,
    record(metrics) {
      const record = normalizeRequest(metrics, now())
      return enqueue(() => persist(record))
    },
    status() { return { available: true, loaded, persisted: !error && pending.groups.length === 0, error, errorCode, pendingRequests: pending.groups.reduce((sum, row) => sum + row.totals.requests, 0) } },
    query(filters = {}) {
      return enqueue(async () => {
        try { adopt(await read()) } catch (failure) { report(failure) }
        const current = merged(base, pending)
        const matches = (row) => (!filters.from || row.day >= filters.from) && (!filters.to || row.day <= filters.to)
          && ['model', 'account', 'source', 'transport'].every((key) => !filters[key] || row[key] === filters[key])
        const rows = current.groups.filter(matches)
        const attemptRows = current.attemptGroups.filter(matches)
        const accountAttempts = new Map()
        for (const row of attemptRows) {
          if (!accountAttempts.has(row.account)) accountAttempts.set(row.account, emptyTotals())
          addTotals(accountAttempts.get(row.account), row.totals)
        }
        const summary = rows.reduce((totals, row) => addTotals(totals, row.totals), emptyTotals())
        const dimensions = ['day', 'model', 'account']
        const grouped = Object.fromEntries(dimensions.map((field) => {
          const map = new Map()
          for (const row of rows) {
            if (!map.has(row[field])) map.set(row[field], emptyTotals())
            addTotals(map.get(row[field]), row.totals)
          }
          return [field, [...map].map(([value, totals]) => ({ value, totals })).sort((a, b) => a.value.localeCompare(b.value))]
        }))
        return { ...this.status(), resetAt: current.resetAt, summary, grouped, rows: structuredClone(rows), attemptRows: structuredClone(attemptRows), attemptAccounts: [...accountAttempts].map(([value, totals]) => ({ value, totals })), recent: structuredClone(current.recent.filter(matches).reverse()) }
      })
    },
    flush() { return enqueue(() => persist()) },
    reset() {
      return enqueue(async () => {
        await fs.mkdir(dirname(filename), { recursive: true, mode: 0o700 })
        let archived = false
        try {
          await lock(filename, async () => {
            try { await read() }
            catch (failure) {
              if (failure.code !== 'STATS_CORRUPT') throw failure
              await fs.copyFile(filename, `${filename}.corrupt-${randomUUID()}`)
              archived = true
            }
            const next = { ...empty(), resetId: randomUUID(), resetAt: now() }
            await atomicWrite(filename, JSON.stringify(next), { mode: 0o600, dirMode: 0o700 })
            base = next; pending = empty(); loaded = hasSnapshot = true; error = errorCode = ''
          })
          return { ok: true, archived }
        } catch (failure) { report(failure); throw new Error(error) }
      })
    },
    // There are no timers or open file handles. Drain current writes; a native
    // call captured before plugin unload may still report its eventual finish.
    async close() { await tail; if (pending.groups.length) await this.flush() },
  }
}

export function statsCsv(rows) {
  const fields = ['scope', ...GROUP_FIELDS, 'requests', 'success', 'failure', 'cancelled', 'attempts', 'rateLimits', ...MEASURE_FIELDS.flatMap((field) => [field, `${field}Samples`])]
  const cell = (value) => {
    const text = String(value ?? '')
    // Quotes escape CSV syntax; a leading apostrophe also prevents formulas.
    return `"${(/^[\s]*[=+\-@]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`
  }
  return fields.join(',') + '\r\n' + rows.map((row) => fields.map((field) => {
    if (field === 'scope' || GROUP_FIELDS.includes(field)) return cell(row[field])
    if (field in row.totals) return String(row.totals[field])
    const samples = field.endsWith('Samples')
    const measured = row.totals.measurements[samples ? field.slice(0, -7) : field]
    return samples ? String(measured.samples) : measured.samples ? String(measured.sum) : ''
  }).join(',')).join('\r\n') + '\r\n'
}

export function createStatsRuntime(ctx) {
  let store
  ctx.inject?.(['profileContext'], (inner) => {
    store = createStatsStore(join(inner.profileContext.dir, 'clinepass', 'stats.json'))
  })
  const unavailable = () => ({ available: false, persisted: false, error: 'Statistics require a DSH profileContext; no fallback file is written.' })
  return {
    record: (metrics) => store?.record(metrics) || Promise.resolve(false),
    status: () => store?.status() || unavailable(),
    query: (filters) => store ? store.query(filters) : Promise.resolve(unavailable()),
    reset: () => store ? store.reset() : Promise.reject(new Error(unavailable().error)),
    close: () => store?.close(),
  }
}
