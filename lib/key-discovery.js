import { open } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const KEY_PATTERN = /cline_[A-Za-z0-9_-]{16,}/g

export function keyCandidates(home, env) {
  const files = ['.cline/config.json', '.cline/data/settings.json', '.cline/settings.json', '.config/cline/config.json', '.cline.json']
    .map((name) => ({ path: path.join(home, name), source: 'Cline CLI' }))
  for (const app of ['Code', 'Cursor']) {
    const roots = [path.join(home, '.config', app), path.join(home, 'Library/Application Support', app), path.join(env.APPDATA || path.join(home, 'AppData/Roaming'), app)]
    for (const root of roots) {
      const storage = path.join(root, 'User/globalStorage')
      for (const file of ['state.vscdb', 'saoudrizwan.claude-dev/state.vscdb', 'saoudrizwan.claude-dev/settings/cline_custom_modes.json']) {
        files.push({ path: path.join(storage, file), source: app === 'Code' ? 'VS Code' : 'Cursor' })
      }
    }
  }
  return files
}

export function createKeyDiscovery({ home = os.homedir(), env = process.env, ttlMs = 300000, now = Date.now } = {}) {
  let expires = 0
  const handles = new Map()
  return {
    clear() { handles.clear(); expires = 0 },
    resolve(id) {
      if (now() >= expires) { handles.clear(); throw new Error('Discovery expired; scan again') }
      const key = handles.get(id)
      if (!key) throw new Error('Discovered key not found; scan again')
      return key
    },
    async discover() {
      handles.clear()
      const seen = new Map()
      const keys = []
      const sources = []
      const add = (key, source) => {
        if (seen.has(key)) {
          seen.get(key).sources.push(source)
          return
        }
        const id = randomUUID()
        const row = { id, maskedKey: `${key.slice(0, 8)}••••${key.slice(-4)}`, sources: [source] }
        handles.set(id, key)
        seen.set(key, row)
        keys.push(row)
      }
      for (const name of ['CLINE_API_KEY', 'CLINEPASS_API_KEY']) {
        const key = String(env[name] || '').trim()
        if (/^cline_[A-Za-z0-9_-]{16,}$/.test(key)) add(key, `$${name}`)
      }
      for (const candidate of keyCandidates(home, env)) {
        let file
        let status = 'no-key'
        try {
          file = await open(candidate.path, 'r')
          const stat = await file.stat()
          if (!stat.isFile()) status = 'not-file'
          else if (stat.size > MAX_FILE_BYTES) status = 'too-large'
          else {
            const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE_BYTES + 1))
            const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
            const content = buffer.subarray(0, bytesRead).toString('utf8')
            if (candidate.path.endsWith('.json')) JSON.parse(content)
            const matches = content.match(KEY_PATTERN) || []
            status = matches.length ? 'found' : 'no-key'
            for (const key of matches) add(key, `${candidate.source}: ${candidate.path}`)
          }
        } catch (error) {
          status = error.code === 'ENOENT' ? 'missing' : error instanceof SyntaxError ? 'invalid-json' : 'unreadable'
        } finally {
          await file?.close()
        }
        sources.push({ source: candidate.source, path: candidate.path, status })
      }
      expires = now() + ttlMs
      return { keys, sources, expiresAt: expires }
    },
  }
}
