import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, symlink, writeFile, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { createUpdateChecker, installationSource, UPDATE_REPOSITORY } from '../lib/update-check.js'
import { registerPluginUpdater } from '../lib/updater.js'
import http from 'node:http'
import { create as createTar } from 'tar'
import { readUpdateArchive } from '../lib/update-archive.js'

const shaA = 'a'.repeat(40), shaB = 'b'.repeat(40), shaC = 'c'.repeat(40)
const manifestUrl = new URL('../package.json', import.meta.url)
const remoteManifest = { name: 'dsh-clinepass', version: '0.5.7', dsh: { bundle: { patch: './cordis.patch.yml' } } }

async function fixture(t, overrides = {}) {
  const scratch = new URL('../.tmp/agent/', import.meta.url)
  await mkdir(scratch, { recursive: true })
  const profile = await mkdtemp(join(scratch.pathname, 'update-check-'))
  await mkdir(join(profile, 'node_modules'))
  await symlink(new URL('..', import.meta.url).pathname, join(profile, 'node_modules/dsh-clinepass'), process.platform === 'win32' ? 'junction' : 'dir')
  t.after(() => rm(profile, { recursive: true, force: true }))
  const state = { row: { name: 'dsh-clinepass', installed: true, source: overrides.initialSource ?? `github:${UPDATE_REPOSITORY}#${shaA}`, enabled: true, version: '0.5.7' }, calls: [], manifest: remoteManifest, sha: shaB, installs: 0 }
  const manager = {
    listBundles: async () => state.row ? [structuredClone(state.row)] : [],
    inspect() { throw new Error('Target preview must not duplicate the native installer inspection') },
    installBundle() { state.installs++; throw new Error('The checker must not install') },
  }
  const fetchImpl = async (url, options) => {
    state.calls.push({ url, options })
    return Response.json(url.includes('api.github.com') ? [{ sha: state.sha }] : state.manifest)
  }
  const checker = createUpdateChecker({ manifestUrl, getManager: () => manager, getProfileDir: () => profile, fetchImpl, ...overrides })
  t.after(() => checker.close())
  return { state, manager, checker, profile }
}

async function archive(profile, manifest, name = 'target') {
  const root = join(profile, name), file = join(profile, `${name}.tgz`)
  await mkdir(join(root, 'package'), { recursive: true })
  await writeFile(join(root, 'package/package.json'), JSON.stringify(manifest))
  await createTar({ cwd: root, file, gzip: true, portable: true }, ['package'])
  return file
}

test('installation sources recognize this repository and redact URL credentials and queries', () => {
  for (const spec of [`github:${UPDATE_REPOSITORY}#${shaA}`, `git+https://github.com/${UPDATE_REPOSITORY}.git#${shaA}`, `git+ssh://git@github.com/${UPDATE_REPOSITORY}.git#${shaA}`, `git@github.com:${UPDATE_REPOSITORY}.git#${shaA}`]) {
    assert.equal(installationSource(spec).kind, 'github'); assert.equal(installationSource(spec).commit, shaA)
  }
  assert.equal(installationSource('github:GooDAnDReaDY/dsh-clinebot').kind, 'other')
  assert.equal(installationSource('/fixture/package.tgz').kind, 'tarball')
  assert.equal(installationSource('/fixture/source').kind, 'directory')
  assert.equal(installationSource('dsh-clinepass@0.5.7').kind, 'registry')
  assert.equal(installationSource('https://user:secret@fixture.test/pkg.tgz?token=private').label, 'https://fixture.test/pkg.tgz')
})

