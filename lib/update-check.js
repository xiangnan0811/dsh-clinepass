import { realpath } from 'node:fs/promises'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readUpdateArchive } from './update-archive.js'

export const UPDATE_REPOSITORY = 'xiangnan0811/dsh-clinepass'
const SHA = /^[a-f0-9]{40}$/i

function problem(message, code, status = 502) { return Object.assign(new Error(message), { code, status }) }

export function captureRunningPlugin(manifestUrl) {
  const path = realpathSync(manifestUrl)
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  return Object.freeze({ path, version: manifest.version })
}

export function installationSource(spec) {
  if (!spec) return { kind: 'unknown', label: 'Unknown installation source' }
  const github = /^(?:github:|(?:git\+https|https):\/\/github\.com\/|(?:git\+ssh|ssh):\/\/(?:git@)?github\.com\/|git@github\.com:)([^#?]+?)(?:\.git)?(?:#([^?]+))?(?:\?.*)?$/.exec(spec)
  if (github) {
    const repository = github[1].replace(/\/$/, '')
    const ref = github[2] || ''
    return { kind: repository.toLowerCase() === UPDATE_REPOSITORY.toLowerCase() ? 'github' : 'other', label: `github:${repository}${ref ? `#${ref}` : ''}`, ...(SHA.test(ref) ? { commit: ref.toLowerCase() } : {}) }
  }
  if (isAbsolute(spec) || /^(?:file:|link:)/.test(spec)) return { kind: /\.(?:tgz|tar\.gz)$/i.test(spec) ? 'tarball' : 'directory', label: spec }
  try {
    const url = new URL(spec)
    if (['http:', 'https:'].includes(url.protocol) && /\.(?:tgz|tar\.gz)$/i.test(url.pathname)) return { kind: 'tarball', label: `${url.origin}${url.pathname}` }
  } catch { /* Other spec forms are not URLs. */ }
  if (/^dsh-clinepass(?:@[^\s]+)?$/.test(spec)) return { kind: 'registry', label: spec }
  // The host strips URL user information, but a source query may still be secret.
  return { kind: 'other', label: 'Other installation source' }
}

/** Checks are read-only; installation and task recovery belong to the host UI. */
export function createUpdateChecker({ packageName = 'dsh-clinepass', manifestUrl, runningIdentity = captureRunningPlugin(manifestUrl), getManager, getProfileDir = () => undefined, fetchImpl = fetch, now = Date.now, timeoutMs = 15000 }) {
  let latest, sequence = 0, closed = false
  const controllers = new Set()
  const installed = async () => (await getManager().listBundles()).find((row) => row.name === packageName && row.installed)
  const identity = (row) => JSON.stringify([row?.source, row?.version, row?.enabled])
  let initialInstallation
  const captureInstallation = () => {
    if (!initialInstallation && getManager()) initialInstallation = installed().then((row) => row ? identity(row) : null).catch(() => null)
  }
  captureInstallation()
  async function github(signal, fresh) {
    if (!fresh && latest && now() < latest.expiresAt) return latest.target
    const generation = ++sequence
    const json = async (url) => {
      const response = await fetchImpl(url, { signal, redirect: 'error', headers: { Accept: 'application/json' } })
      if (!response.ok) { await response.body?.cancel(); throw problem(`GitHub update check failed (HTTP ${response.status})`, `UPDATE_GITHUB_HTTP_${response.status}`) }
      try { return await response.json() } catch { signal.throwIfAborted(); throw problem('GitHub returned invalid update data', 'UPDATE_INVALID_RESPONSE') }
    }
    const commits = await json(`https://api.github.com/repos/${UPDATE_REPOSITORY}/commits?per_page=1`)
    const sha = commits?.[0]?.sha
    if (typeof sha !== 'string' || !SHA.test(sha)) throw problem('GitHub returned no exact target commit', 'UPDATE_INVALID_RESPONSE')
    const manifest = await json(`https://raw.githubusercontent.com/${UPDATE_REPOSITORY}/${sha}/package.json`)
    if (manifest?.name !== packageName || typeof manifest.version !== 'string' || !manifest.version || typeof manifest.dsh?.bundle?.patch !== 'string') throw problem('The checked repository does not declare this plugin bundle', 'UPDATE_IDENTITY_MISMATCH')
    const target = { spec: `github:${UPDATE_REPOSITORY}#${sha.toLowerCase()}`, version: manifest.version, commit: sha.toLowerCase(), url: `https://github.com/${UPDATE_REPOSITORY}/commit/${sha.toLowerCase()}`, title: 'ClinePass' }
    if (generation === sequence) latest = { target, expiresAt: now() + 300000 }
    return target
  }
  async function check({ target: requested, fresh = false, signal } = {}) {
    if (closed) throw problem('Update checking is unavailable', 'UPDATE_UNAVAILABLE', 503)
    const controller = new AbortController()
    controllers.add(controller)
    const timer = setTimeout(() => controller.abort(new DOMException('Update check timed out', 'TimeoutError')), timeoutMs)
    const combined = AbortSignal.any([controller.signal, signal].filter(Boolean))
    try {
      combined.throwIfAborted()
      const currentVersion = runningIdentity.version
      const base = { packageName, currentVersion, updatesEnabled: false, canAutoUpdate: false, updateAvailable: false }
      if (!getManager()) return { ...base, state: 'unavailable', source: installationSource() }
      captureInstallation()
      const initial = await initialInstallation
      const row = await installed()
      const source = installationSource(row?.source)
      if (!row) return { ...base, state: 'unmanaged', source }
      const profileDir = getProfileDir()
      let runtimePathMatches = null
      if (profileDir) {
        try { runtimePathMatches = runningIdentity.path === await realpath(join(profileDir, 'node_modules', packageName, 'package.json')) } catch { /* An unreadable path cannot prove which copy is running. */ }
      }
      const runtimeSourceMatches = initial === null ? null : initial === identity(row)
      const runtimeMatchesInstallation = runtimeSourceMatches === false || runtimePathMatches === false ? false : runtimeSourceMatches === true && runtimePathMatches === true ? true : null
      const runtimeMismatch = runtimeMatchesInstallation === false || (!!row.version && currentVersion !== row.version)
      const status = { ...base, source, installedVersion: row.version || null, runtimeMatchesInstallation, runtimeMismatch, canAutoUpdate: true, updatesEnabled: true }
      if (!requested && source.kind !== 'github') return { ...status, state: runtimeMismatch ? 'runtime-unverified' : 'target-required' }
      const selected = requested || 'github'
      let target
      if (selected === 'github') {
        target = await github(combined, fresh)
      }
      else {
        if (!isAbsolute(selected) || !/\.(?:tgz|tar\.gz)$/i.test(selected)) throw problem('Choose this repository or an absolute npm tarball path (.tgz)', 'UPDATE_INVALID_TARGET', 400)
        const manifest = await readUpdateArchive(selected, combined)
        if (manifest?.name !== packageName || typeof manifest.dsh?.bundle?.patch !== 'string' || typeof manifest.version !== 'string' || !manifest.version) throw problem('The archive does not declare this plugin bundle', 'UPDATE_IDENTITY_MISMATCH', 422)
        target = { spec: selected, version: manifest.version, title: 'ClinePass' }
      }
      combined.throwIfAborted()
      if (identity(await installed()) !== identity(row)) throw problem('The installed plugin changed; check the target again', 'UPDATE_SOURCE_CHANGED', 409)
      const sameCommit = source.kind === 'github' && target.commit && source.commit === target.commit
      let sameArchivePath = false
      if (!target.commit && source.kind === 'tarball') {
        try { sameArchivePath = await realpath(row.source.startsWith('file:') ? fileURLToPath(row.source) : row.source) === await realpath(selected) } catch { /* Missing source files cannot establish equality. */ }
      }
      const sameArchive = sameArchivePath && target.version === row.version
      const running = runtimeMatchesInstallation === true && currentVersion === row.version
      const state = (sameCommit || sameArchive) && !running ? 'runtime-unverified' : sameCommit ? 'current' : sameArchive ? 'archive-unverified' : source.kind === 'github' && !source.commit && target.version === row.version ? 'commit-unverified' : 'available'
      return { ...status, state, target, latestVersion: target.version, updateAvailable: ['available', 'commit-unverified', 'archive-unverified'].includes(state), sourceChange: target.commit ? source.kind !== 'github' : !sameArchivePath, checkedAt: now() }
    } catch (error) {
      if (combined.aborted) throw problem(combined.reason?.name === 'TimeoutError' ? 'Update check timed out' : 'Update check cancelled', combined.reason?.name === 'TimeoutError' ? 'UPDATE_CHECK_TIMEOUT' : 'UPDATE_CHECK_CANCELLED', combined.reason?.name === 'TimeoutError' ? 504 : 499)
      if (error.code?.startsWith('UPDATE_')) throw error
      throw problem('Update check failed; the latest target is unknown', 'UPDATE_CHECK_FAILED')
    } finally { clearTimeout(timer); controllers.delete(controller) }
  }
  return { check, captureInstallation, cancel() { for (const controller of controllers) controller.abort() }, close() { closed = true; this.cancel() } }
}
