import test from 'node:test'
import assert from 'node:assert/strict'

const adapter = await import('../adapters/t3/service.mjs').catch(() => ({}))
const native = await import('../adapters/t3/composer.mjs').catch(() => ({}))

test('T3 exposes an authenticated local service and a native composer adapter', () => {
  assert.equal(typeof adapter.startService, 'function', 'T3 local service is missing')
  assert.equal(typeof native.mountT3Composer, 'function', 'T3 composer adapter is missing')
})

test('service rejects foreign pages and missing authorization before invoking the model', async () => {
  if (!adapter.startService) return
  let calls = 0
  const server = await adapter.startService({ token: 'test-token', port: 0, provider: { enhance: async () => { calls++; return '增强结果' } } })
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    for (const headers of [{ origin: 'https://evil.example', 'x-miaobi-token': 'test-token' }, { origin: 't3code://app' }]) {
      const r = await fetch(base + '/enhance', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ text: '草稿' }) })
      assert.equal(r.status, 403)
    }
    assert.equal(calls, 0)
    const r = await fetch(base + '/enhance', { method: 'POST', headers: { origin: 't3code://app', 'x-miaobi-token': 'test-token', 'content-type': 'application/json' }, body: JSON.stringify({ text: '草稿' }) })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).text, '增强结果')
    assert.equal(calls, 1)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('closing a request aborts its model call', async () => {
  if (!adapter.startService) return
  let aborted = false
  let started
  const ready = new Promise(resolve => { started = resolve })
  const server = await adapter.startService({ token: 'test-token', port: 0, provider: { enhance: (_text, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')) }, { once: true }); started()
  }) } })
  try {
    const controller = new AbortController()
    const request = fetch(`http://127.0.0.1:${server.address().port}/enhance`, { method: 'POST', headers: { origin: 't3code://app', 'x-miaobi-token': 'test-token', 'content-type': 'application/json' }, body: JSON.stringify({ text: '取消测试' }), signal: controller.signal }).catch(() => {})
    await ready; controller.abort(); await request
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(aborted, true)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('invalid input and provider failures do not return replacement text', async () => {
  if (!adapter.startService) return
  const server = await adapter.startService({ token: 'test-token', port: 0, provider: { enhance: async () => { throw new Error('secret diagnostic') } } })
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    for (const body of ['{', JSON.stringify({ text: '' }), JSON.stringify({ text: 'x'.repeat(20001) }), JSON.stringify({ text: '有效草稿' })]) {
      const r = await fetch(base + '/enhance', { method: 'POST', headers: { origin: 't3code://app', 'x-miaobi-token': 'test-token', 'content-type': 'application/json' }, body })
      const result = await r.json()
      assert.equal(result.ok, false)
      assert.equal(result.text, undefined)
      assert.equal(JSON.stringify(result).includes('secret diagnostic'), false)
    }
  } finally { await new Promise(resolve => server.close(resolve)) }
})
