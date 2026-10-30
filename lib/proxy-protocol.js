export class ProxyFailure extends Error {
  constructor(message, status = 502, code = 'UPSTREAM_ERROR', { retryable = true, retryAfter, retryAfterMs, cause } = {}) {
    super(message, { cause })
    Object.assign(this, { status, code, retryable, retryAfter, retryAfterMs })
  }
}

const ERROR_CODES = new Map([
  ...['request_too_large', 'payload_too_large', 'too_many_json_nodes', 'too_many_nodes', 'request_body_too_large', '413'].map(code => [code, 'REQUEST_TOO_LARGE']),
  ...['context_length_exceeded', 'context_window_exceeded', 'max_context_length_exceeded'].map(code => [code, 'CONTEXT_WINDOW_EXCEEDED']),
  ...['insufficient_credits', 'insufficient_credit_balance', '402'].map(code => [code, 'INSUFFICIENT_CREDITS']),
  ...['rate_limit', 'rate_limit_exceeded', '429'].map(code => [code, 'RATE_LIMIT']),
  ...['quota', 'insufficient_quota', 'quota_exceeded'].map(code => [code, 'QUOTA']),
  ...['auth', 'invalid_api_key', 'authentication_error'].map(code => [code, 'AUTH']),
])
const MESSAGES = {
  INSUFFICIENT_CREDITS: 'ClinePass has insufficient credits for this model (HTTP 402). Check model access or use another model/account.',
  REQUEST_TOO_LARGE: 'ClinePass request is too large. Start a new session or reduce messages and images.',
  CONTEXT_WINDOW_EXCEEDED: 'ClinePass context window exceeded. Reduce the conversation token count or start a new session.',
  RATE_LIMIT: 'ClinePass rate limit exceeded.', QUOTA: 'ClinePass account quota exhausted.', AUTH: 'ClinePass authentication failed.',
}

export function httpFailure(status, retryAfter, now = Date.now(), payload) {
  const seconds = retryAfter ? Number(retryAfter) : NaN
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now
  const structured = ERROR_CODES.get(String(payload?.error?.code || payload?.error?.type || '').toLowerCase())
  const code = status === 429 ? 'RATE_LIMIT' : status === 402 ? 'INSUFFICIENT_CREDITS' : status === 413 ? 'REQUEST_TOO_LARGE'
    : status === 401 || status === 403 ? 'AUTH' : status === 400 && ['REQUEST_TOO_LARGE', 'CONTEXT_WINDOW_EXCEEDED'].includes(structured) ? structured : 'UPSTREAM_HTTP'
  return new ProxyFailure(MESSAGES[code] || `Upstream returned HTTP ${status}`, status, code, {
      retryable: !['REQUEST_TOO_LARGE', 'CONTEXT_WINDOW_EXCEEDED'].includes(code) && ([401, 402, 403, 408, 429].includes(status) || status >= 500),
      retryAfter, retryAfterMs: Number.isFinite(delay) && delay > 0 ? delay : undefined,
    })
}

export function errorPayload(value) {
  const error = value.error
  const code = ERROR_CODES.get(String(error?.code || error?.type || '').toLowerCase())
  const suppliedStatus = Number(error?.status ?? error?.status_code)
  const status = Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599 ? suppliedStatus
    : code === 'INSUFFICIENT_CREDITS' ? 402 : ['RATE_LIMIT', 'QUOTA'].includes(code) ? 429 : code === 'AUTH' ? 401
      : ['REQUEST_TOO_LARGE', 'CONTEXT_WINDOW_EXCEEDED'].includes(code) ? 400 : 502
  const failure = httpFailure(status, undefined, Date.now(), value)
  if (code === 'QUOTA' && status === 429 && !(suppliedStatus >= 400 && suppliedStatus <= 599)) { failure.code = code; failure.message = MESSAGES[code] }
  return failure
}

/** Read only bounded error metadata under the caller's existing deadline. */
export async function responseFailure(response, signal) {
  let payload
  try { payload = JSON.parse(await readLimitedBody(response, signal, 64 * 1024)) } catch { /* HTTP status remains authoritative */ }
  return httpFailure(response.status, response.headers.get('retry-after'), Date.now(), payload)
}

export function inspectCompletion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProxyFailure('Invalid upstream response', 502, 'INVALID_RESPONSE')
  if (value.error) throw errorPayload(value)
  const choices = Array.isArray(value.choices) ? value.choices : []
  const hasText = (part) => typeof part === 'string' ? part.length > 0 : Array.isArray(part) && part.some((block) => typeof block?.text === 'string' && block.text.length)
  const meaningful = choices.some((choice) => {
    const delta = choice.delta || choice.message || {}
    return hasText(delta.content) || hasText(delta.reasoning_content) || hasText(delta.reasoning) || hasText(delta.thinking)
      || (Array.isArray(delta.tool_calls) && delta.tool_calls.some((call) => call.function?.name || call.function?.arguments))
      || delta.function_call?.name || delta.function_call?.arguments
  })
  return { meaningful: !!meaningful, terminal: choices.some((choice) => choice.finish_reason != null), usage: value.usage }
}

// Parse complete SSE events, retaining the original framing for transparent
// forwarding. A network read can split UTF-8, CRLF, JSON, or an entire event.
export function createSseDecoder({ maxFrameBytes = 1024 * 1024 } = {}) {
  let buffer = ''
  const decoder = new TextDecoder()
  function drain() {
    const frames = []
    while (true) {
      const boundary = /\r?\n\r?\n/.exec(buffer)
      if (!boundary) break
      const end = boundary.index + boundary[0].length
      const raw = buffer.slice(0, end)
      buffer = buffer.slice(end)
      if (Buffer.byteLength(raw) > maxFrameBytes) throw new ProxyFailure('Upstream SSE event exceeded its size limit', 502, 'FRAME_TOO_LARGE')
      const data = raw.split(/\r?\n/).filter((line) => line === 'data' || line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, '')).join('\n')
      frames.push({ raw, data })
    }
    if (Buffer.byteLength(buffer) > maxFrameBytes) throw new ProxyFailure('Upstream SSE event exceeded its size limit', 502, 'FRAME_TOO_LARGE')
    return frames
  }
  return {
    push(bytes) { buffer += decoder.decode(bytes, { stream: true }); return drain() },
    finish() {
      buffer += decoder.decode()
      const frames = drain()
      if (buffer.trim()) throw new ProxyFailure('Upstream ended inside an SSE event', 502, 'TRUNCATED_STREAM')
      return frames
    },
  }
}

export async function raceAbort(promise, signal) {
  signal.throwIfAborted()
  let listener
  const aborted = new Promise((_, reject) => {
    listener = () => reject(signal.reason)
    signal.addEventListener('abort', listener, { once: true })
  })
  try { return await Promise.race([promise, aborted]) }
  finally { signal.removeEventListener('abort', listener) }
}

export async function readLimitedBody(response, signal, maxBytes) {
  const reader = response.body?.getReader()
  if (!reader) throw new ProxyFailure('Missing upstream response body', 502, 'EMPTY_RESPONSE')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await raceAbort(reader.read(), signal)
      if (done) return Buffer.concat(chunks).toString('utf8')
      size += value.byteLength
      if (size > maxBytes) throw new ProxyFailure('Upstream response exceeded its size limit', 502, 'RESPONSE_TOO_LARGE', { retryable: false })
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
