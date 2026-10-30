import http from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { writeJson } from './http.js'
import { getAllModels, selectedIds } from './models.js'
import { createSessionRouter } from './session-router.js'
import { ProxyFailure, responseFailure, inspectCompletion, createSseDecoder, raceAbort, readLimitedBody } from './proxy-protocol.js'
import { applyUpstreamPin, upstreamPinFor, reportedUpstreams, upstreamPinFailure, reportedRoutingEvidence } from './upstream-pin.js'

const DEFAULTS = Object.freeze({
  maxRequestBytes: 32 * 1024 * 1024, connectTimeoutMs: 15000,
  firstOutputTimeoutMs: 15000, bodyTimeoutMs: 15000,
  idleTimeoutMs: 30000, totalTimeoutMs: 300000,
})
const HOP_HEADERS = new Set(['host', 'authorization', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'upgrade', 'origin', 'referer', 'x-dsh-desktop-renderer', 'x-clinepass-session', 'x-clinepass-purpose', 'x-clinepass-source'])
const errorCode = (error) => typeof error.code === 'string' ? error.code : error.name === 'AbortError' ? 'CANCELLED' : 'PROXY_ERROR'

function deadline(controller, ms, code) {
  const timer = setTimeout(() => controller.abort(new ProxyFailure('Upstream request timed out', 504, code)), ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

function readRequest(req, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', failed); signal.removeEventListener('abort', aborted) }
    const failed = (error) => { cleanup(); req.resume(); reject(error) }
    const aborted = () => failed(signal.reason)
    const data = (chunk) => {
      size += chunk.length
      if (size > maxBytes) return failed(new ProxyFailure('Full request body exceeds the configured byte budget', 413, 'REQUEST_TOO_LARGE', { retryable: false }))
      chunks.push(chunk)
    }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)) }
    if (signal.aborted) return failed(signal.reason)
    req.on('data', data); req.once('end', end); req.once('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

async function writeChunk(res, chunk, signal) {
  signal.throwIfAborted()
  if (!res.write(chunk)) await once(res, 'drain', { signal })
}

function jsonValue(text) {
  try { return JSON.parse(text) }
  catch { throw new ProxyFailure('Invalid upstream JSON response', 502, 'INVALID_RESPONSE') }
}

function failureResponse(res, error, attempts) {
  if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter)
  writeJson(res, error.status || 502, { error: { message: error.message, type: 'clinepass_proxy_error', code: error.code || 'UPSTREAM_ERROR', ...(error.upstream !== undefined ? { upstream: error.upstream, routingEvidence: error.routingEvidence } : {}) }, attempts })
}

