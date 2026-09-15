import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInjectionSource, listCdpTargets, startHelper } from '../scripts/codex-desktop-adapter.mjs'

test('Codex injection source contains the PRD flow and safety gates', () => {
  const source = createInjectionSource('http://127.0.0.1:18765', 'test-token')
  assert.match(source, /data-composer-navigation-target="reasoning"/u)
  assert.match(source, /\.ProseMirror/u)
  assert.match(source, /const original = read\(node\)/u)
  assert.equal(source.includes("fetch(HELPER + '/enhance'"), true)
  assert.match(source, /x-prompt-enhance-token/u)
  assert.match(source, /state\.revision !== baseline\.revision/u)
  assert.match(source, /identity\(\) !== baseline\.identity/u)
  assert.match(source, /write\(live, text\)/u)
  assert.match(source, /document\.execCommand\('insertText'/u)
})

test('CDP target discovery only returns page targets with debugger sockets', async () => {
  const targets = await listCdpTargets('http://127.0.0.1:9222', async () => ({
    ok: true,
    json: async () => [
      { type: 'page', webSocketDebuggerUrl: 'ws://page' },
      { type: 'service_worker', webSocketDebuggerUrl: 'ws://worker' },
      { type: 'page' },
    ],
  }))
  assert.deepEqual(targets, [{ type: 'page', webSocketDebuggerUrl: 'ws://page' }])
})

test('localhost helper enforces its token and returns the enhanced result', async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'enhanced by test provider' } }] }))
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = upstream.address().port
  const helper = await startHelper({
    endpoint: `http://127.0.0.1:${upstreamPort}/chat/completions`,
    model: 'test-model',
    port: 0,
    timeoutMs: 1000,
    authToken: 'test-token',
  })
  const helperPort = helper.address().port
  const url = `http://127.0.0.1:${helperPort}/enhance`
  const denied = await fetch(url, { method: 'POST', body: JSON.stringify({ text: 'draft' }) })
  assert.equal(denied.status, 403)
  const accepted = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-prompt-enhance-token': 'test-token' },
    body: JSON.stringify({ text: 'draft' }),
  })
  assert.equal(accepted.status, 200)
  assert.deepEqual(await accepted.json(), { text: 'enhanced by test provider', provider: 'openai-compatible', model: 'test-model' })
  await new Promise(resolve => helper.close(resolve))
  await new Promise(resolve => upstream.close(resolve))
})
