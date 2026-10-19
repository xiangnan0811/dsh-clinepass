import { isTrustedSettingsRequest, writeJson } from './http.js'
import { captureNativeLifecycle } from './native-lifecycle.js'

export { isTrustedSettingsRequest }

/** Custom HTTP routes share the host's browser/API authentication boundary. */
export function registerAuthenticatedRoute(ctx, route) {
  return ctx.webServer.register({
    ...route,
    handler(req, res) {
      const connection = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection
      if (typeof connection?.requestRejection === 'function') {
        let rejection
        try {
          rejection = connection.requestRejection(req)
        } catch {
          rejection = 403
        }
        if (rejection !== undefined) {
          writeJson(res, rejection, {
            ok: false,
            error: rejection === 401 ? 'Authentication required' : 'Forbidden',
          })
          return
        }
      }
      const initialization = captureNativeLifecycle(ctx)
      const invoke = () => {
        if (req.aborted || res.destroyed) return
        return route.handler(req, res)
      }
      return initialization ? initialization.then(invoke) : invoke()
    },
  })
}

export function assertTrustedSettingsRequest(req, res) {
  if (!isTrustedSettingsRequest(req)) {
    writeJson(res, 403, { ok: false, error: 'Forbidden' })
    return false
  }
  return true
}