test('checks pin this repository to an exact commit, cache only successful data and never install', async (t) => {
  const { checker, state } = await fixture(t)
  const data = await checker.check()
  assert.equal(data.state, 'available'); assert.equal(data.runtimeMatchesInstallation, true)
  assert.equal(data.target.spec, `github:${UPDATE_REPOSITORY}#${shaB}`)
  assert.equal(data.target.version, '0.5.7')
  assert.equal(state.calls.length, 2)
  assert.ok(state.calls[1].url.includes(`/${shaB}/package.json`))
  assert.ok(state.calls.every(({ options }) => !options.headers.Authorization))
  await checker.check(); assert.equal(state.calls.length, 2)
  await checker.check({ fresh: true }); assert.equal(state.calls.length, 4)
  assert.equal(state.installs, 0)
  state.row.source = `github:${UPDATE_REPOSITORY}#${shaB}`
  assert.equal((await checker.check()).state, 'runtime-unverified')
  state.row.source = `github:other/fork#${shaB}`
  assert.equal((await checker.check({ target: 'github' })).state, 'available')
  state.row.source = `github:${UPDATE_REPOSITORY}`
  assert.equal((await checker.check()).state, 'commit-unverified')
  state.row.source = `github:${UPDATE_REPOSITORY}#${shaB}`; state.row.version = '0.5.8'
  assert.equal((await checker.check()).state, 'runtime-unverified')
})

test('local and registry installs require an explicit target; archive checks preserve package identity', async (t) => {
  for (const source of ['/fixture/old.tgz', '/fixture/dev', 'dsh-clinepass@0.5.7', 'github:GooDAnDReaDY/dsh-clinebot']) {
    const { checker, state } = await fixture(t, { initialSource: source })
    assert.equal((await checker.check()).state, 'target-required')
    assert.equal(state.calls.length, 0)
  }
  const { checker, state, manager, profile } = await fixture(t, { initialSource: '/fixture/old.tgz' })
  assert.equal(state.calls.length, 0)
  state.row.source = '/fixture/old.tgz'; state.row.version = '0.5.8'
  assert.equal((await checker.check()).state, 'runtime-unverified')
  state.row.version = '0.5.7'
  assert.equal((await checker.check({ target: 'github' })).target.commit, shaB)
  const good = await archive(profile, { ...remoteManifest, version: '0.5.8' })
  assert.equal((await checker.check({ target: good })).target.spec, good)
  const same = await archive(profile, remoteManifest, 'same')
  state.row.source = `file:${same}`
  const current = createUpdateChecker({ manifestUrl, getManager: () => manager, getProfileDir: () => profile })
  t.after(() => current.close())
  const checked = await current.check({ target: same })
  assert.equal(checked.state, 'archive-unverified'); assert.equal(checked.sourceChange, false)
  const wrong = await archive(profile, { ...remoteManifest, name: 'other-plugin' }, 'wrong')
  await assert.rejects(checker.check({ target: wrong }), { code: 'UPDATE_IDENTITY_MISMATCH' })
  await assert.rejects(checker.check({ target: join(profile, 'missing.tgz') }), { code: 'UPDATE_ARCHIVE_UNREADABLE' })
  for (const target of ['relative/path', 'github:GooDAnDReaDY/dsh-clinebot', 'https://other.test/package.tgz']) await assert.rejects(checker.check({ target }), { code: 'UPDATE_INVALID_TARGET' })
  state.row = null
  assert.equal((await checker.check()).state, 'unmanaged')
})

test('an in-place same-version update cannot turn a new recorded commit into proof that old code reloaded', async (t) => {
  const { checker, manager, profile, state } = await fixture(t)
  assert.equal((await checker.check()).runtimeMatchesInstallation, true)
  state.row.source = `github:${UPDATE_REPOSITORY}#${shaB}`
  const oldInstance = await checker.check()
  assert.equal(oldInstance.currentVersion, '0.5.7'); assert.equal(oldInstance.installedVersion, '0.5.7')
  assert.equal(oldInstance.runtimeMatchesInstallation, false); assert.equal(oldInstance.state, 'runtime-unverified')
  const restarted = createUpdateChecker({ manifestUrl, getManager: () => manager, getProfileDir: () => profile, fetchImpl: async (url) => Response.json(url.includes('api.github.com') ? [{ sha: shaB }] : remoteManifest) })
  t.after(() => restarted.close())
  assert.equal((await restarted.check()).state, 'current')
})

