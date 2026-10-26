import { AsyncResource } from 'node:async_hooks'

// Retain only the scheduling context across package HMR. Configuration and
// adapter ownership remain per instance; the host still owns every write lock.
const key = Symbol.for('dsh-clinepass.native-lifecycle')
const states = globalThis[key] ||= new WeakMap()
const directInitializations = new WeakMap()
const cancelled = () => new DOMException('ClinePass instance is no longer active', 'AbortError')

function createState(root, hmr, editor) {
  const state = { root, hmr, editor, owner: null, resource: null, probing: null, closed: false, jobs: new Set() }
  state.assert = (owner) => { if (state.closed || (owner && (!owner.alive || state.owner !== owner))) throw cancelled() }
  state.start = (job) => {
    if (!state.resource || job.started || !state.jobs.has(job)) return
    job.started = true
    const settle = (method, value) => { state.jobs.delete(job); job[method](value) }
    try {
      state.assert(job.owner)
      Promise.resolve(state.resource.runInAsyncScope(job.operation)).then(value => settle('resolve', value), error => settle('reject', error))
    } catch (error) { settle('reject', error) }
  }
  state.run = (owner, operation) => {
    try { state.assert(owner) } catch (error) { return Promise.reject(error) }
    let job
    const promise = new Promise((resolve, reject) => { job = { owner, operation, resolve, reject, started: false } })
    state.jobs.add(job)
    state.start(job)
    return promise
  }
  state.capture = () => {
    if (state.resource || state.closed) return null
    if (state.probing) return state.probing
    const resource = new AsyncResource('ClinePass configuration lifecycle', { requireManualDestroy: true })
    // A cold application or authenticated HTTP callback is outside HMR. A
    // first live install may be inside it; only a successful public queue probe
    // establishes a reusable context. No private HMR storage is inspected.
    state.probing = Promise.resolve(resource.runInAsyncScope(() => hmr.runExclusive(async () => {}))).then(() => {
      if (state.closed) { resource.emitDestroy(); return }
      state.resource = resource
      for (const job of state.jobs) state.start(job)
    }, () => { resource.emitDestroy() }).finally(() => { state.probing = null })
    return state.probing
  }
  state.release = (owner) => {
    owner.alive = false
    if (state.owner === owner) state.owner = null
    for (const job of state.jobs) if (job.owner === owner) { state.jobs.delete(job); job.reject(cancelled()) }
  }
  root.effect(() => () => {
    state.closed = true
    if (state.owner) state.release(state.owner)
    for (const job of state.jobs) job.reject(cancelled())
    state.jobs.clear()
    state.resource?.emitDestroy()
    states.delete(root)
  }, 'dsh-clinepass: configuration execution context')
  state.capture()
  return state
}

/** Initialize from a live request if the first plugin apply ran inside HMR. */
export function captureNativeLifecycle(ctx) {
  const root = ctx.root || ctx
  const state = states.get(root)
  const capture = state?.capture()
  const wait = () => (state?.owner?.initializing ? state.owner.initialization : directInitializations.get(root))?.catch(() => {})
  return capture ? capture.then(wait) : wait()
}

export function createNativeLifecycle(ctx) {
  const root = ctx.root
  const hmr = ctx.get?.('hmr'), editor = ctx.get?.('configEditor')
  if (!root || !hmr?.runExclusive || !editor?.edit) {
    // Cold hosts may provide config-editor before HMR. Requests still need to
    // wait for persisted loopback addresses to be replaced during startup.
    const scope = root || ctx
    let pending
    return {
      run: operation => operation(),
      initialize(operation) {
        const promise = Promise.resolve().then(operation)
        pending = promise
        directInitializations.set(scope, promise)
        const clear = () => { if (directInitializations.get(scope) === promise) directInitializations.delete(scope) }
        promise.then(clear, clear)
        return promise
      },
      release() { if (directInitializations.get(scope) === pending) directInitializations.delete(scope) },
    }
  }
  let state = states.get(root)
  if (!state) { state = createState(root, hmr, editor); states.set(root, state) }
  if (state.owner) state.release(state.owner)
  const owner = { alive: true, initializing: false }
  state.owner = owner
  const run = operation => state.run(owner, operation)
  return {
    run,
    initialize(operation) {
      owner.initializing = true
      owner.initialization = run(operation)
      owner.initialization.then(() => { owner.initializing = false }, () => { owner.initializing = false })
      return owner.initialization
    },
    edit(id, change) {
      return run(async () => {
        const entry = editor.entries().find(row => row.options.id === id)
        if (!entry) throw new Error('ClinePass configuration entry is unavailable')
        let applied
        await editor.edit(entry, (current, inherited) => {
          state.assert(owner)
          applied = structuredClone(change(current, inherited))
          return applied
        })
        state.assert(owner)
        return applied
      })
    },
    release() { state.release(owner) },
    restore(profile) {
      // Schema dictionaries carry non-enumerable validator metadata. The
      // native provider must receive raw data, not a different schema's output.
      const rawProfile = structuredClone(profile)
      // Do not await this from teardown: the current HMR operation must finish
      // before config-editor can acquire its existing transaction and file lock.
      return state.run(null, async () => {
        await hmr.runExclusive(async () => {})
        const entry = editor.entries().find(row => row.options.id === 'llm-pi-ai')
        if (!entry) throw new Error('Native provider configuration entry is unavailable')
        await editor.edit(entry, current => {
          state.assert(null)
          if (state.owner || current.providers?.clinebot) throw cancelled()
          return { ...current, providers: { ...current.providers, clinebot: rawProfile } }
        })
      })
    },
  }
}
