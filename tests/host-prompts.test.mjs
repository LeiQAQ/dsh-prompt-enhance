/**
 * The prompt assets are the whole reason the port can claim behavioural
 * equivalence (PRD G1): same system prompt, same user template, same single
 * substitution. They are copied, not authored, so the tests here are about
 * *fidelity*, not taste — and they run against the built copy as well, so a
 * stale `dist/` cannot ship a different prompt than the ones verified.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { PROMPT_DIGESTS, SYSTEM_PROMPT, USER_TEMPLATE, USER_TEMPLATE_PLACEHOLDER, renderUserPrompt } from '../dist/host/prompts.js'
import { MAX_DRAFT_LENGTH } from '../dist/shared/protocol.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** PRD §6.5 anchors: 46 lines / 2986 chars, 42 lines / 2425 chars. */
const EXPECTED = Object.freeze({
  system: { digest: '14227948d6914a07', lines: 46, chars: 2986 },
  user: { digest: 'ceb5a2e042ad9bb5', lines: 42, chars: 2425 },
})

/** sha256 of one asset, first 16 lowercase hex characters. */
function digest(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').slice(0, 16)
}

describe('prompt asset fidelity', () => {
  for (const [name, expected, text] of [['system', EXPECTED.system, SYSTEM_PROMPT], ['user', EXPECTED.user, USER_TEMPLATE]]) {
    it(`${name}: digest, line count and character count match the source asset`, () => {
      assert.equal(digest(text), expected.digest, `${name} digest drifted`)
      assert.equal(text.split('\n').length, expected.lines, `${name} line count drifted`)
      assert.equal(text.length, expected.chars, `${name} character count drifted`)
      assert.equal(PROMPT_DIGESTS[name === 'system' ? 'system' : 'user'], expected.digest)
    })

    it(`${name}: is LF-normalised and free of carriage returns`, () => {
      assert.equal(/\r/u.test(text), false)
    })
  }

  it('the user template carries the placeholder exactly once', () => {
    const count = USER_TEMPLATE.split(USER_TEMPLATE_PLACEHOLDER).length - 1
    assert.equal(count, 1)
  })

  it('the built copy is byte-identical to the verified source copy', async () => {
    for (const name of ['prompts.js', 'llm.js', 'index.js']) {
      const source = await readFile(resolve(ROOT, 'src/host', name), 'utf8')
      const built = await readFile(resolve(ROOT, 'dist/host', name === 'index.js' ? '../index.js' : name), 'utf8')
      /* The entry is rewritten for the dist layout; the other modules are copied. */
      if (name === 'index.js') {
        assert.equal(built.includes("./host/deadline.js"), true, 'dist entry did not get its specifiers rewritten')
        continue
      }
      assert.equal(built, source, `dist/host/${name} is stale — run scripts/build.mjs`)
    }
  })
})

describe('renderUserPrompt', () => {
  it('substitutes the draft and leaves nothing of the placeholder behind', () => {
    const rendered = renderUserPrompt('帮我写个文案')
    assert.equal(rendered.includes(USER_TEMPLATE_PLACEHOLDER), false)
    assert.equal(rendered.includes('帮我写个文案'), true)
    assert.equal(rendered.length, USER_TEMPLATE.length - USER_TEMPLATE_PLACEHOLDER.length + '帮我写个文案'.length)
  })

  it('substitutes literally, so `$` sequences in the draft survive', () => {
    /* The original called `USER_TEMPLATE.replace('{input}', input)`, and a
     * string replacement expands `$&`, `$'`, `` $` `` and `$1` — a draft
     * containing any of those silently pulled fragments of the template into
     * the prompt. The template and its digest are unchanged; only the
     * substitution is a literal join now. */
    const draft = 'keep $& and $1 and $\' literally'
    const rendered = renderUserPrompt(draft)
    assert.equal(rendered.includes(draft), true)
    assert.equal(rendered.length, USER_TEMPLATE.length - USER_TEMPLATE_PLACEHOLDER.length + draft.length)
  })

  it('handles every draft character the transport accepts', () => {
    const draft = '第一行\n第二行 🎉 {input} 已经出现过一次占位符'
    const rendered = renderUserPrompt(draft)
    assert.equal(rendered.includes(draft), true)
  })

  it('accepts a draft at the size ceiling without truncation', () => {
    const draft = 'x'.repeat(MAX_DRAFT_LENGTH)
    const rendered = renderUserPrompt(draft)
    assert.equal(rendered.includes(draft), true)
  })
})
