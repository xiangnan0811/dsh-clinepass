import { isSupportedModel } from './models.js'

export function createModelProbe(ctx, { live, probeRequests, now = Date.now }) {
  let llm
  const pending = new Set(), controllers = new Set()
  let stopped = false
  ctx.inject?.(['llm'], (inner) => { llm = inner.llm })
  async function run(model, { signal, timeoutMs = 30000 } = {}) {
    if (stopped || !llm) throw new Error('Native model probing is unavailable')
    if (!isSupportedModel(model, live())) throw new Error('Unknown model; select a registered ClinePass model')
    const controller = new AbortController()
    controllers.add(controller)
    const combined = AbortSignal.any([controller.signal, signal].filter(Boolean))
    const timer = setTimeout(() => controller.abort(new DOMException('Model probe timed out', 'TimeoutError')), timeoutMs)
    const startedAt = now()
    let ttftMs = null, finish
    try {
      const prepared = await llm.prepareCall({ provider: 'clinebot', model, maxTokens: 1024 }, combined)
      const options = Object.freeze({ ...prepared.config, signal: combined,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with pong.' }] }] })
      probeRequests.add(options)
      for await (const chunk of prepared.stream(options)) {
        if (ttftMs === null && ((['text-delta', 'reasoning-delta'].includes(chunk.type) && chunk.text) || (chunk.type === 'tool-call-delta' && (chunk.name || chunk.argumentsDelta)))) ttftMs = now() - startedAt
        if (chunk.type === 'finish') finish = chunk.reason
      }
      combined.throwIfAborted()
      if (!finish || ['error', 'aborted'].includes(finish.kind)) return { ok: false, model, ttftMs, totalMs: now() - startedAt, error: finish?.failure?.code || 'MISSING_FINISH' }
      if (ttftMs === null) return { ok: false, model, ttftMs, totalMs: now() - startedAt, error: 'EMPTY_RESPONSE' }
      return { ok: true, model, ttftMs, totalMs: now() - startedAt, finish: finish.kind }
    } catch (error) {
      return { ok: false, model, ttftMs, totalMs: now() - startedAt,
        error: combined.aborted ? combined.reason?.name === 'TimeoutError' ? 'PROBE_TIMEOUT' : 'CANCELLED' : typeof error.code === 'string' ? error.code : 'PROBE_FAILED' }
    } finally { clearTimeout(timer); controller.abort(); controllers.delete(controller) }
  }
  return {
    run(model, options) { const task = run(model, options); pending.add(task); task.then(() => pending.delete(task), () => pending.delete(task)); return task },
    async close() { stopped = true; for (const controller of controllers) controller.abort(); await Promise.allSettled(pending) },
  }
}
