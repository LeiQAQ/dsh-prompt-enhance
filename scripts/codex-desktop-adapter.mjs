/**
 * Runtime Codex Desktop composer adapter.
 *
 * This is an external, opt-in adapter. It connects to a Codex renderer that
 * was explicitly started with a Chromium DevTools Protocol endpoint, mounts a
 * small toolbar button, and talks to a localhost enhancement helper. It never
 * edits Codex's installed files or ASAR.
 *
 * Required environment:
 *   PROMPT_ENHANCE_ENDPOINT - DeepSeek or local OpenAI-compatible endpoint
 *   PROMPT_ENHANCE_MODEL    - model name accepted by that endpoint
 * Optional:
 *   PROMPT_ENHANCE_API_KEY  - bearer token; omitted for local services
 *   PROMPT_ENHANCE_CDP_URL  - default http://127.0.0.1:9222
 *   PROMPT_ENHANCE_PORT     - helper port, default 18765
 *   PROMPT_ENHANCE_TIMEOUT_MS - default 120000
 *
 * @module dsh-prompt-enhance/codex-desktop-adapter
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createEnhancer } from '../src/core/enhance.js'
import { createOpenAICompatibleProvider } from '../src/providers/openai-compatible.js'

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222'
const DEFAULT_HELPER_PORT = 18765
const DEFAULT_TIMEOUT_MS = 120_000
const INJECTED_KEY = '__dshPromptEnhanceAdapter__'
const BINDING_NAME = '__dshPromptEnhanceSend'
const RECEIVE_NAME = '__dshPromptEnhanceReceive'

const LIVE_COMPOSER_PROBE = [
  'Array.from(document.querySelectorAll(".ProseMirror")).some(node =>',
  '  node.isContentEditable &&',
  '  (node.checkVisibility?.() ?? true) &&',
  '  node.getBoundingClientRect().height > 0)',
].join(' ')

const isOverlayPage = target => typeof target?.url === 'string' && /initialRoute=|detached-window/u.test(target.url)

/** Minimal CDP client over Node's built-in WebSocket implementation. */
export class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.eventListeners = new Set()
    socket.addEventListener('message', event => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.method !== undefined) {
        for (const listener of this.eventListeners) {
          try { listener(message) } catch { /* listener errors must not break the pump */ }
        }
      }
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) pending.reject(new Error(message.error.message ?? 'CDP error'))
      else pending.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP socket closed'))
      this.pending.clear()
      this.eventListeners.clear()
    })
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return new CdpClient(socket)
  }

  call(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  onEvent(listener) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  close() { this.socket.close() }
}

