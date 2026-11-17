// Self contained so the installer can ship this to the native T3 renderer.
// T3 0.1.9 uses Tiptap and exposes its editor instance on the editor DOM node.
export function mountT3Composer({ base, token, fetchImpl = globalThis.fetch }) {
  const KEY = '__miaobiT3'
  window[KEY]?.dispose()
  let editorNode, editor, revision = 0, active, undo, rendering = false, scheduled = false, disposed = false
  let statusMessage = '', failed = false
  const root = document.createElement('span')
  root.id = 'miaobi-t3-controls'
  root.style.cssText = 'display:inline-flex;align-items:center;gap:2px;flex-shrink:0;margin-inline:2px'
  const button = document.createElement('button')
  const restore = document.createElement('button')
  const status = document.createElement('span')
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
  status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)'
  for (const b of [button, restore]) {
    b.type = 'button'
    b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 28px;border:0;border-radius:6px;background:transparent;color:var(--muted-foreground,currentColor);font-size:18px;cursor:pointer;padding:0'
    b.addEventListener('pointerdown', event => event.preventDefault())
    b.addEventListener('mouseenter', () => { b.style.background = 'var(--accent,rgba(128,128,128,.12))' })
    b.addEventListener('mouseleave', () => { b.style.background = 'transparent' })
  }
  button.id = 'miaobi-t3-enhance'; restore.id = 'miaobi-t3-restore'
  restore.textContent = '↶'; restore.title = '妙笔 · 恢复原文'; restore.setAttribute('aria-label', restore.title)
  root.append(button, restore, status)
  const identity = () => location.href
  const doc = () => editor?.getJSON()
  const signature = () => JSON.stringify(doc())
  const text = () => editor?.getText({ blockSeparator: '\n' }) ?? ''
  const say = (message, error = false) => { statusMessage = message; failed = error; status.textContent = message; render() }
  const cancel = () => { if (active) { active.controller.abort(); active = undefined } }
  const changed = () => { revision++; undo = undefined; if (active) cancel(); render() }
  const attach = () => {
    const next = [...document.querySelectorAll('[data-testid="composer-editor"]')].find(node => node.getBoundingClientRect().width > 0 && node.isContentEditable)
    if (next === editorNode) return
    cancel(); undo = undefined; editor?.off('update', changed)
    editorNode = next; editor = next?.editor; revision++; statusMessage = ''; failed = false
    editor?.on('update', changed)
  }
  const containsTokens = () => {
    let found = false
    editor?.state.doc.descendants(node => { if (node.isAtom && !node.isText && !['paragraph', 'hardBreak'].includes(node.type.name)) found = true })
    return found
  }
  function render() {
    if (rendering || disposed) return
    rendering = true
    try {
      attach()
      if (!editor || editor.isDestroyed) { root.remove(); return }
      // Mount immediately before the provider/model picker, in its flex row.
      let container = editorNode.parentElement, anchor
      for (let depth = 0; container && depth < 10; depth++, container = container.parentElement) {
        anchor = container.querySelector('button[aria-haspopup="dialog"],button[aria-haspopup="listbox"],button[aria-haspopup="menu"]')
        if (anchor && !root.contains(anchor)) break
      }
      if (!anchor) return
      let node = anchor, parent = node.parentElement
      for (let depth = 0; parent && depth < 6; depth++) {
        if (getComputedStyle(parent).display.includes('flex') && [...parent.children].some(child => child !== node && child !== root)) break
        node = parent; parent = parent.parentElement
      }
      if (parent && (root.parentElement !== parent || root.nextElementSibling !== node)) parent.insertBefore(root, node)
      const busy = !!active
      const label = busy ? '妙笔 · 正在增强，点击取消' : failed ? statusMessage : '妙笔 · 提示词增强'
      const glyph = busy ? '◌' : failed ? '!' : '✦'
      if (button.textContent !== glyph) button.textContent = glyph
      button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-busy', String(busy))
      button.disabled = !busy && (!editor.isEditable || !text().trim())
      button.style.opacity = button.disabled ? '.35' : '1'
      button.style.color = failed ? 'var(--destructive,#d85c5c)' : 'var(--muted-foreground,currentColor)'
      restore.hidden = !undo || busy
      restore.style.display = restore.hidden ? 'none' : 'inline-flex'
    } finally { rendering = false }
  }
  const write = json => {
    // JSON avoids interpreting generated angle brackets as HTML. emitUpdate is
    // essential: T3's own onUpdate persists the draft and updates sendability.
    editor.commands.setContent(json, { emitUpdate: true })
    editor.commands.focus('end')
  }
  button.addEventListener('click', async () => {
    if (active) { cancel(); say('已取消，原文没动'); return }
    attach()
    if (!editor || !text().trim()) return
    if (containsTokens()) { say('原文包含文件、技能或模型引用，请保留引用后单独增强文字；原文没动', true); return }
    if (text().length > 20000) { say('提示词超过 20000 字符，原文没动', true); return }
    const request = { controller: new AbortController(), node: editorNode, editor, rev: revision, route: identity(), before: doc(), signature: signature(), text: text() }
    active = request; failed = false; render()
    try {
      const response = await fetchImpl(base + '/enhance', { method: 'POST', headers: { 'content-type': 'application/json', 'x-miaobi-token': token }, body: JSON.stringify({ text: request.text }), signal: request.controller.signal })
      const result = await response.json()
      if (!response.ok || !result.ok || typeof result.text !== 'string' || !result.text.trim()) throw new Error(result.error ?? '增强失败')
      attach()
      if (active !== request || request.controller.signal.aborted || editor !== request.editor || editorNode !== request.node || revision !== request.rev || identity() !== request.route || signature() !== request.signature) return
      active = undefined
      write({ type: 'doc', content: result.text.split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) })
      undo = { before: request.before, after: signature(), route: request.route, editor }
      say('增强完成，可恢复原文')
    } catch (error) {
      if (!request.controller.signal.aborted && active === request) {
        const detail = error instanceof TypeError ? '本地增强服务未连接' : error.message
        say(`${detail}；原文没动`, true)
      }
    } finally { if (active === request) active = undefined; render() }
  })
  restore.addEventListener('click', () => {
    const previous = undo
    if (!previous || previous.editor !== editor || previous.route !== identity() || previous.after !== signature()) { undo = undefined; render(); return }
    undo = undefined; write(previous.before); say('已恢复原文')
  })
  const observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true; requestAnimationFrame(() => { scheduled = false; render() })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const navigate = () => { cancel(); undo = undefined; render() }
  window.addEventListener('hashchange', navigate)
  render()
  const dispose = () => { disposed = true; observer.disconnect(); cancel(); editor?.off('update', changed); window.removeEventListener('hashchange', navigate); root.remove() }
  window[KEY] = { dispose, version: '0.1.0' }
  return window[KEY]
}
