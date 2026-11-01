import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { isImageDataOrHttpUrl, sanitizePayloadImages } from '../lib/payload-sanitize.js'
import { createProxyServer } from '../lib/proxy-server.js'

test('payload-sanitize: isImageDataOrHttpUrl accepts only valid image data URIs or http(s) URLs', () => {
  // Valid data URIs
  assert.equal(isImageDataOrHttpUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), true)
  assert.equal(isImageDataOrHttpUrl('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/'), true)
  assert.equal(isImageDataOrHttpUrl('data:image/webp;base64,UklGRkAAAABXRUJQVlA4...'), true)
  assert.equal(isImageDataOrHttpUrl('data:image/svg+xml;base64,PHN2ZyB4bWxucz0...'), true)
  assert.equal(isImageDataOrHttpUrl('  data:image/png;base64,abc  '), true)

  // Valid remote URLs
  assert.equal(isImageDataOrHttpUrl('https://example.com/image.png'), true)
  assert.equal(isImageDataOrHttpUrl('http://cdn.site.org/photos/123.jpg?token=abc'), true)

  // Invalid URLs / Error text / Malformed
  assert.equal(isImageDataOrHttpUrl(''), false)
  assert.equal(isImageDataOrHttpUrl('   '), false)
  assert.equal(isImageDataOrHttpUrl(null), false)
  assert.equal(isImageDataOrHttpUrl(undefined), false)
  assert.equal(isImageDataOrHttpUrl('Failed to load image attachment: ENOENT'), false)
  assert.equal(isImageDataOrHttpUrl('data:text/plain;base64,SGVsbG8='), false)
  assert.equal(isImageDataOrHttpUrl('file:///tmp/image.png'), false)
  assert.equal(isImageDataOrHttpUrl('relative/path/image.png'), false)
})

test('payload-sanitize: sanitizePayloadImages preserves valid images and converts invalid images to text blocks', () => {
  const original = {
    model: 'cline-pass/deepseek-v4.1-flash',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze these images' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,validBase64Data' } },
          { type: 'image_url', image_url: { url: 'https://example.com/valid.png' } },
          { type: 'image_url', image_url: { url: 'Error: image file missing or expired' } },
          { type: 'image_url', image_url: { url: '' } },
        ],
      },
    ],
  }

  const sanitized = sanitizePayloadImages(original)
  assert.notEqual(sanitized, original)
  const content = sanitized.messages[0].content
  assert.equal(content.length, 5)

  // Valid parts stay intact
  assert.deepEqual(content[0], { type: 'text', text: 'Analyze these images' })
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,validBase64Data' } })
  assert.deepEqual(content[2], { type: 'image_url', image_url: { url: 'https://example.com/valid.png' } })

  // Invalid parts degraded to text blocks
  assert.deepEqual(content[3], { type: 'text', text: 'Error: image file missing or expired' })
  assert.deepEqual(content[4], { type: 'text', text: '[image load failed]' })
})

test('payload-sanitize: sanitizePayloadImages returns identical reference when no images need changes', () => {
  const safeBody = {
    model: 'cline-pass/deepseek-v4.1-flash',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Just text' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,valid' } },
        ],
      },
      {
        role: 'assistant',
        content: 'Sure, here is the answer.',
      },
    ],
  }

  const result = sanitizePayloadImages(safeBody)
  assert.equal(result, safeBody)
})

test('payload-sanitize: sanitizePayloadImages safely ignores malformed or non-array bodies', () => {
  assert.equal(sanitizePayloadImages(null), null)
  assert.equal(sanitizePayloadImages(undefined), undefined)
  assert.deepEqual(sanitizePayloadImages({}), {})
  assert.deepEqual(sanitizePayloadImages({ messages: 'not an array' }), { messages: 'not an array' })
})

test('payload-sanitize: proxy rewires invalid image blocks before upstream call', async (t) => {
  let capturedBody = null
  const upstream = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    capturedBody = JSON.parse(Buffer.concat(parts).toString('utf8'))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'received' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => upstream.close(resolve)))

  const port = upstream.address().port
  const pool = [{ apiKeyEnv: 'CLINEBOT_API_KEY', present: true, value: 'test-key' }]
  const cfg = {
    enabled: true,
    proxyEnabled: true,
    baseUrl: `http://127.0.0.1:${port}`,
    customModels: [{ id: 'cline-pass/deepseek-v4.1-flash' }],
  }

  const proxy = createProxyServer({
    snapshot: async () => ({ config: cfg, accounts: pool }),
  })
  await proxy.start()
  t.after(() => proxy.stop())

  const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${proxy.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'cline-pass/deepseek-v4.1-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'question' },
            { type: 'image_url', image_url: { url: 'Error: local file missing' } },
          ],
        },
      ],
    }),
  })

  assert.equal(response.status, 200)
  assert.ok(capturedBody)
  assert.equal(capturedBody.messages[0].content[1].type, 'text')
  assert.equal(capturedBody.messages[0].content[1].text, 'Error: local file missing')
})