/** Fetch available CDP page targets. */
export async function listCdpTargets(cdpUrl, fetchImpl = globalThis.fetch) {
  const base = cdpUrl.replace(/\/$/u, '')
  const response = await fetchImpl(`${base}/json/list`)
  if (!response.ok) throw new Error(`CDP target listing failed: HTTP ${response.status}`)
  const targets = await response.json()
  return Array.isArray(targets) ? targets.filter(target => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string') : []
}

/**
 * Build the browser-side script. It is intentionally self-contained so the
 * CDP adapter has no dependency on React internals or a private IPC channel.
 */
export function createInjectionSource(helperUrl, authToken = '') {
  return `(() => {
    const KEY = ${JSON.stringify(INJECTED_KEY)};
    const BUTTON_ID = 'dsh-prompt-enhance-button';
    const HELPER = ${JSON.stringify(helperUrl)};
    const TOKEN = ${JSON.stringify(authToken)};
    const GENERATION = String(Date.now()) + '-' + String(Math.random());
    const state = window[KEY] || { revision: 0, editor: null, controller: null, observer: null };
    window[KEY] = state;
    state.controller?.abort();
    state.controller = null;
    state.observer?.disconnect();

    const visible = element => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const editor = () => [...document.querySelectorAll('.ProseMirror')].find(node => visible(node) && node.isContentEditable);
    const read = node => (node?.innerText ?? node?.textContent ?? '').replace(/\\u00a0/gu, ' ');
    const identity = () => document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') ?? location.href;
    const currentEditor = () => {
      const next = editor();
      if (next !== state.editor) {
        state.editor?.removeEventListener('input', state.onInput);
        state.editor = next ?? null;
        state.revision = 0;
        state.editor?.addEventListener('input', state.onInput);
      }
      return state.editor;
    };
    state.onInput ||= () => { state.revision += 1; };

    const setMessage = (button, message, error = false) => {
      button.title = message;
      button.dataset.state = error ? 'error' : 'ready';
    };
    const write = (node, text) => {
      node.focus();
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted || read(node) !== text) {
        const fragment = document.createDocumentFragment();
        const lines = text.split('\\n');
        lines.forEach((line, index) => {
          if (index > 0) fragment.appendChild(document.createElement('br'));
          fragment.appendChild(document.createTextNode(line));
        });
        node.replaceChildren(fragment);
        node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
      return read(node) === text;
    };
    const mount = () => {
      const anchor = document.querySelector('[data-composer-navigation-target="reasoning"]')
        || document.querySelector('[data-composer-navigation-target="permissions"]');
      if (anchor?.parentElement) {
        /* The composer wraps toolbar controls in narrow single-child slot
         * chains (display:contents spans, fixed-width wrappers). Inserting
         * inside the chain overlaps the reasoning/model picker. Walk up
         * through trivial containers - a container is trivial when it has
         * one element child, or when its extra child is our own button from
         * the previous render - and insert before the whole chain at the
         * first container that lays out multiple real siblings. */
        let node = anchor;
        let parent = node.parentElement;
        let depth = 0;
        while (parent && depth < 8) {
          const cs = getComputedStyle(parent);
          const others = [...parent.children].filter(child => child.id !== BUTTON_ID);
          /* Stop at the innermost real flex row - it distributes width and
           * gap properly, so the button lands immediately left of the
           * reasoning/model picker. Keep climbing through display:contents
           * wrappers and fixed-width single-child slot chains. */
          const stop = cs.display.startsWith('flex') || (others.length > 1 && cs.display !== 'contents');
          if (stop) break;
          node = parent;
          parent = node.parentElement;
          depth += 1;
        }
        if (parent) return { parent, before: node };
        return { parent: anchor.parentElement, before: anchor };
      }
      const node = currentEditor();
      let candidate = node;
      for (let depth = 0; candidate && depth < 8; depth += 1) {
        if (candidate.querySelector?.('button')) return { parent: candidate, before: null };
        candidate = candidate.parentElement;
      }
      return null;
    };
    const run = async button => {
      const node = currentEditor();
      const original = read(node);
      if (original.trim().length === 0) { setMessage(button, '请先输入提示词', true); return; }
      if (state.controller !== null) {
        /* Second click during a request is the PRD cancellation path. */
        if (state.currentReqId && typeof window[${JSON.stringify(BINDING_NAME)}] === 'function') {
          try { window[${JSON.stringify(BINDING_NAME)}](JSON.stringify({ reqId: state.currentReqId, cancel: true })); } catch (error) {}
        }
        state.controller.abort();
        return;
      }
      const baseline = { node, original, revision: state.revision, identity: identity() };
      const controller = new AbortController();
      state.controller = controller;
      /* Keep the control clickable while busy: a second click is the PRD
       * cancellation path and must abort the provider request. */
      button.disabled = false;
      button.dataset.state = 'busy';
      button.textContent = '…';
      button.title = '正在增强，点击取消';
      try {
        let text;
        if (typeof window[${JSON.stringify(BINDING_NAME)}] === 'function') {
          /* CDP binding transport: the Codex page CSP (connect-src 'self')
           * blocks http://127.0.0.1 helper requests, so the request rides
           * the Runtime.addBinding channel to the adapter process instead. */
          const reqId = String(Date.now()) + '-' + String(Math.random());
          state.currentReqId = reqId;
          const response = await new Promise((resolve, reject) => {
            state.pending = state.pending || {};
            const timeout = setTimeout(() => {
              if (state.pending[reqId]) {
                delete state.pending[reqId];
                reject(new Error('增强请求超时'));
              }
            }, 90000);
            state.pending[reqId] = {
              settle: payload => {
                clearTimeout(timeout);
                delete state.pending[reqId];
                if (payload && payload.cancelled) resolve({ cancelled: true });
                else if (payload && payload.ok) resolve({ text: payload.text });
                else reject(new Error((payload && payload.error) || '增强失败'));
              },
            };
            window[${JSON.stringify(BINDING_NAME)}](JSON.stringify({ reqId: reqId, text: original }));
            controller.signal.addEventListener('abort', () => {
              if (state.pending[reqId]) {
                delete state.pending[reqId];
                clearTimeout(timeout);
                resolve({ cancelled: true });
              }
            }, { once: true });
          });
          if (response.cancelled) return;
          if (typeof response.text !== 'string' || response.text.trim().length === 0) throw new Error('增强服务未返回有效结果');
          text = response.text;
        } else {
          const response = await fetch(HELPER + '/enhance', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-prompt-enhance-token': TOKEN },
            body: JSON.stringify({ text: original }),
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok || typeof payload.text !== 'string' || payload.text.trim().length === 0) {
            throw new Error(payload.error || '增强服务未返回有效结果');
          }
          text = payload.text;
        }
        const live = currentEditor();
        if (controller.signal.aborted || live !== baseline.node || state.revision !== baseline.revision || read(live) !== baseline.original || identity() !== baseline.identity) {
          setMessage(button, '输入已变化，已丢弃旧结果', true);
          return;
        }
        if (!write(live, text)) throw new Error('增强结果回填失败');
        setMessage(button, '提示词增强完成');
      } catch (error) {
        if (!controller.signal.aborted) setMessage(button, error instanceof Error ? error.message : String(error), true);
      } finally {
        if (state.controller === controller) { state.controller = null; state.currentReqId = null; }
        button.disabled = false;
        button.textContent = '✦';
        if (button.dataset.state === 'busy') setMessage(button, '提示词增强');
      }
    };
    window[${JSON.stringify(RECEIVE_NAME)}] = (reqId, resultJson) => {
      const entry = state.pending && state.pending[reqId];
      if (!entry) return;
      let payload;
      try { payload = JSON.parse(resultJson); } catch (error) { entry.settle({ ok: false, error: '适配器返回解析失败' }); return; }
      entry.settle(payload);
    };
    const onClick = event => {
      const target = event.target;
      const button = target && typeof target.closest === 'function' ? target.closest('#' + BUTTON_ID) : null;
      if (button) void run(button);
    };
    const render = () => {
      currentEditor();
      const target = mount();
      if (target === null) return;
      let button = document.getElementById(BUTTON_ID);
      /* Older injections did not retain their listener reference. On the first
       * re-injection, cloning the existing node removes stale listeners before
       * this generation binds the current helper/token. */
      if (button !== null && button.dataset.dshPromptEnhanceGeneration !== GENERATION) {
        const fresh = button.cloneNode(true);
        button.replaceWith(fresh);
        button = fresh;
      }
      if (button === null) {
        button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = '✦';
        button.setAttribute('aria-label', '提示词增强');
        button.title = '提示词增强';
        button.dataset.state = 'ready';
        button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:30px;height:28px;flex:0 0 30px;padding:0;margin:0 4px;border:0;border-radius:7px;background:transparent;color:inherit;font-family:"Segoe UI Symbol","Noto Sans Symbols 2",system-ui,sans-serif;font-size:17px;font-weight:600;line-height:1;cursor:pointer;';
      }
      /* Clicks are delegated on document: Codex re-renders replace the button
       * node wholesale (attributes cloned, per-node listeners lost), and a
       * document-level listener survives every replacement. */
      button.dataset.dshPromptEnhanceGeneration = GENERATION;
      state.generation = GENERATION;
      if (button.dataset.state === 'busy') {
        /* run() owns the busy affordance. */
      } else if (button.dataset.state === 'error') {
        /* Keep the error message visible until the next action. */
        if (button.textContent !== '✦') button.textContent = '✦';
      } else {
        if (button.textContent !== '✦') button.textContent = '✦';
        if (button.dataset.state !== 'ready') button.dataset.state = 'ready';
        if (button.title !== '提示词增强' && button.title !== '提示词增强完成') button.title = '提示词增强';
      }
      if (button.parentElement !== target.parent || (target.before !== null && button.nextElementSibling !== target.before)) {
        if (target.before !== null) target.parent.insertBefore(button, target.before);
        else target.parent.appendChild(button);
      }
    };
    if (state.onDocumentClick) document.removeEventListener('click', state.onDocumentClick);
    state.onDocumentClick = onClick;
    document.addEventListener('click', onClick);
    let renderQueued = false;
    const scheduleRender = () => {
      if (renderQueued) return;
      renderQueued = true;
      queueMicrotask(() => { renderQueued = false; render(); });
    };
    state.observer?.disconnect();
    state.observer = new MutationObserver(() => scheduleRender());
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    render();
    return { installed: document.getElementById(BUTTON_ID) !== null, editor: Boolean(currentEditor()) };
  })()`
}

export async function startHelper({ endpoint, model, apiKey, port, timeoutMs, authToken }) {
  const provider = createOpenAICompatibleProvider({ endpoint, model, apiKey })
  const enhancer = createEnhancer({ provider, timeoutMs })
  const server = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type,x-prompt-enhance-token')
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    if (request.method !== 'POST' || request.url !== '/enhance') { response.writeHead(404); response.end(); return }
    if (request.headers['x-prompt-enhance-token'] !== authToken) { response.writeHead(403); response.end(JSON.stringify({ error: 'invalid adapter token' })); return }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const result = await enhancer.enhance(body.text, { signal: request.signal })
      response.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' })
      response.end(JSON.stringify(result.ok ? { text: result.text, provider: result.provider, model: result.model } : { error: result.detail, code: result.code }))
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error), code: 'internal' }))
    }
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  return server
}

