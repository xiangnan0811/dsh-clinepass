/**
 * Detect valid image URLs (base64 data URIs or remote http/https links).
 * If a message block was emitted with an error text or placeholder instead of a
 * valid image URL, degrade it to a plain text block to avoid upstream HTTP 400.
 */
export function isImageDataOrHttpUrl(url) {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed) return false
  if (/^data:image\/[a-z0-9.+_-]+;base64,/i.test(trimmed)) return true
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return true
  return false
}

export function sanitizePayloadImages(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return body
  let bodyModified = false
  const messages = body.messages.map((message) => {
    if (!message || typeof message !== 'object' || !Array.isArray(message.content)) return message
    let messageModified = false
    const content = message.content.map((block) => {
      if (block?.type === 'image_url' && block.image_url) {
        const url = typeof block.image_url === 'string' ? block.image_url : block.image_url?.url
        if (!isImageDataOrHttpUrl(url)) {
          messageModified = true
          bodyModified = true
          const text = typeof url === 'string' && url.trim() ? url.trim() : '[image load failed]'
          return { type: 'text', text }
        }
      }
      return block
    })
    return messageModified ? { ...message, content } : message
  })
  return bodyModified ? { ...body, messages } : body
}