test('a retargeted package symlink cannot change the recorded running version before restart', async (t) => {
  const { manager, state, profile } = await fixture(t)
  const logicalManifest = join(profile, 'node_modules/dsh-clinepass/package.json')
  const options = { manifestUrl: logicalManifest, getManager: () => manager, getProfileDir: () => profile }
  const running = createUpdateChecker(options)
  t.after(() => running.close())
  const updated = join(profile, 'updated-copy')
  await mkdir(updated); await writeFile(join(updated, 'package.json'), JSON.stringify({ ...remoteManifest, version: '0.5.8' }))
  await rm(join(profile, 'node_modules/dsh-clinepass'))
  await symlink(updated, join(profile, 'node_modules/dsh-clinepass'), process.platform === 'win32' ? 'junction' : 'dir')
  state.row.source = '/fixture/new.tgz'; state.row.version = '0.5.8'
  const beforeRestart = await running.check()
  assert.equal(beforeRestart.currentVersion, '0.5.7'); assert.equal(beforeRestart.installedVersion, '0.5.8')
  assert.equal(beforeRestart.runtimeMatchesInstallation, false); assert.equal(beforeRestart.runtimeMismatch, true)
  assert.equal(beforeRestart.state, 'runtime-unverified')
  const restarted = createUpdateChecker(options)
  t.after(() => restarted.close())
  const afterRestart = await restarted.check()
  assert.equal(afterRestart.currentVersion, '0.5.8'); assert.equal(afterRestart.runtimeMatchesInstallation, true)
  assert.equal(afterRestart.runtimeMismatch, false)
})

test('offline, invalid and changing targets cannot become an up-to-date result', async (t) => {
  let changeSource
  const { checker, state } = await fixture(t, { fetchImpl: async (url) => {
    if (!url.includes('api.github.com')) changeSource?.()
    return Response.json(url.includes('api.github.com') ? [{ sha: state.sha }] : state.manifest)
  } })
  state.manifest = { ...remoteManifest, name: '@goodandready/dsh-clinebot' }
  await assert.rejects(checker.check(), { code: 'UPDATE_IDENTITY_MISMATCH' })
  state.manifest = remoteManifest; state.sha = 'main'
  await assert.rejects(checker.check(), { code: 'UPDATE_INVALID_RESPONSE' })
  state.sha = shaB
  changeSource = () => { state.row.source = `github:${UPDATE_REPOSITORY}#${shaC}` }
  await assert.rejects(checker.check({ fresh: true }), { code: 'UPDATE_SOURCE_CHANGED' })
  const offline = createUpdateChecker({ manifestUrl, getManager: () => ({ listBundles: async () => [state.row] }), fetchImpl: async () => { throw new Error('private network details') } })
  await assert.rejects(offline.check(), { code: 'UPDATE_CHECK_FAILED', message: 'Update check failed; the latest target is unknown' })
  const unavailable = createUpdateChecker({ manifestUrl, getManager: () => undefined })
  assert.equal((await unavailable.check()).state, 'unavailable')
})

test('archive checks reject malformed, linked, duplicate and oversized manifests without extracting files', async (t) => {
  const { profile } = await fixture(t)
  const root = join(profile, 'invalid'), file = join(profile, 'invalid.tgz')
  await mkdir(join(root, 'package'), { recursive: true })
  await writeFile(file, 'not a tarball')
  await assert.rejects(readUpdateArchive(file), { code: 'UPDATE_INVALID_ARCHIVE' })
  await writeFile(join(root, 'package/package.json'), JSON.stringify(remoteManifest))
  await createTar({ cwd: root, file, gzip: true }, ['package/package.json', 'package/package.json'])
  await assert.rejects(readUpdateArchive(file), { code: 'UPDATE_INVALID_ARCHIVE' })
  await writeFile(join(root, 'package/package.json'), ' '.repeat(256 * 1024 + 1))
  await createTar({ cwd: root, file, gzip: true }, ['package'])
  await assert.rejects(readUpdateArchive(file), { code: 'UPDATE_INVALID_ARCHIVE' })
  await rm(join(root, 'package/package.json'))
  await writeFile(join(root, 'private.json'), JSON.stringify(remoteManifest))
  await symlink('../private.json', join(root, 'package/package.json'))
  await createTar({ cwd: root, file, gzip: true }, ['package'])
  await assert.rejects(readUpdateArchive(file), { code: 'UPDATE_INVALID_ARCHIVE' })
  await truncate(file, 16 * 1024 * 1024 + 1)
  await assert.rejects(readUpdateArchive(file), { code: 'UPDATE_INVALID_ARCHIVE' })
})

