import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Parser } from 'tar'

/** Read only the npm manifest; never extract an update archive or execute it. */
export async function readUpdateArchive(file, signal) {
  const invalid = () => Object.assign(new Error('Choose a valid npm archive (16 MiB compressed, 64 MiB entries, 256 KiB manifest maximum)'), { code: 'UPDATE_INVALID_ARCHIVE', status: 422 })
  let info
  try { info = await stat(file) } catch { signal?.throwIfAborted(); throw Object.assign(new Error('The selected update archive cannot be read'), { code: 'UPDATE_ARCHIVE_UNREADABLE', status: 422 }) }
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw invalid()
  let entries = 0, manifests = 0
  const parts = []
  const parser = new Parser({
    strict: true,
    filter(path, entry) {
      entries += entry.size
      if (entries > 64 * 1024 * 1024) { parser.abort(invalid()); return false }
      if (path.replace(/^\.\//, '').split('/').slice(1).join('/') !== 'package.json') return false
      if (++manifests !== 1 || entry.type !== 'File' || entry.size > 256 * 1024) { parser.abort(invalid()); return false }
      return true
    },
    onReadEntry(entry) { entry.on('data', (chunk) => parts.push(chunk)); entry.resume() },
  })
  try {
    await pipeline(createReadStream(file), parser, { signal })
    if (manifests !== 1) throw invalid()
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch (error) { signal?.throwIfAborted(); if (error.code === 'UPDATE_INVALID_ARCHIVE') throw error; throw invalid() }
}
