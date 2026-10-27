import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'

export const PRICE_CATALOG_URL = 'https://models.dev/api.json'
const rate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : ''

export function parsePriceCatalog(data) {
  const models = []
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid public price catalog')
  for (const provider of Object.values(data)) {
    if (!name(provider?.id) || !provider.models || typeof provider.models !== 'object') continue
    for (const model of Object.values(provider.models)) {
      if (!name(model?.id) || !model.cost || typeof model.cost !== 'object') continue
      const values = [model.cost.input, model.cost.output, model.cost.cache_read, model.cost.cache_write].map(rate)
      if (values.every(value => value === null)) continue
      models.push({ provider: provider.id, id: model.id, name: name(model.name) || model.id, canonical: name(model.canonical_model_id),
        inputPerMillion: values[0], outputPerMillion: values[1], cacheReadPerMillion: values[2], cacheWritePerMillion: values[3] })
      if (models.length > 30000) throw new Error('Public price catalog is too large')
    }
  }
  if (!models.length) throw new Error('Public price catalog contains no rates')
  return models
}

export function createPriceCatalog(filename, { fetchImpl = fetch, now = Date.now } = {}) {
  let catalog = { version: 1, source: PRICE_CATALOG_URL, syncedAt: null, models: [] }, error = '', pending, controller, closed = false
  const ready = readFile(filename, 'utf8').then(text => {
    const value = JSON.parse(text)
    if (value.version !== 1 || value.source !== PRICE_CATALOG_URL || !Number.isFinite(value.syncedAt) || !Array.isArray(value.models)
      || value.models.some(row => !name(row.provider) || !name(row.id) || ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion'].some(key => row[key] !== null && rate(row[key]) === null))) throw new Error('Invalid cached price catalog')
    catalog = value
  }).catch(failure => { if (failure.code !== 'ENOENT') error = 'Cached reference prices could not be read; synchronize again.' })
  return {
    ready,
    snapshot: () => ({ ...catalog, error }),
    async sync() {
      await ready
      if (closed) throw new Error('Price catalog is closed')
      if (pending) return pending
      pending = (async () => {
        controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        let reader
        try {
          const response = await fetchImpl(PRICE_CATALOG_URL, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`Price catalog returned HTTP ${response.status}`)
          reader = response.body.getReader()
          const chunks = []; let size = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.length
            if (size > 20 * 1024 * 1024) throw new Error('Public price catalog is too large')
            chunks.push(Buffer.from(value))
          }
          const models = parsePriceCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          controller.signal.throwIfAborted()
          const next = { version: 1, source: PRICE_CATALOG_URL, syncedAt: now(), models }
          await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
          await withFileLock(filename, () => { controller.signal.throwIfAborted(); return writeFileAtomic(filename, JSON.stringify(next), { mode: 0o600, dirMode: 0o700 }) })
          catalog = next; error = ''
          return this.snapshot()
        } catch (failure) {
          error = failure.name === 'AbortError' ? 'Price catalog request cancelled or timed out.' : 'Reference price synchronization failed; previous rates were retained.'
          throw new Error(error)
        } finally {
          clearTimeout(timer); await reader?.cancel().catch(() => {}); reader?.releaseLock(); controller = undefined; pending = undefined
        }
      })()
      return pending
    },
    async close() { closed = true; controller?.abort(); await pending?.catch(() => {}) },
  }
}
