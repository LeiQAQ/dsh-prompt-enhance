import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createEnhancer } from '../../src/core/enhance.js'
import { createT3Provider } from './provider.mjs'
import { mountT3Composer } from './composer.mjs'

export async function startService({ token, port = 18766, provider, timeoutMs = 120000 } = {}) {
  if (!token) throw new Error('A local installation token is required')
  const enhancer = createEnhancer({ provider, timeoutMs })
  let busy = false
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    const allowed = origin === 't3code://app' || origin === 't3code-dev://app'
    if (origin && !allowed) { res.writeHead(403).end(); return }
    if (allowed) res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin'); res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    if (req.method === 'OPTIONS' && allowed) {
      res.setHeader('access-control-allow-headers', 'content-type,x-miaobi-token')
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
      res.writeHead(204).end(); return
    }
    const reply = (code, payload) => { if (!res.destroyed) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)) } }
    if (req.method === 'GET' && req.url === '/health') { reply(200, { ok: true, adapter: 'miaobi-t3', version: '0.1.0', provider: provider.id, model: provider.model, thinking: provider.thinking, busy }); return }
    // Client contains no provider credentials. The bootstrap's installation
    // token authenticates draft requests; arbitrary websites fail Origin checks.
    if (req.method === 'GET' && req.url === '/client.js' && allowed) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(`(${mountT3Composer.toString()})(${JSON.stringify({ base: `http://127.0.0.1:${server.address().port}`, token })});`); return
    }
    if (req.method !== 'POST' || req.url !== '/enhance') { reply(404, { ok: false }); return }
    if (!allowed || req.headers['x-miaobi-token'] !== token) { reply(403, { ok: false, error: '请求未授权' }); return }
    if (busy) { reply(429, { ok: false, error: '已有提示词正在增强，请稍后重试' }); return }
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 100000) { reply(413, { ok: false, error: '提示词太长' }); return }
        chunks.push(chunk)
      }
      let input
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { reply(400, { ok: false, error: '请求格式错误' }); return }
      if (busy) { reply(429, { ok: false, error: '已有提示词正在增强' }); return }
      busy = true
      try {
        const result = await enhancer.enhance(input.text, { signal: controller.signal })
        if (result.ok) reply(200, { ok: true, text: result.text })
        else reply(422, { ok: false, code: result.code, error: result.code === 'timeout' ? '增强超时，请重试' : '增强失败，请检查模型服务配置或稍后重试' })
      } finally { busy = false }
    } catch { reply(400, { ok: false, error: '请求中断或格式错误' }) }
  })
  server.requestTimeout = timeoutMs + 10000
  server.headersTimeout = 10000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2] ?? join(homedir(), '.t3', 'miaobi', 'config.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const cwd = join(dirname(configPath), 'empty-workspace')
  await mkdir(cwd, { recursive: true })
  const provider = await createT3Provider(config, { cwd })
  const server = await startService({ ...config, provider })
  console.log('miaobi-t3: listening on 127.0.0.1:' + server.address().port)
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { server.closeAllConnections(); server.close(() => process.exit(0)) })
}
