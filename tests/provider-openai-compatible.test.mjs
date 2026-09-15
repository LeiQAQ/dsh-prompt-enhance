import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderError, createDeepSeekProvider, createLocalProvider } from '../src/providers/openai-compatible.js'

function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload }
}

test('OpenAI-compatible provider sends only the draft and configured request fields', async () => {
  let request
  const provider = createDeepSeekProvider({
    endpoint: 'https://example.test/chat/completions',
    apiKey: 'test-key',
    model: 'deepseek-chat',
    systemPrompt: 'system',
    fetchImpl: async (...args) => {
      request = args
      return response({ choices: [{ message: { content: 'rewritten' } }] })
    },
  })

  assert.equal(await provider.enhance('draft'), 'rewritten')
  assert.equal(request[0], 'https://example.test/chat/completions')
  assert.equal(request[1].headers.authorization, 'Bearer test-key')
  assert.deepEqual(JSON.parse(request[1].body), {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'draft' },
    ],
    stream: false,
  })
})

test('local provider omits authorization when no key is configured', async () => {
  let request
  const provider = createLocalProvider({
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    model: 'local-model',
    fetchImpl: async (...args) => { request = args; return response({ choices: [{ message: { content: 'ok' } }] }) },
  })
  await provider.enhance('draft')
  assert.equal(request[1].headers.authorization, undefined)
})

test('provider classifies HTTP and malformed responses', async () => {
  const httpFailure = createDeepSeekProvider({
    endpoint: 'https://example.test',
    model: 'm',
    fetchImpl: async () => response({ error: { message: 'bad key' } }, false, 401),
  })
  await assert.rejects(() => httpFailure.enhance('draft'), error => {
    assert.equal(error instanceof ProviderError, true)
    assert.equal(error.code, 'http_error')
    assert.match(error.message, /bad key/u)
    return true
  })

  const malformed = createLocalProvider({
    endpoint: 'http://example.test',
    model: 'm',
    fetchImpl: async () => response({ choices: [] }),
  })
  await assert.rejects(() => malformed.enhance('draft'), /choices\[0\]\.message\.content/u)
})