/** One plugin instance owns its socket, token, requests and routing table. */
export function createProxyServer({ snapshot, onRequest, beforeRequest, fetchImpl = fetch, router = createSessionRouter(), limits = {} }) {
  const token = randomBytes(32).toString('hex')
  const expectedAuth = Buffer.from(`Bearer ${token}`)
  const active = new Map()
  const pending = new Set()
  let server, starting, port, stopping = false

  async function attempt(req, res, body, rawBody, account, cfg, policy, rootSignal, metrics) {
    const controller = new AbortController()
    const signal = AbortSignal.any([rootSignal, controller.signal])
    let clearTimer = deadline(controller, policy.connectTimeoutMs, 'CONNECT_TIMEOUT')
    let reader
    const startedAt = Date.now()
    const entry = { account: account.apiKeyEnv, startedAt, status: null, ok: false,
      upstreamPin: metrics.upstreamPin, upstreamPinAttached: metrics.upstreamPinAttached, upstream: '' }
    metrics.attempts.push(entry)
    metrics.upstream = ''
    metrics.routingEvidence = null
    let actual = ''
    const verifyPin = (value, final = false) => {
      metrics.routingEvidence = reportedRoutingEvidence(value, metrics.routingEvidence)
      entry.routingEvidence = metrics.routingEvidence
      for (const name of reportedUpstreams(value)) {
        actual = name
        metrics.upstream = name
        entry.upstream = name
        const failure = upstreamPinFailure(metrics.upstreamPin, name)
        if (failure) throw Object.assign(new ProxyFailure(failure.message, 502, failure.code, { retryable: false }), { upstream: actual })
      }
      if (final) {
        const failure = upstreamPinFailure(metrics.upstreamPin, actual)
        if (failure) throw Object.assign(new ProxyFailure(failure.message, 502, failure.code, { retryable: false }), { upstream: actual })
      }
    }
    try {
      const headers = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (!HOP_HEADERS.has(key) && !key.startsWith('sec-') && typeof value === 'string') headers[key] = value
      }
      headers.authorization = `Bearer ${account.value}`
      headers['content-type'] = 'application/json'
      headers.accept = body.stream ? 'text/event-stream' : 'application/json'
      const response = await raceAbort(fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers, body: rawBody, signal, redirect: 'error',
      }), signal)
      clearTimer()
      entry.status = response.status
      if (!response.ok) {
        clearTimer = deadline(controller, policy.bodyTimeoutMs, 'BODY_TIMEOUT')
        throw await responseFailure(response, signal)
      }
      if (!body.stream) {
        clearTimer = deadline(controller, policy.bodyTimeoutMs, 'BODY_TIMEOUT')
        const text = await readLimitedBody(response, signal, 10 * 1024 * 1024)
        const value = jsonValue(text)
        const inspected = inspectCompletion(value)
        if (!inspected.meaningful) throw new ProxyFailure('Upstream returned no model output', 502, 'EMPTY_RESPONSE')
        metrics.usage = inspected.usage ?? null
        verifyPin(value, true)
        metrics.ttftMs = null // A non-streaming completion is not a TTFT measurement.
        metrics.account = account.apiKeyEnv
        metrics.committed = true
        writeJson(res, 200, value)
        entry.ok = true
        return
      }
      if (!response.body) throw new ProxyFailure('Upstream returned no response body', 502, 'EMPTY_RESPONSE')
      // A gateway returning a JSON error with HTTP 200 must not commit a stream.
      if (response.headers.get('content-type')?.includes('application/json')) {
        clearTimer = deadline(controller, policy.bodyTimeoutMs, 'BODY_TIMEOUT')
        inspectCompletion(jsonValue(await readLimitedBody(response, signal, 10 * 1024 * 1024)))
        throw new ProxyFailure('Upstream returned JSON for a streaming request', 502, 'INVALID_RESPONSE')
      }
      reader = response.body.getReader()
      const decoder = createSseDecoder()
      let pendingFrames = ''
      let terminal = false
      let ended = false
      clearTimer = deadline(controller, policy.firstOutputTimeoutMs, 'FIRST_OUTPUT_TIMEOUT')
      const processFrames = async (frames) => {
        for (const frame of frames) {
          if (frame.data === '[DONE]') {
            if (!metrics.committed) throw new ProxyFailure('Upstream finished without model output', 502, 'EMPTY_RESPONSE')
            verifyPin(null, true)
            terminal = true
            ended = true
          } else if (frame.data) {
            const value = jsonValue(frame.data)
            const inspected = inspectCompletion(value)
            if (inspected.usage !== undefined) metrics.usage = inspected.usage
            verifyPin(value)
            terminal ||= inspected.terminal
            if (inspected.meaningful && !metrics.committed) {
              metrics.committed = true
              metrics.account = account.apiKeyEnv
              metrics.ttftMs = Date.now() - metrics.startedAt
              res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform' })
              clearTimer()
              if (pendingFrames) await writeChunk(res, pendingFrames, signal)
              pendingFrames = ''
            }
          }
          if (metrics.committed) await writeChunk(res, frame.raw, signal)
          else if (frame.data) {
            pendingFrames += frame.raw
            if (Buffer.byteLength(pendingFrames) > 256 * 1024) throw new ProxyFailure('Upstream pre-output data exceeded its size limit', 502, 'PRELUDE_TOO_LARGE')
          }
          if (ended) return
        }
      }
      while (!ended) {
        const { done, value } = await raceAbort(reader.read(), signal)
        if (done) {
          await processFrames(decoder.finish())
          break
        }
        await processFrames(decoder.push(value))
        if (metrics.committed) {
          clearTimer()
          clearTimer = deadline(controller, policy.idleTimeoutMs, 'STREAM_IDLE_TIMEOUT')
        }
      }
      if (!metrics.committed) throw new ProxyFailure('Upstream stream contained no model output', 502, 'EMPTY_RESPONSE')
      if (!terminal) throw new ProxyFailure('Upstream stream ended without a finish event', 502, 'TRUNCATED_STREAM')
      verifyPin(null, true)
      entry.ok = true
      res.end()
    } catch (error) {
      const failure = rootSignal.aborted ? rootSignal.reason : error instanceof ProxyFailure ? error
        : controller.signal.aborted ? controller.signal.reason : new ProxyFailure('Upstream connection failed', 502, 'UPSTREAM_NETWORK', { cause: error })
      entry.code = errorCode(failure)
      entry.status ??= failure.status || null
      if (failure.upstream !== undefined) failure.routingEvidence = metrics.routingEvidence
      throw failure
    } finally {
      clearTimer()
      controller.abort()
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
      entry.latencyMs = Date.now() - startedAt
    }
  }

  async function handle(req, res) {
    const auth = Buffer.from(typeof req.headers.authorization === 'string' ? req.headers.authorization : '')
    if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) return writeJson(res, 401, { error: { code: 'AUTH', message: 'Proxy authentication required' } })
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
      || req.headers.host !== `127.0.0.1:${port}` || req.headers.origin || req.headers.referer
      || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'none')) {
      return writeJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Only authenticated loopback model requests are accepted' } })
    }
    const url = req.url?.split('?')[0]
    if (url !== '/v1/chat/completions' && url !== '/v1/models') return writeJson(res, 404, { error: { code: 'NOT_FOUND' } })
    if (req.method !== (url === '/v1/models' ? 'GET' : 'POST')) return writeJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } })
    const controller = new AbortController()
    const signal = controller.signal
    const id = randomUUID()
    const metrics = { id, source: 'proxy', transport: 'proxy', usageFormat: 'openai', provider: 'clinebot', startedAt: Date.now(), model: '', sessionId: '', account: '', attempts: [], usage: null, ttftMs: null, committed: false, ok: false }
    const clientClosed = () => { if (!res.writableFinished) controller.abort(new DOMException('Model caller disconnected', 'AbortError')) }
    const requestAborted = () => controller.abort(new DOMException('Model caller cancelled', 'AbortError'))
    res.on('close', clientClosed); res.on('error', requestAborted); req.on('aborted', requestAborted)
    active.set(id, controller)
    let clearTotal = deadline(controller, limits.totalTimeoutMs || DEFAULTS.totalTimeoutMs, 'REQUEST_TIMEOUT')
    try {
      const state = await raceAbort(snapshot(), signal)
      const cfg = state.config
      const policy = { ...DEFAULTS, ...limits, ...cfg.proxyLimits }
      clearTotal()
      clearTotal = deadline(controller, Math.max(1, policy.totalTimeoutMs - (Date.now() - metrics.startedAt)), 'REQUEST_TIMEOUT')
      if (!cfg.enabled || !cfg.proxyEnabled || stopping) throw new ProxyFailure('Proxy mode is disabled', 503, 'PROXY_DISABLED', { retryable: false })
      if (url === '/v1/models') {
        const models = getAllModels(cfg)
        const enabled = new Set(selectedIds(models, cfg))
        return writeJson(res, 200, { object: 'list', data: models.filter((model) => enabled.has(model.id)).map((model) => ({ id: model.id, object: 'model', owned_by: 'clinepass' })) })
      }
      let rawBody = await readRequest(req, signal, policy.maxRequestBytes)
      let body
      try { body = JSON.parse(rawBody.toString('utf8')) } catch { throw new ProxyFailure('Invalid request JSON', 400, 'INVALID_REQUEST', { retryable: false }) }
      if (!body || Array.isArray(body) || typeof body.model !== 'string' || !body.model || !Array.isArray(body.messages)
        || body.model.length > 256 || /[\x00-\x1f\x7f]/.test(body.model)
        || (body.stream !== undefined && typeof body.stream !== 'boolean')) throw new ProxyFailure('model, messages and a boolean stream flag are required', 400, 'INVALID_REQUEST', { retryable: false })
      metrics.model = body.model
      const modelIds = getAllModels(cfg).map(model => model.id)
      try { await beforeRequest?.() }
      catch (error) { metrics.budgetBlocked = true; throw new ProxyFailure(error.message, 403, error.code || 'BUDGET_EXCEEDED', { retryable: false }) }
      if (!modelIds.includes(body.model)) throw new ProxyFailure('Unknown model; add it to the plugin model list first', 400, 'UNKNOWN_MODEL', { retryable: false })
      metrics.upstreamPin = upstreamPinFor(cfg, body.model)
      metrics.upstreamPinAttached = false
      res.setHeader('X-ClinePass-Upstream-Pin', metrics.upstreamPin)
      if (metrics.upstreamPin) {
        body = applyUpstreamPin(body, metrics.upstreamPin)
        rawBody = Buffer.from(JSON.stringify(body))
        if (rawBody.length > policy.maxRequestBytes) throw new ProxyFailure('Pinned request exceeds the configured byte budget', 413, 'REQUEST_TOO_LARGE', { retryable: false })
        metrics.upstreamPinAttached = true
      }
      res.setHeader('X-ClinePass-Upstream-Pin-Attached', metrics.upstreamPinAttached ? '1' : '0')
      const session = req.headers['x-clinepass-session']
      const decodedSession = typeof session === 'string' && session.startsWith('b64:') ? Buffer.from(session.slice(4), 'base64url').toString('utf8') : session
      metrics.sessionId = typeof decodedSession === 'string' && decodedSession.length <= 256 ? decodedSession : ''
      const purpose = req.headers['x-clinepass-purpose']
      if (purpose === 'session-title' || purpose === 'compaction') metrics.purpose = purpose
      if (req.headers['x-clinepass-source'] === 'probe') metrics.source = 'probe'
      if (state.isCurrent?.() === false) throw new ProxyFailure('Account configuration changed; retry with current settings', 409, 'CONFIGURATION_CHANGED', { retryable: false })
      const route = router.plan({ accounts: state.accounts, baseUrl: cfg.baseUrl, sessionId: metrics.sessionId, model: body.model,
        activeAccount: cfg.activeAccount, strategy: cfg.accountMode, modelRoutes: cfg.modelRoutes, modelIds })
      metrics.route = route.reason
      let last = new ProxyFailure('No account is available; configure a key or wait for cooldown recovery', 503, 'NO_AVAILABLE_ACCOUNTS')
      if (!route.accounts.length) {
        const remaining = router.status().cooldowns.map((entry) => entry.remainingMs)
        if (remaining.length) last.retryAfter = String(Math.max(1, Math.ceil(Math.min(...remaining) / 1000)))
      }
      for (const account of route.accounts) {
        try {
          await attempt(req, res, body, rawBody, account, cfg, policy, signal, metrics)
          if (state.isCurrent?.() !== false) route.commit(account)
          metrics.ok = true
          return
        } catch (error) {
          if (signal.aborted) throw signal.reason
          last = error
          if (error.retryable && state.isCurrent?.() !== false) route.fail(account, error)
          if (metrics.committed || !error.retryable) throw error
          if (state.isCurrent?.() === false) throw new ProxyFailure('Account configuration changed; retry with current settings', 409, 'CONFIGURATION_CHANGED', { retryable: false })
          metrics.usage = null
        }
      }
      throw last
    } catch (error) {
      metrics.error = { code: errorCode(error), status: error.status || null }
      if (res.destroyed || res.writableEnded) return
      if (metrics.committed) {
        const failure = { code: error.code || 'STREAM_ERROR', message: error.message, ...(error.upstream !== undefined ? { upstream: error.upstream, routingEvidence: error.routingEvidence } : {}) }
        // OpenAI's SDK throws on an error frame before invoking raw event
        // observers. A local metadata frame preserves the typed pin failure.
        const pinFrame = error.upstream !== undefined ? `data: ${JSON.stringify({ clinepass_pin_failure: failure })}\n\n` : ''
        res.end(`${pinFrame}data: ${JSON.stringify({ error: failure })}\n\ndata: [DONE]\n\n`)
      } else failureResponse(res, error, metrics.attempts.length)
    } finally {
      clearTotal()
      controller.abort()
      req.off('aborted', requestAborted); res.off('close', clientClosed); res.off('error', requestAborted)
      active.delete(id)
      if (metrics.model && !metrics.budgetBlocked) {
        metrics.latencyMs = Date.now() - metrics.startedAt
        try { await onRequest?.(metrics) } catch { /* metrics storage owns its error report */ }
      }
    }
  }

  return {
    token, router,
    get baseUrl() { return port ? `http://127.0.0.1:${port}/v1` : '' },
    get port() { return port },
    status() { return { listening: !!port, activeRequests: active.size, ...router.status() } },
    async start() {
      if (port) return port
      if (starting) return starting
      stopping = false
      server = http.createServer((req, res) => {
        const task = handle(req, res).catch(() => { if (!res.writableEnded && !res.destroyed) writeJson(res, 500, { error: { code: 'PROXY_INTERNAL_ERROR' } }) })
        pending.add(task)
        task.then(() => pending.delete(task), () => pending.delete(task))
      })
      server.headersTimeout = 15000
      starting = new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject)
          port = server.address().port
          server.unref()
          resolve(port)
        })
      })
      try { return await starting } finally { starting = undefined }
    },
    async stop() {
      stopping = true
      for (const controller of active.values()) controller.abort(new ProxyFailure('Proxy is shutting down', 503, 'PROXY_STOPPED', { retryable: false }))
      if (starting) await starting.catch(() => {})
      if (!server?.listening) { port = undefined; await Promise.allSettled(pending); return }
      const stopped = new Promise((resolve) => server.close(resolve))
      server.closeAllConnections()
      await stopped
      await Promise.allSettled(pending)
      port = undefined
      router.reset()
    },
  }
}
