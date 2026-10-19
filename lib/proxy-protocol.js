export class ProxyFailure extends Error {
  constructor(message, status = 502, code = 'UPSTREAM_ERROR', { retryable = true, retryAfter, retryAfterMs, cause } = {}) {
    super(message, { cause })
    Object.assign(this, { status, code, retryable, retryAfter, retryAfterMs })
  }
}

export function httpFailure(status, retryAfter, now = Date.now()) {
  const seconds = retryAfter ? Number(retryAfter) : NaN
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now
  return new ProxyFailure(`Upstream returned HTTP ${status}`, status,
    status === 429 ? 'RATE_LIMIT' : status === 402 ? 'QUOTA' : status === 401 || status === 403 ? 'AUTH' : 'UPSTREAM_HTTP', {
      retryable: [401, 402, 403, 408, 429].includes(status) || status >= 500,
      retryAfter, retryAfterMs: Number.isFinite(delay) && delay > 0 ? delay : undefined,
    })
}

function errorPayload(value) {
  const error = value.error
  const code = typeof error === 'object' ? String(error.code || error.type || '') : ''
  const suppliedStatus = typeof error?.status === 'number' ? error.status : Number(code)
  const status = Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599 ? suppliedStatus
    : /rate.?limit|429/i.test(code) ? 429 : /quota|credit|402/i.test(code) ? 402 : /auth|invalid.*key|401/i.test(code) ? 401 : /invalid.?request|bad.?request/i.test(code) ? 400 : 502
  const failure = httpFailure(status)
  // Provider error text can contain keys or request text. Keep the machine
  // class and HTTP status; return a bounded plugin-owned diagnostic instead.
  failure.code = code && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : failure.code
  return failure
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
