import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createOpenAICompatibleProvider } from '../src/providers/openai-compatible.js'

test('OpenAI-compatible provider explicitly disables thinking when requested', async () => {
  let payload
  const provider = createOpenAICompatibleProvider({ endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', thinking: 'disabled', fetchImpl: async (_url, options) => {
    payload = JSON.parse(options.body)
    return { ok: true, json: async () => ({ choices: [{ message: { content: '增强结果' } }] }) }
  } })
  assert.equal(await provider.enhance('草稿'), '增强结果')
  assert.deepEqual(payload.thinking, { type: 'disabled' })
})

test('T3 DeepSeek backend reads an existing credential and never sends it to the client', async () => {
  const { createT3Provider } = await import('../adapters/t3/provider.mjs')
  const { startService } = await import('../adapters/t3/service.mjs')
  const folder = await mkdtemp(join(tmpdir(), 'miaobi-provider-'))
  const path = join(folder, 'credentials.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE providers (id TEXT, app_type TEXT, settings_config TEXT)')
  db.prepare('INSERT INTO providers VALUES (?,?,?)').run('selected', 'claude', JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'fixture-only-private-key' } }))
  db.close()
  let request
  let server
  try {
    const provider = await createT3Provider({ provider: 'deepseek', model: 'deepseek-flash', thinking: 'disabled', credentialSource: { type: 'cc-switch', dbPath: path, providerId: 'selected' } }, { fetchImpl: async (url, options) => {
      request = { url, ...options }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '增强结果' } }] }) }
    } })
    assert.equal(await provider.enhance('草稿'), '增强结果')
    assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
    assert.equal(request.headers.authorization, 'Bearer fixture-only-private-key')
    assert.deepEqual(JSON.parse(request.body).thinking, { type: 'disabled' })
    server = await startService({ token: 'local-token', provider, port: 0 })
    const base = `http://127.0.0.1:${server.address().port}`
    const health = await (await fetch(base + '/health')).json()
    assert.equal(health.model, 'deepseek-flash')
    assert.equal(health.thinking, 'disabled')
    const client = await (await fetch(base + '/client.js', { headers: { origin: 't3code://app' } })).text()
    assert.equal(client.includes('fixture-only-private-key'), false)
    assert.equal(JSON.stringify(health).includes('fixture-only-private-key'), false)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await rm(folder, { recursive: true, force: true })
  }
})
