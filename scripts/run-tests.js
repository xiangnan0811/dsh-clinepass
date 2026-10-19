import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dshBin = realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim())
const require = createRequire(dshBin)
const nodeModules = dirname(dirname(require.resolve('@deepseek-ai/schemastery/package.json')))
const files = [
  'test/access.test.js',
  'test/native-host.test.js',
  'test/native-adapter.test.js',
  'test/registry.test.js',
  'test/provider-sync.test.js',
  'test/settings-guard.test.js',
  'test/request-shape.test.js',
  'test/client-bundle.test.js',
  'test/client-request.test.js',
  'test/model-management.test.js',
  'test/key-discovery.test.js',
  'test/session-router.test.js',
  'test/proxy.test.js',
  'test/proxy-runtime.test.js',
  'test/statistics.test.js',
  'test/usage-surfaces.test.js',
  'test/web-search.test.js',
  'test/token-count.test.js',
  'test/account-pool.test.js',
  'test/stream-failover.test.js',
  'test/slash-command.test.js',
]
execFileSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_PATH: nodeModules },
})
