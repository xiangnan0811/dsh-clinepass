// Upper bounds, with an explicit overflow bucket. Missing latency has no sample.
export const LATENCY_BOUNDS = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400]
export const HISTOGRAM_FIELDS = ['latencyMs', 'ttftMs']
export const emptyHistograms = () => Object.fromEntries(HISTOGRAM_FIELDS.map(field => [field, Array(LATENCY_BOUNDS.length + 1).fill(0)]))

export function observeLatency(histograms, field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return
  const index = LATENCY_BOUNDS.findIndex(bound => value <= bound)
  histograms[field][index < 0 ? LATENCY_BOUNDS.length : index]++
}

export function latencyPercentile(buckets, percentile) {
  const samples = (buckets || []).reduce((sum, count) => sum + count, 0)
  if (!samples) return { samples: 0, upperMs: null, overflow: false }
  const target = Math.ceil(samples * percentile / 100)
  let seen = 0
  for (let index = 0; index < buckets.length; index++) {
    seen += buckets[index]
    if (seen >= target) return { samples, upperMs: LATENCY_BOUNDS[index] ?? null, overflow: index === LATENCY_BOUNDS.length, lowerMs: index ? LATENCY_BOUNDS[index - 1] : 0 }
  }
  return { samples, upperMs: null, overflow: false }
}

export function analyzeTimeline(rows, totals, timezoneOffsetMinutes = 0) {
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0))
  let requests = 0
  for (const row of rows) {
    const date = new Date(Date.parse(`${row.minute}:00Z`) - timezoneOffsetMinutes * 60000)
    heatmap[(date.getUTCDay() + 6) % 7][date.getUTCHours()] += row.totals.requests
    requests += row.totals.requests
  }
  return { detailedRequests: requests, timezoneOffsetMinutes, heatmap,
    percentiles: Object.fromEntries(HISTOGRAM_FIELDS.map(field => [field, {
      p50: latencyPercentile(totals.histograms?.[field], 50), p95: latencyPercentile(totals.histograms?.[field], 95),
    }])) }
}

export function timelineMatches(row, filters) {
  return (!filters.since || `${row.minute}:00.000Z` >= filters.since)
    && (!filters.until || `${row.minute}:00.000Z` < filters.until)
    && (!filters.errorsOnly || row.outcome === 'failure')
}
