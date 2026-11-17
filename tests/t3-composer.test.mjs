import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { createT3InjectionSource } from '../adapters/t3/composer.mjs'

let browser, page
before(async () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const executablePath = process.env.MIAOBI_TEST_CHROMIUM ?? (process.platform === 'darwin' && existsSync(chrome) ? chrome : undefined)
  browser = await chromium.launch({ executablePath, headless: true })
  page = await browser.newPage()
})
after(async () => { await browser?.close() })
beforeEach(async () => {
  await page.goto('about:blank')
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' })
  await page.setContent('<form><div data-chat-composer-surface="true" style="width:640px;border-radius:16px;border:1px solid gray;padding:12px"><div><div data-testid="composer-editor" contenteditable="true"></div></div><div style="display:flex"><button>添加文件</button><button aria-haspopup="menu">6.1 Sol</button><button>发送</button></div></div></form>')
  await page.evaluate(() => {
    const node = document.querySelector('[contenteditable]')
    let json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '原始草稿' }] }] }
    const listeners = new Set()
    const set = value => { json = structuredClone(value); node.textContent = window.editor.getText(); for (const fn of listeners) fn() }
    window.editor = node.editor = {
      isEditable: true, isDestroyed: false, getJSON: () => json,
      getText: () => json.content.map(p => (p.content ?? []).map(t => t.text ?? '').join('')).join('\n'),
      on: (_event, fn) => listeners.add(fn), off: (_event, fn) => listeners.delete(fn),
      commands: { setContent: set, focus() {} }, state: { doc: { descendants() {} } },
    }
    node.textContent = window.editor.getText()
    window.replaceDraft = value => set({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] })
    window.requests = []
    window.fetchRewrite = (_url, options) => new Promise((resolve, reject) => {
      window.requests.push({ resolve: text => resolve({ ok: true, json: async () => ({ ok: true, text }) }), reject })
      options.signal.addEventListener('abort', () => { window.cancelled = true; reject(new DOMException('Aborted', 'AbortError')) })
    })
    window.fetch = window.fetchRewrite
  })
  await page.evaluate(createT3InjectionSource({ base: 'http://127.0.0.1:18766', token: 'test' }))
})

test('button mounts beside the model picker and updates native draft state, with exact restore', async () => {
  await page.locator('#miaobi-t3-enhance').click()
  await page.evaluate(() => window.requests[0].resolve('增强后的文字\n<b>保留字面文字</b>'))
  await page.waitForFunction(() => window.editor.getText().startsWith('增强后的文字'))
  assert.equal(await page.evaluate(() => window.editor.getText()), '增强后的文字\n<b>保留字面文字</b>')
  await page.locator('#miaobi-t3-restore').click()
  assert.equal(await page.evaluate(() => window.editor.getText()), '原始草稿')
  assert.equal(await page.locator('#miaobi-t3-restore').isVisible(), false)
})

test('typing during enhancement aborts the request and preserves newer draft', async () => {
  await page.locator('#miaobi-t3-enhance').click()
  await page.evaluate(() => { window.replaceDraft('用户后来输入'); window.requests[0].resolve('迟到的结果') })
  assert.equal(await page.evaluate(() => window.editor.getText()), '用户后来输入')
  assert.equal(await page.evaluate(() => window.cancelled), true)
})

test('second click cancels; errors preserve text and expose a retryable warning', async () => {
  await page.locator('#miaobi-t3-enhance').click(); await page.locator('#miaobi-t3-enhance').click()
  assert.equal(await page.evaluate(() => window.cancelled), true)
  assert.equal(await page.evaluate(() => window.editor.getText()), '原始草稿')
  await page.locator('#miaobi-t3-enhance').click()
  await page.evaluate(() => window.requests[1].reject(new Error('测试失败')))
  await page.waitForFunction(() => document.querySelector('#miaobi-t3-enhance').title.includes('原文没动'))
  assert.equal(await page.evaluate(() => window.editor.getText()), '原始草稿')
})

test('thread navigation discards late results and repeated mounting creates one button', async () => {
  await page.locator('#miaobi-t3-enhance').click()
  await page.evaluate(() => { location.hash = '#different-thread'; window.requests[0].resolve('旧会话结果') })
  assert.equal(await page.evaluate(() => window.editor.getText()), '原始草稿')
  await page.evaluate(createT3InjectionSource({ base: 'http://127.0.0.1:18766', token: 'test' }))
  assert.equal(await page.locator('#miaobi-t3-enhance').count(), 1)
})

test('empty drafts disable the button and edits clear restore', async () => {
  await page.evaluate(() => window.replaceDraft(''))
  assert.equal(await page.locator('#miaobi-t3-enhance').isDisabled(), true)
  await page.evaluate(() => window.replaceDraft('草稿'))
  await page.locator('#miaobi-t3-enhance').click()
  await page.evaluate(() => window.requests[0].resolve('结果'))
  await page.waitForFunction(() => window.editor.getText() === '结果')
  await page.evaluate(() => window.replaceDraft('手动编辑'))
  assert.equal(await page.locator('#miaobi-t3-restore').isVisible(), false)
})

