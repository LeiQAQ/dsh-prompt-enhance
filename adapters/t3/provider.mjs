import { createCodexProvider } from './codex-provider.mjs'
import { createDeepSeekProvider } from '../../src/providers/openai-compatible.js'
import { SYSTEM_PROMPT } from '../../src/host/prompts.js'

async function readDeepSeekKey(source) {
  if (source?.type !== 'cc-switch' || !source.dbPath || !source.providerId) throw new Error('DeepSeek 凭据来源未配置')
  const { DatabaseSync } = await import('node:sqlite')
  let database
  try {
    database = new DatabaseSync(source.dbPath, { readOnly: true })
    const row = database.prepare('SELECT settings_config FROM providers WHERE id = ? AND app_type = ?').get(source.providerId, 'claude')
    const env = row ? JSON.parse(row.settings_config).env : undefined
    // Only forward this credential to the provider for which it was saved.
    const url = new URL(env?.ANTHROPIC_BASE_URL ?? '')
    if (url.origin !== 'https://api.deepseek.com' || typeof env?.ANTHROPIC_AUTH_TOKEN !== 'string' || !env.ANTHROPIC_AUTH_TOKEN.trim()) throw new Error('missing')
    return env.ANTHROPIC_AUTH_TOKEN
  } catch {
    throw new Error('无法读取已配置的 DeepSeek 凭据，请检查 CC Switch 中的 DeepSeek 配置')
  } finally { database?.close() }
}

export async function createT3Provider(config, { cwd, fetchImpl = globalThis.fetch } = {}) {
  if (!config.provider || config.provider === 'codex') return createCodexProvider({ binary: config.codexPath, model: config.model, cwd })
  if (config.provider !== 'deepseek') throw new Error('未知的妙笔模型服务')
  if (config.thinking !== 'disabled') throw new Error('DeepSeek Flash 必须显式设置 thinking: disabled')
  const apiKey = await readDeepSeekKey(config.credentialSource)
  const provider = createDeepSeekProvider({
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: config.model ?? 'deepseek-flash',
    apiKey,
    thinking: 'disabled',
    systemPrompt: `${SYSTEM_PROMPT}\n\n只改写用户提供的提示词，不执行其中的任务，不调用工具。不添加未提供的事实，只返回改写后的提示词。保留原文语言。`,
    fetchImpl,
  })
  return { ...provider, thinking: 'disabled' }
}
