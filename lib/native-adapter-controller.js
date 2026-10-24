import { createClineAdapter } from './native-adapter.js'
import { getAllModels } from './models.js'
import { resolveKeyValue } from './cline-client.js'
import { readProvider, removePiAiProvider } from './provider-sync.js'
import { NS } from './config.js'

async function loadNative() {
  const [pi, llm, protocol] = await Promise.all([
    import('@deepseek-ai/dsh-llm-pi-ai'), import('@deepseek-ai/dsh-llm'),
    import('@earendil-works/pi-ai/api/openai-completions.lazy'),
  ])
  return { ...pi, ...llm, ...protocol }
}

export function createNativeAdapterController(ctx, { live, persist, nativeLoader = loadNative, noteDispatch, deferRestore }) {
  let service, scope, adapter, registration, directory, discovery, dependencies
  let error = ''
  let disposed = false
  ctx.inject?.(['llm'], (inner) => {
    service = inner.llm
    scope = inner
    inner.effect?.(() => () => { registration?.(); directory?.(); discovery?.(); registration = directory = discovery = undefined; service = undefined })
  })

  function syncRegistration() {
    if (disposed) throw new DOMException('ClinePass adapter is disposed', 'AbortError')
    const rows = live().nativeProvider?.models || []
    if (rows.length && !registration) registration = service.registerAdapter(['clinebot'], adapter)
    else registration?.replace(rows.length ? ['clinebot'] : [])
    if (!directory) directory = service.registerConfigurableProviders([{
      provider: 'clinebot', displayName: 'ClineBot (ClinePass)', settingsNs: NS,
      settingsPath: ['nativeProvider'], declared: true,
    }])
    if (!discovery) discovery = service.registerModelDiscovery(NS, async (_request, signal) => {
      signal?.throwIfAborted()
      return getAllModels(live()).map((model) => ({ id: model.id, name: model.name, ...(model.contextKnown ? { contextWindow: model.contextWindow } : {}), input: model.input }))
    })
  }

  const store = {
    read: async () => live().nativeProvider,
    async write(payload, options = {}) {
      if (JSON.stringify(live().nativeProvider) === JSON.stringify(payload)) { syncRegistration(); return }
      await persist((cfg) => {
        if (options.expected !== undefined && JSON.stringify(cfg.nativeProvider) !== JSON.stringify(options.expected)) throw new Error('Native model settings changed during synchronization; retry')
        return { nativeProvider: payload }
      })
      syncRegistration()
    },
    async patch(update) { await persist((cfg) => ({ nativeProvider: update(cfg.nativeProvider) })); syncRegistration() },
    async remove() {
      // Hiding all models must retain provider headers and native controls so a
      // later selection (including after restart) can restore the same profile.
      if (live().nativeProvider?.models?.length) await persist((cfg) => ({ nativeProvider: cfg.nativeProvider ? { ...cfg.nativeProvider, models: [] } : null }))
      registration?.replace([])
    },
  }

  return {
    get store() { return live().nativeAdapterEnabled ? store : undefined },
    status() { return { enabled: live().nativeAdapterEnabled, ready: !!adapter && !!service, error,
      configurationAvailable: ctx.settings?.describe?.().some((row) => row.ns === NS && row.value?.nativeProvider != null) || false,
    } },
    async prepare(cfg) {
      // Usage observation also needs the public protocol event callback. The
      // stock native adapter synthesizes zero counters when wire usage is absent.
      const requested = (!!noteDispatch && !!service) || cfg.nativeAdapterEnabled || cfg.proxyEnabled || cfg.upstreamPins?.length || cfg.historyImageOffload || cfg.modelOverrides?.some((row) => row.defaultReasoning && row.defaultReasoning !== 'inherit')
      if (!requested) return undefined
      if (disposed || !service) throw new Error('ClinePass adapter extensions require the next native llm service')
      try {
        if (cfg.historyImageOffload && !scope.get('sessions')?.messageProjections?.some((projection) => projection.type === 'image/offload')) throw new Error('Enable the host image-offload plugin before using historical image offload')
        dependencies ||= await nativeLoader()
        if (disposed) throw new DOMException('ClinePass adapter is disposed', 'AbortError')
        if (cfg.historyImageOffload && typeof dependencies.requiredImageOffload !== 'function') throw new Error('Historical image offload requires next dsh-llm dependencies; reinstall the plugin dependencies before enabling it')
        if (!adapter) adapter = createClineAdapter(dependencies, {
          state: () => ({ profile: live().nativeProvider, overrides: live().modelOverrides,
            upstreamPins: live().upstreamPins,
            imagePolicy: { enabled: live().historyImageOffload, keep: live().historyImagesToKeep } }),
          resolveKey: async (ref) => (await resolveKeyValue(ctx, ref)).value,
          getAttachments: () => scope.get('attachments'), getFs: () => scope.get('fs'),
          noteDispatch,
        })
        const legacy = await readProvider(ctx)
        if (legacy) {
          // Preserve the native document before changing route ownership. Old
          // prepared calls retain their original adapter generation in DSH.
          await persist({ nativeAdapterEnabled: true, nativeProvider: legacy })
          await removePiAiProvider(ctx)
        } else if (!live().nativeAdapterEnabled) await persist({ nativeAdapterEnabled: true })
        syncRegistration()
        error = ''
        return store
      } catch (failure) {
        error = String(failure.message || failure)
        throw failure
      }
    },
    async dispose(restoreProfile = (profile) => profile) {
      disposed = true
      registration?.(); directory?.(); discovery?.()
      registration = directory = discovery = undefined
      const profile = live().nativeProvider
      if (live().enabled !== false && profile) {
        const restored = restoreProfile(profile)
        if (deferRestore) {
          deferRestore(restored).catch(error => { if (error.name !== 'AbortError') ctx.root?.logger?.warn('ClinePass native provider restoration failed; saved settings are retained') })
        } else await ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'clinebot'], value: restored }])
      }
    },
  }
}