/** Attach to the first page that contains the current Codex composer. */
export async function injectIntoCodex({ cdpUrl = DEFAULT_CDP_URL, helperUrl, authToken = '', fetchImpl = globalThis.fetch } = {}) {
  const targets = await listCdpTargets(cdpUrl, fetchImpl)
  /* Overlay pages (avatar-overlay, detached-window) may contain a dormant
   * .ProseMirror node but never the live composer. Probe for a visible,
   * editable editor and prefer the primary window when sorting. */
  targets.sort((a, b) => Number(isOverlayPage(a)) - Number(isOverlayPage(b)))
  for (const target of targets) {
    let client
    try {
      client = await CdpClient.connect(target.webSocketDebuggerUrl)
      const probe = await client.call('Runtime.evaluate', {
        expression: LIVE_COMPOSER_PROBE,
        returnByValue: true,
      })
      if (probe?.result?.value !== true) { client.close(); continue }
      await client.call('Page.addScriptToEvaluateOnNewDocument', { source: createInjectionSource(helperUrl, authToken) })
      const result = await client.call('Runtime.evaluate', { expression: createInjectionSource(helperUrl, authToken), returnByValue: true, awaitPromise: true })
      return { target, result: result?.result?.value, client }
    } catch (error) {
      client?.close()
      if (targets.length === 1) throw error
    }
  }
  throw new Error('没有找到包含 .ProseMirror composer 的 Codex 页面；请用 --remote-debugging-port 启动 Codex')
}

