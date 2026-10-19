import { registerAuthenticatedRoute } from './access.js'
import { writeJson } from './http.js'
import { createUpdateChecker } from './update-check.js'

export function createNativeUpdateChecker(ctx, options) {
  let manager, profileDir
  const checker = createUpdateChecker({ ...options, getManager: () => manager, getProfileDir: () => profileDir })
  ctx.inject?.(['pluginManager'], (inner) => inner.effect(() => {
    manager = inner.pluginManager
    checker.captureInstallation()
    return () => { manager = undefined; checker.cancel() }
  }, 'dsh-clinebot: native plugin management'))
  ctx.inject?.(['profileContext'], (inner) => inner.effect(() => {
    profileDir = inner.profileContext.dir
    return () => { profileDir = undefined; checker.cancel() }
  }, 'dsh-clinebot: update installation identity'))
  return checker
}

/** Updates are checked here and installed through the host-owned Plugins dialog. */
export function registerPluginUpdater(ctx, options) {
  if (!ctx?.webServer?.register) return () => {}
  const checker = options.checker || createNativeUpdateChecker(ctx, options)
  const unregister = registerAuthenticatedRoute(ctx, {
    kind: 'exact', path: options.endpoint,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return writeJson(res, 405, { ok: false, error: 'Use the host Plugins installer for a checked update target', code: 'NATIVE_INSTALLER_REQUIRED' })
      const controller = new AbortController()
      const abort = () => { if (!res.writableFinished) controller.abort() }
      req.on('aborted', abort); res.on('close', abort)
      try {
        const query = new URL(req.url || options.endpoint, 'http://localhost').searchParams
        const result = await checker.check({ target: query.get('target') || undefined, fresh: query.get('fresh') === '1', signal: controller.signal })
        if (!res.destroyed) {
          if (req.method === 'HEAD') { res.writeHead(200, { 'Cache-Control': 'no-store' }); res.end() }
          else writeJson(res, 200, { ok: true, ...result })
        }
      } catch (error) {
        if (!res.destroyed) writeJson(res, error.status || 500, { ok: false, error: error.message, code: error.code || 'UPDATE_CHECK_FAILED' })
      } finally { req.off('aborted', abort); res.off('close', abort) }
    },
  })
  return () => { if (options.checker) checker.cancel(); else checker.close(); unregister?.() }
}