test('older concurrent GitHub reads cannot overwrite a newer checked commit', async (t) => {
  let release, started
  const blocked = new Promise((resolve) => { release = resolve })
  const entered = new Promise((resolve) => { started = resolve })
  let calls = 0
  const { checker } = await fixture(t, { fetchImpl: async (url) => {
    if (url.includes('api.github.com')) { if (++calls === 1) { started(); await blocked; return Response.json([{ sha: shaB }]) } return Response.json([{ sha: shaC }]) }
    return Response.json(remoteManifest)
  } })
  const first = checker.check({ fresh: true }); await entered
  assert.equal((await checker.check({ fresh: true })).target.commit, shaC)
  release(); assert.equal((await first).target.commit, shaB)
  assert.equal((await checker.check()).target.commit, shaC)
})

test('update response-body deadlines, caller cancellation and disposal close the actual HTTP connection', async (t) => {
  let closed = 0, requests = 0
  const server = http.createServer((_req, res) => {
    requests++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders()
    res.once('close', () => closed++)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  const { checker } = await fixture(t, { timeoutMs: 50, fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}`, options) })
  await assert.rejects(checker.check(), { code: 'UPDATE_CHECK_TIMEOUT' })
  const controller = new AbortController(), before = requests
  const task = checker.check({ signal: controller.signal })
  const rejected = assert.rejects(task, { code: 'UPDATE_CHECK_CANCELLED' })
  while (requests === before) await new Promise((resolve) => setImmediate(resolve))
  controller.abort(); await rejected
  const beforeClose = requests, pending = checker.check()
  const disposed = assert.rejects(pending, { code: 'UPDATE_CHECK_CANCELLED' })
  while (requests === beforeClose) await new Promise((resolve) => setImmediate(resolve))
  checker.close(); await disposed
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(closed, 3)
})

test('update routes require host authentication and leave installation to the native owner', async (t) => {
  const { manager, profile, state } = await fixture(t, { initialSource: '/fixture/current.tgz' })
  let route
  const ctx = {
    get: () => ({ requestRejection: (req) => req.headers['x-fixture-auth'] ? undefined : 401 }),
    webServer: { register(value) { route = value; return () => {} } },
    inject(names, fn) { fn({ effect: (run) => run(), pluginManager: manager, profileContext: { dir: profile } }); assert.ok(['pluginManager', 'profileContext'].includes(names[0])) },
  }
  const dispose = registerPluginUpdater(ctx, { endpoint: '/update', manifestUrl })
  t.after(dispose)
  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  const url = `http://127.0.0.1:${server.address().port}/update`
  assert.equal((await fetch(url)).status, 401)
  assert.equal((await fetch(url, { method: 'POST', headers: { 'x-fixture-auth': '1' } })).status, 405)
  state.row.source = '/fixture/current.tgz'
  assert.equal((await (await fetch(url, { headers: { 'x-fixture-auth': '1' } })).json()).state, 'target-required')
  const head = await fetch(url, { method: 'HEAD', headers: { 'x-fixture-auth': '1' } })
  assert.equal(head.status, 200); assert.equal(await head.text(), '')
  assert.equal(state.installs, 0)
})
