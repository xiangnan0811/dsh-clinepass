// Consume the response body inside the deadline too: fetch alone only waits
// for headers. Never turn a stalled body or malformed JSON into a success.
async function fetchJson(url, options = {}, lifetimeSignal) {
  const { timeoutMs = 45000, signal, ...init } = options
  const controller = new AbortController()
  const signals = [signal, lifetimeSignal].filter(Boolean)
  const listeners = []
  for (const source of signals) {
    const abort = () => controller.abort(source.reason)
    if (source.aborted) abort()
    else {
      source.addEventListener('abort', abort, { once: true })
      listeners.push(() => source.removeEventListener('abort', abort))
    }
  }
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)
  let onAbort
  try {
    controller.signal.throwIfAborted()
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    const operation = (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal })
      const body = await response.text()
      // Error pages may be plain text. Keep the HTTP status while allowing the
      // caller to use the server's structured error when one is present.
      let data
      try { data = JSON.parse(body) } catch {
        if (response.ok) throw new Error('Invalid JSON response')
        data = { error: `HTTP ${response.status}` }
      }
      return { ok: response.ok, status: response.status, json: async () => data }
    })()
    return await Promise.race([operation, aborted])
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', onAbort)
    for (const remove of listeners) remove()
  }
}

function useClientRequests() {
  const scope = React.useRef(null)
  React.useEffect(() => {
    const controller = new AbortController()
    scope.current = controller
    return () => controller.abort(new DOMException('Page closed', 'AbortError'))
  }, [])
  return React.useCallback((url, options) => fetchJson(url, options, scope.current?.signal), [])
}