async function main() {
  const endpoint = process.env.PROMPT_ENHANCE_ENDPOINT
  const model = process.env.PROMPT_ENHANCE_MODEL
  if (typeof endpoint !== 'string' || endpoint.length === 0 || typeof model !== 'string' || model.length === 0) {
    throw new Error('请设置 PROMPT_ENHANCE_ENDPOINT 和 PROMPT_ENHANCE_MODEL；API Key 使用 PROMPT_ENHANCE_API_KEY')
  }
  const port = Number(process.env.PROMPT_ENHANCE_PORT ?? DEFAULT_HELPER_PORT)
  const timeoutMs = Number(process.env.PROMPT_ENHANCE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  const cdpUrl = process.env.PROMPT_ENHANCE_CDP_URL ?? DEFAULT_CDP_URL
  const authToken = randomUUID()
  const server = await startHelper({ endpoint, model, apiKey: process.env.PROMPT_ENHANCE_API_KEY, port, timeoutMs, authToken })
  const helperUrl = `http://127.0.0.1:${port}`
  const attached = await injectIntoCodex({ cdpUrl, helperUrl, authToken })
  /* Binding transport: the Codex page CSP (connect-src 'self') blocks
   * renderer fetches to the localhost helper, so enhancement requests ride
   * Runtime.addBinding into this process, which owns the DeepSeek call and
   * returns the result through a page-side receive callback. */
  const enhancer = createEnhancer({
    provider: createOpenAICompatibleProvider({ endpoint, model, apiKey: process.env.PROMPT_ENHANCE_API_KEY }),
    timeoutMs,
  })
  const inflight = new Map()
  const client = attached.client
  await client.call('Runtime.enable')
  await client.call('Runtime.addBinding', { name: BINDING_NAME })
  client.onEvent(message => {
    if (message.method !== 'Runtime.bindingCalled' || message.params?.name !== BINDING_NAME) return
    let payload
    try { payload = JSON.parse(message.params.payload) } catch { return }
    if (payload.cancel && typeof payload.reqId === 'string') {
      inflight.get(payload.reqId)?.abort()
      return
    }
    if (typeof payload.text !== 'string' || typeof payload.reqId !== 'string') return
    const reqId = payload.reqId
    const controller = new AbortController()
    inflight.set(reqId, controller)
    void (async () => {
      let result
      try {
        const enhanced = await enhancer.enhance(payload.text, { signal: controller.signal })
        result = enhanced.ok
          ? { ok: true, text: enhanced.text }
          : { ok: false, error: enhanced.detail ?? '增强失败' }
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      } finally {
        inflight.delete(reqId)
      }
      const expression = `typeof window[${JSON.stringify(RECEIVE_NAME)}] === 'function' && window[${JSON.stringify(RECEIVE_NAME)}](${JSON.stringify(reqId)}, ${JSON.stringify(JSON.stringify(result))})`
      try { await client.call('Runtime.evaluate', { expression, returnByValue: true }) } catch { /* page navigated away; pending entry times out */ }
    })()
  })
  console.log(JSON.stringify({ ok: true, button: attached.result?.installed === true, editor: attached.result?.editor === true, target: attached.target.url, helper: helperUrl }))
  process.on('SIGINT', () => { attached.client.close(); server.close(() => process.exit(0)) })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(`codex-adapter: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
