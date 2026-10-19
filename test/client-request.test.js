import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/request.js', import.meta.url), 'utf8')
const request = vm.runInNewContext(`${source}\nfetchJson`, {
  fetch, AbortController, DOMException, setTimeout, clearTimeout,
})

test('client deadlines include headers and stalled bodies; a new request recovers', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/headers') return
    if (req.url === '/body') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{')
      return
    }
    res.end('{"ok":true}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for (const path of ['/headers', '/body']) {
      await assert.rejects(request(base + path, { timeoutMs: 100 }), { name: 'TimeoutError' })
      const response = await request(base + '/ok')
      assert.equal((await response.json()).ok, true)
    }
    for (const lifetime of [false, true]) {
      const controller = new AbortController()
      const pending = lifetime
        ? request(base + '/body', {}, controller.signal)
        : request(base + '/body', { signal: controller.signal })
      controller.abort()
      await assert.rejects(pending, { name: 'AbortError' })
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('client JSON errors propagate and HTTP error pages keep their status', async () => {
  let mode = 'bad-json'
  const localRequest = vm.runInNewContext(`${source}\nfetchJson`, {
    fetch: async () => new Response(mode === 'bad-json' ? '<html>' : 'Forbidden', { status: mode === 'bad-json' ? 200 : 403 }),
    AbortController, DOMException, setTimeout, clearTimeout,
  })
  await assert.rejects(localRequest('/'), /Invalid JSON response/)
  mode = 'forbidden'
  const response = await localRequest('/')
  assert.equal(response.ok, false)
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error, 'HTTP 403')
})
