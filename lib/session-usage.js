import { z } from 'zod'
import { TOKEN_FIELDS, normalizeUsage } from './request-metrics.js'

const measures = z.object(Object.fromEntries(TOKEN_FIELDS.map((field) => [field, z.object({ sum: z.number().nonnegative(), samples: z.number().int().nonnegative() })])))
const bucket = z.object({ calls: z.number().int().nonnegative(), measurements: measures })
const route = z.object({ provider: z.string(), model: z.string() })
const view = z.object({ route, models: z.record(z.string(), bucket) })
const last = z.object({ turn: z.number(), step: z.number(), model: z.string(), contribution: bucket }).nullable()
const stateSchema = z.object({ view, last })

function sample(usage) {
  const values = normalizeUsage(usage)
  return { calls: 1, measurements: Object.fromEntries(TOKEN_FIELDS.map((field) => [field, { sum: values[field] ?? 0, samples: values[field] === null ? 0 : 1 }])) }
}

function change(target, contribution, sign) {
  target.calls += sign * contribution.calls
  for (const field of TOKEN_FIELDS) {
    target.measurements[field].sum += sign * contribution.measurements[field].sum
    target.measurements[field].samples += sign * contribution.measurements[field].samples
  }
}

/** A pure, replayable fold over native settlements; no global history fallback. */
export const clinepassUsageProjection = {
  // Refold old checkpoints under the shared consistency rules.
  key: 'clinepassUsage', stateVersion: 2, stateSchema,
  init: () => ({ view: { route: { provider: '', model: '' }, models: {} }, last: null }),
  apply(state, event) {
    if (event.type === 'request/header') {
      const config = event.data.header.config
      const next = { provider: config.provider, model: config.model }
      if (state.view.route.provider === next.provider && state.view.route.model === next.model && !event.data.startsSeries) return state
      return { ...state, view: { ...state.view, route: next }, last: null }
    }
    if (event.type === 'llm/retry-started') return state.last?.turn === event.data.turn && state.last.step === event.data.step ? { ...state, last: null } : state
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
    const source = event.type === 'assistant/message' ? event.data.message.source : state.view.route
    if (source.provider !== 'clinebot') return state.last ? { ...state, last: null } : state
    const usage = event.data.usage ?? event.data.stream.findLast((record) => record.type === 'chunk' && record.chunk.type === 'usage')?.chunk.usage
    const contribution = sample(usage)
    let models = structuredClone(state.view.models)
    const previous = state.last
    if (previous && previous.turn === event.data.turn && previous.step === event.data.step) change(models[previous.model], previous.contribution, -1)
    if (!Object.hasOwn(models, source.model)) models = { ...models, [source.model]: { ...sample(undefined), calls: 0 } }
    change(models[source.model], contribution, 1)
    return { view: { ...state.view, models }, last: { turn: event.data.turn, step: event.data.step, model: source.model, contribution } }
  },
  wire: { viewSchema: view, view: (state) => state.view },
}

export function registerSessionUsage(ctx) {
  ctx.inject?.(['sessionProjections'], (inner) => inner.effect(() => inner.sessionProjections.register(clinepassUsageProjection), 'dsh-clinebot: current-session usage'))
}
