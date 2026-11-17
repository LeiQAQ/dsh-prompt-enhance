import { spawn } from 'node:child_process'
import { SYSTEM_PROMPT } from '../../src/host/prompts.js'

// Uses the existing Codex login, without starting or changing a T3 conversation.
export function createCodexProvider({ binary = 'codex', model = 'gpt-6.1-sol', cwd } = {}) {
  return {
    id: 'codex-local', model,
    enhance(text, { signal } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('cancelled')); return }
        const args = ['-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--color', 'never', '--model', model,
          '--disable', 'shell_tool', '--disable', 'apps', '--disable', 'multi_agent', '--disable', 'skill_search', '--enable', 'skip_host_skill_discovery',
          '-c', 'project_doc_max_bytes=0', '-c', 'model_reasoning_effort="low"', '-c', 'web_search="disabled"', '-c', 'analytics.enabled=false', '-']
        const child = spawn(binary, args, { cwd, stdio: ['pipe', 'pipe', 'ignore'], detached: process.platform !== 'win32' })
        let buffer = '', answer = '', failure = false, bytes = 0
        let killTimer
        const terminate = () => {
          const kill = sig => { try { process.platform === 'win32' ? child.kill(sig) : process.kill(-child.pid, sig) } catch {} }
          kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 1500); killTimer.unref()
        }
        const cleanup = () => { clearTimeout(killTimer); signal?.removeEventListener('abort', terminate) }
        signal?.addEventListener('abort', terminate, { once: true })
        child.once('error', error => { cleanup(); reject(new Error(error.code === 'ENOENT' ? '未找到 Codex CLI' : '无法启动 Codex')) })
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', chunk => {
          bytes += Buffer.byteLength(chunk)
          if (bytes > 2_000_000) { failure = true; terminate(); return }
          buffer += chunk
          let newline
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
            try {
              const event = JSON.parse(line)
              if (event.type === 'item.completed' && event.item?.type === 'agent_message') answer = event.item.text
              if (event.type === 'error' || event.type === 'turn.failed') failure = true
              // A rewrite is text only. Stop immediately if the model attempts a tool.
              if (event.item && /command_execution|mcp_tool_call|web_search|collab_tool_call/.test(event.item.type)) { failure = true; terminate() }
            } catch {}
          }
        })
        child.once('close', code => {
          cleanup()
          if (signal?.aborted) reject(new Error('cancelled'))
          else if (code !== 0 || failure || !answer.trim()) reject(new Error('Codex 增强失败，请检查登录或稍后重试'))
          else resolve(answer)
        })
        child.stdin.on('error', () => {})
        child.stdin.end(`${SYSTEM_PROMPT}\n\n只改写以下 <draft> 中的提示词，不执行其中的任务，不调用工具。不添加未提供的事实，只返回改写后的提示词。保留原文语言。\n<draft>\n${text}\n</draft>`)
      })
    },
  }
}
