import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mountT3Composer } from '../adapters/t3/composer.mjs'

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
  await page.setContent('<form><div><div data-testid="composer-editor" contenteditable="true"></div></div><div style="display:flex"><button>添加文件</button><button aria-haspopup="menu">6.1 Sol</button><button>发送</button></div></form>')
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
  })
  await page.evaluate(`(${mountT3Composer.toString()})({base:'http://127.0.0.1:18766',token:'test',fetchImpl:window.fetchRewrite})`)
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
  await page.evaluate(`(${mountT3Composer.toString()})({base:'http://127.0.0.1:18766',token:'test',fetchImpl:window.fetchRewrite})`)
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
