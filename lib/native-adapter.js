import { AsyncLocalStorage } from 'node:async_hooks'

const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** A ClinePass-only profile over the public PiAiAdapter and protocol APIs.
 * The native adapter still owns messages, attachments, replay and wire mapping.
 * We own route metadata before freeze and session-only transport headers.
 */
export function createClineAdapter({ PiAiAdapter, Config, LlmError, resolveRetryPolicy, resolveImageAttachmentAccess, openAICompletionsApi }, { state, resolveKey, getAttachments, getFs, noteDispatch }) {
  const callScope = new AsyncLocalStorage()
  const api = openAICompletionsApi()
  let memoKey, profiles
  const profileSnapshot = () => {
    const current = state()
    const key = JSON.stringify(current.profile)
    if (key === memoKey && profiles) return profiles
    // Detach Schemastery's nested parse markers before the native schema parses
    // the profile again. A marked dictionary is otherwise mistaken for a schema.
    const raw = current.profile && structuredClone(current.profile)
    if (!raw) { memoKey = key; profiles = new Map(); return profiles }
    const parsed = Config({ providers: { clinebot: raw } })
    const source = (typeof parsed.providers.get === 'function' ? parsed.providers.get() : parsed.providers).clinebot
    if (source.api !== 'openai-completions') throw new LlmError('ClinePass requires the openai-completions protocol', 'INVALID_CONFIG')
    const connectionIsProxy = /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(source.baseURL) && /^CLINEBOT_PROXY_KEY_\d+$/.test(source.apiKeyEnv)
    const models = (source.models || []).map((entry) => {
      const efforts = entry.reasoningEfforts
      const thinkingLevelMap = Object.fromEntries(EFFORTS.flatMap((level) => {
        const wire = efforts && efforts[level]
        return wire === null ? [] : [[level, typeof wire === 'string' ? wire : null]]
      }))
      // The extension can distinguish an explicit Off from the absent default.
      // This path is verified against the native DeepSeek wire serializer.
      if ((entry.compat?.thinkingFormat || source.compat?.thinkingFormat) === 'deepseek') delete thinkingLevelMap.off
      return { id: entry.id, name: entry.name || entry.id, provider: 'clinebot', api: 'openai-completions', baseUrl: source.baseURL,
        contextWindow: entry.contextWindow ?? source.defaultContextWindow ?? 262144,
        maxTokens: entry.maxTokens ?? source.defaultMaxTokens ?? 32768,
        input: entry.input || source.defaultInput || ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: !!efforts && typeof efforts === 'object', thinkingLevelMap,
        compat: { ...source.compat, ...entry.compat } }
    })
    const sendOptions = (options) => {
      const metrics = callScope.getStore()?.metrics
      return { ...options, ...(connectionIsProxy ? { headers: { ...options.headers,
        ...(options.sessionId ? { 'x-clinepass-session': `b64:${Buffer.from(String(options.sessionId)).toString('base64url')}` } : {}),
        ...(callScope.getStore()?.purpose ? { 'x-clinepass-purpose': callScope.getStore().purpose } : {}),
      } } : {}), ...(metrics ? { onProviderStreamEvent: async (data, model) => {
        if (data?.usage !== undefined) metrics.wireUsage = data.usage
        await options.onProviderStreamEvent?.(data, model)
      } } : {}) }
    }
    const piProvider = {
      id: 'clinebot', name: source.displayName || 'ClinePass', baseUrl: source.baseURL,
      auth: { apiKey: { name: 'DSH credentials', resolve: ({ credential }) => Promise.resolve({ auth: { apiKey: credential?.key }, source: 'DSH credentials' }) } },
      getModels: () => models,
      stream: (model, context, options) => api.stream(model, context, sendOptions(options)),
      streamSimple: (model, context, options) => api.streamSimple(model, context, sendOptions(options)),
    }
    profiles = new Map([['clinebot', { ...source, provider: 'clinebot', displayName: source.displayName || 'ClinePass', piProvider,
      streamIdleTimeoutMs: source.streamIdleTimeoutMs ?? 300000,
      maxRequestImageBytes: source.maxRequestImageBytes ?? 20971520,
      requestImagePixelBudget: source.requestImagePixelBudget ?? 4194304,
      requestImageMaxBytes: source.requestImageMaxBytes ?? 1048576,
      retryPolicy: resolveRetryPolicy(source.retryPolicy), modelErrors: new Map(),
      configuredMaxTokens: new Map(source.models.filter((model) => model.maxTokens !== undefined).map((model) => [model.id, model.maxTokens])),
    }]])
    memoKey = key
    return profiles
  }
  const applyDefault = (model, overrides) => {
    const effort = overrides?.find((row) => row.id === model.id)?.defaultReasoning
    if (!effort || effort === 'inherit' || !model.reasoning) return model
    if (!model.reasoning.efforts.some((option) => option.id === effort)) throw new LlmError(`ClinePass model "${model.id}" cannot use default effort "${effort}"`, 'UNSUPPORTED_REASONING_EFFORT')
    return { ...model, reasoning: { ...model.reasoning, defaultEffort: effort } }
  }
  return new class extends PiAiAdapter {
    constructor() {
      super({ profiles: profileSnapshot, resolveApiKey: async (_provider, profile) => {
        const key = await resolveKey(profile.apiKeyEnv)
        if (!key) throw new LlmError(`ClinePass credential ${profile.apiKeyEnv} is not configured`, 'MISSING_CREDENTIAL')
        return key
      }, auth: {
        // This provider has no library-owned login or ambient fallback. Every
        // operation resolves its explicit reference through the host seam.
        credentials: { read: async () => undefined, list: async () => [], modify: async () => { throw new Error('Use DSH credentials to change ClinePass keys') }, delete: async () => {} },
        authContext: { env: async () => undefined, fileExists: async () => false },
      }, resolveAttachments: getAttachments,
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, (file) => getFs()?.processPathFromHostPath(file), ref),
      })
    }
    async resolveModel(provider, model, signal) {
      const overrides = structuredClone(state().overrides)
      return applyDefault(await super.resolveModel(provider, model, signal), overrides)
    }
    async prepareCall(provider, model, signal) {
      const overrides = structuredClone(state().overrides)
      const imagePolicy = structuredClone(state().imagePolicy)
      const profile = profileSnapshot().get(provider)
      const transport = /^CLINEBOT_PROXY_KEY_\d+$/.test(profile?.apiKeyEnv) ? 'proxy' : 'direct'
      const prepared = await super.prepareCall(provider, model, signal)
      return { model: applyDefault(prepared.model, overrides), stream: (options) => {
        const metrics = { transport, account: profile.apiKeyEnv, usageFormat: 'openai', wireUsage: null }
        noteDispatch?.(options, metrics)
        if (imagePolicy?.enabled) {
          const latestInput = options.messages.findLastIndex((message) => message.role === 'user' || message.role === 'tool')
          const historical = options.messages.slice(0, Math.max(0, latestInput))
            .filter((message) => message.role === 'user' || message.role === 'tool')
            .flatMap((message) => message.content).filter((block) => block.type === 'image' && block.offloaded !== true).length
          const count = historical - imagePolicy.keep
          if (count > 0) throw new LlmError('ClinePass historical image policy requires a logged image/offload decision before retry', 'IMAGE_OFFLOAD_REQUIRED', { offloadImages: count })
        }
        const iterator = prepared.stream(options)[Symbol.asyncIterator]()
        const scope = { purpose: options.purpose, metrics }
        return {
          [Symbol.asyncIterator]() { return this },
          next: (...args) => callScope.run(scope, () => iterator.next(...args)),
          return: (...args) => callScope.run(scope, () => iterator.return(...args)),
          throw: (...args) => callScope.run(scope, () => iterator.throw(...args)),
        }
      } }
    }
  }()
}
