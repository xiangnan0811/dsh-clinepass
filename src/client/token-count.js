function parseTokenCount(value) {
  const text = String(value || '').trim().replace(/,/g, '').replace(/\s+/g, '')
  if (!text) return { ok: true, value: 'inherit' }
  const match = text.match(/^(\d+(?:\.\d+)?)([kKmM])?$/)
  if (!match) return { ok: false, value: 'inherit' }
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, value: 'inherit' }
  const suffix = (match[2] || '').toLowerCase()
  const scaled = suffix === 'k' ? amount * 1000 : suffix === 'm' ? amount * 1_000_000 : amount
  const rounded = Math.round(scaled)
  if (!Number.isInteger(rounded) || rounded <= 0) return { ok: false, value: 'inherit' }
  return { ok: true, value: rounded }
}
