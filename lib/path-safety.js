import os from 'node:os'
import path from 'node:path'

export function dshHome(env = process.env, home = os.homedir()) {
  return path.resolve(env.DSH_HOME || path.join(home, '.dsh'))
}

const FORBIDDEN_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'settings.json',
  '.credentials.json',
  'settings.yaml',
  'settings.yml',
])

export function isSafeDataPath(value, env = process.env, home = os.homedir()) {
  const raw = String(value ?? '').trim()
  if (!raw) return true
  if (raw.includes('\0')) return false
  let resolved
  if (raw === '~') return false
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    resolved = path.resolve(path.join(home, raw.slice(2)))
  } else {
    resolved = path.resolve(raw)
  }
  const baseHome = dshHome(env, home)
  if (resolved === baseHome || !resolved.startsWith(`${baseHome}${path.sep}`)) return false
  const relative = path.relative(baseHome, resolved).toLowerCase()
  const segments = relative.split(/[\\/]+/)
  const base = path.basename(resolved).toLowerCase()
  if (segments[0] === 'profiles' && !base.startsWith('clinebot-')) return false
  if (path.extname(base) !== '.json') return false
  return !FORBIDDEN_BASENAMES.has(base)
}
