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
  'test/registry.test.js',
  'test/provider-sync.test.js',
  'test/settings-guard.test.js',
  'test/request-shape.test.js',
  'test/client-bundle.test.js',
  'test/token-count.test.js',
]
execFileSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_PATH: nodeModules },
})