const glow = '[data-miaobi-glow]'
test('whole composer flows only during a real request, then fades after inserting the result', async () => {
  const surface = page.locator('[data-chat-composer-surface]')
  const before = await surface.boundingBox()
  assert.equal(await page.locator(glow).count(), 0)
  await page.locator('#miaobi-t3-enhance').click()
  assert.equal(await page.locator(`${glow}[data-miaobi-glow="active"]`).count(), 1)
  assert.equal(await page.locator(glow).evaluate(el => el.parentElement.hasAttribute('data-chat-composer-surface')), true)
  assert.deepEqual(await surface.boundingBox(), before)
  assert.equal(await page.locator(glow).evaluate(el => getComputedStyle(el).pointerEvents), 'none')
  assert.equal(await page.locator(glow).evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length), 2)
  assert.equal(await page.evaluate(() => window.editor.getText()), '原始草稿')
  const finishing = await page.evaluate(async () => {
    window.requests[0].resolve('优化完成')
    await new Promise(resolve => setTimeout(resolve, 0))
    const layer = document.querySelector('[data-miaobi-glow]')
    return { phase: layer.dataset.miaobiGlow, flowing: layer.getAnimations({ subtree: true }).some(a => a instanceof CSSAnimation && a.playState === 'running') }
  })
  assert.deepEqual(finishing, { phase: 'leaving', flowing: false })
  await page.waitForFunction(() => window.editor.getText() === '优化完成')
  await page.waitForFunction(() => !document.querySelector('[data-miaobi-glow]'))
  assert.equal(await surface.evaluate(el => el.style.position), '')
})

test('cancel, failure, editing, navigation and disposal remove all flow immediately', async () => {
  for (const action of ['cancel', 'error', 'edit', 'navigate', 'dispose']) {
    await page.locator('#miaobi-t3-enhance').click()
    assert.equal(await page.locator(glow).count(), 1, action)
    await page.evaluate(action => {
      if (action === 'cancel') document.querySelector('#miaobi-t3-enhance').click()
      if (action === 'error') window.requests.at(-1).reject(new Error('请求失败'))
      if (action === 'edit') window.replaceDraft('新输入')
      if (action === 'navigate') window.dispatchEvent(new HashChangeEvent('hashchange'))
      if (action === 'dispose') window.__miaobiT3.dispose()
    }, action)
    assert.equal(await page.locator(glow).count(), 0, action)
  }
  assert.equal(await page.locator('#miaobi-t3-glow-style').count(), 0)
})

test('a new request survives the previous success fade timer and reinjection cleans its layer', async () => {
  await page.locator('#miaobi-t3-enhance').click()
  await page.evaluate(() => window.requests[0].resolve('结果'))
  await page.waitForFunction(() => window.editor.getText() === '结果')
  // Trigger within the fade period rather than waiting for Playwright stability.
  await page.evaluate(() => document.querySelector('#miaobi-t3-enhance').click())
  await page.waitForTimeout(250)
  assert.equal(await page.locator(`${glow}[data-miaobi-glow="active"]`).count(), 1)
  await page.evaluate(createT3InjectionSource({ base: 'http://127.0.0.1:18766', token: 'test' }))
  assert.equal(await page.locator(glow).count(), 0)
  assert.equal(await page.locator('#miaobi-t3-glow-style').count(), 1)
  assert.equal(await page.locator('#miaobi-t3-enhance').count(), 1)
  await page.locator('#miaobi-t3-enhance').click()
  assert.equal(await page.locator(glow).count(), 1)
})

test('native main surface owns the layer without moving absolute attachment controls', async () => {
  await page.evaluate(() => {
    const surface = document.querySelector('[data-chat-composer-surface]')
    const main = document.createElement('div')
    main.setAttribute('data-chat-composer-main-surface', 'true')
    main.style.cssText = 'position:relative;border-radius:16px'
    surface.replaceWith(main); main.append(surface)
    const attachment = document.createElement('button')
    attachment.id = 'attachment-menu'
    attachment.style.cssText = 'position:absolute;right:0;top:0'
    surface.append(attachment)
  })
  const before = await page.locator('#attachment-menu').boundingBox()
  await page.locator('#miaobi-t3-enhance').click()
  assert.equal(await page.locator(glow).evaluate(el => el.parentElement.hasAttribute('data-chat-composer-main-surface')), true)
  assert.deepEqual(await page.locator('#attachment-menu').boundingBox(), before)
  await page.evaluate(() => { document.querySelector('[data-miaobi-glow]').remove() })
  await page.waitForFunction(() => document.querySelector('[data-miaobi-glow]'))
  await page.evaluate(() => window.__miaobiT3.dispose())
  assert.equal(await page.locator(glow).count(), 0)
})

test('both themes keep text and controls usable; reduced motion keeps a static indicator', async () => {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await page.locator('#miaobi-t3-enhance').click()
    const state = await page.locator(glow).evaluate(el => ({
      animations: el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
      hidden: el.getAttribute('aria-hidden'),
      editorCovered: !document.elementFromPoint(...(() => {
        const r = document.querySelector('[contenteditable]').getBoundingClientRect()
        return [r.x + 5, r.y + 5]
      })()).matches('[contenteditable]'),
    }))
    assert.deepEqual(state, { animations: 0, hidden: 'true', editorCovered: false })
    await page.locator('#miaobi-t3-enhance').click()
    assert.equal(await page.locator(glow).count(), 0)
  }
})
