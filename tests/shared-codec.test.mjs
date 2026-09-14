/**
 * Transport codec: the one hard technical risk in the design (PRD §6.2, U2).
 *
 * What must hold: the encoded form is always parseable as a command argument,
 * it round-trips exactly, and a malformed token fails as a typed error rather
 * than as a platform primitive's exception.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DraftCodecError, buildCommandLine, decodeBase64Url, decodeDraft, encodeBase64Url, encodeDraft,
  parseDraftArgument,
} from '../dist/shared/codec.js'
import { COMMAND_NAME, MAX_DRAFT_LENGTH } from '../dist/shared/protocol.js'

/** The argument grammar dsh's own parser applies, restated so a change is a test failure. */
const COMMAND_NAME_PATTERN = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u

/** Every sample the PRD asks for, plus the classes that historically break naive encodings. */
const SAMPLES = {
  'empty string': '',
  'single ascii character': 'a',
  'a normal chinese draft': '帮我写个文案，突出这个产品的续航能力',
  'an english draft': 'write me a launch tweet for the new keyboard',
  'a full-width punctuation draft': '写一段介绍，要点：①快 ②省电 ③便宜。谢谢！',
  'a multiline draft': '第一行\n第二行\r\n第三行',
  'an emoji draft': '帮我把这段改成标题 🎉🚀 带点情绪',
  'a surrogate-pair draft': '𝕏 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 🧑‍🚀 家庭 emoji 👨‍👩‍👧‍👦',
  'a draft that starts with a slash': '/help 这段其实是想问问题',
  'a draft that looks like our own command line': '/enhance-prompt b64:AAAA',
  'a draft with tab and form feed': 'a\tb\fc',
  'a draft of only whitespace': '   \n\t ',
}

describe('encode/decode round trip', () => {
  for (const [label, sample] of Object.entries(SAMPLES)) {
    it(`round-trips exactly: ${label}`, () => {
      const token = encodeDraft(sample)
      assert.equal(decodeDraft(token), sample)
      assert.equal(parseDraftArgument(` b64:${token}`).text, sample)
    })
  }

  it('produces only base64url characters', () => {
    for (const sample of Object.values(SAMPLES)) {
      assert.match(encodeDraft(sample), /^[A-Za-z0-9_-]*$/u)
    }
  })

  it('never emits padding', () => {
    for (let length = 0; length < 24; length += 1) {
      assert.doesNotMatch(encodeBase64Url('x'.repeat(length)), /=/u)
    }
  })

  it('differs from plain base64 where it must (so the alphabet really is urlsafe)', () => {
    /* A byte sequence that yields both `+` and `/` in standard base64. */
    const probe = '\u00ff\u00ef\u00be\u00ff'
    assert.match(Buffer.from(probe, 'utf8').toString('base64'), /[+/]/u)
    assert.doesNotMatch(encodeBase64Url(probe), /[+/]/u)
    assert.equal(decodeBase64Url(encodeBase64Url(probe)), probe)
  })
})

describe('command line', () => {
  it('is parseable by the command grammar and yields the encoded argument back', () => {
    const draft = '帮我写个文案\n第二行 /slash 🎉'
    const line = buildCommandLine(COMMAND_NAME, draft)
    const match = COMMAND_NAME_PATTERN.exec(line)
    assert.notEqual(match, null)
    assert.equal(match[1], COMMAND_NAME)
    const rawInput = line.slice(match[0].length)
    assert.deepEqual(parseDraftArgument(rawInput), { text: draft, transport: 'b64' })
  })

  it('carries no plaintext of the draft (AC10)', () => {
    const draft = 'SECRET-DRAFT-MARKER 帮我改写'
    const line = buildCommandLine(COMMAND_NAME, draft)
    assert.equal(line.includes('SECRET-DRAFT-MARKER'), false)
    assert.equal(line.includes('帮我改写'), false)
  })

  it('stays a single line even for a multiline draft', () => {
    const line = buildCommandLine(COMMAND_NAME, 'a\nb\nc')
    assert.equal(line.split('\n').length, 1)
  })
})

describe('literal fallback (the hand-typed entry point)', () => {
  it('accepts plain text after the command name', () => {
    assert.deepEqual(parseDraftArgument(' 把这段话说清楚点 '), { text: '把这段话说清楚点', transport: 'literal' })
  })

  it('treats a missing argument as an empty draft rather than an error', () => {
    assert.deepEqual(parseDraftArgument(''), { text: '', transport: 'literal' })
    assert.deepEqual(parseDraftArgument('   '), { text: '', transport: 'literal' })
    assert.deepEqual(parseDraftArgument(undefined), { text: '', transport: 'literal' })
  })

  it('keeps a leading-slash literal as text', () => {
    assert.deepEqual(parseDraftArgument(' /plan this is not a command'), { text: '/plan this is not a command', transport: 'literal' })
  })
})

describe('malformed input', () => {
  const rejected = {
    'non-alphabet character': 'AAAA!BBB',
    'padding': 'AAAA=',
    'standard-base64 plus': 'AA+A',
    'impossible length (length % 4 === 1)': 'AAAAA',
    'high-bit character': 'AAAA\u4e2d',
    'truncated two-byte sequence': 'ww',
  }

  for (const [label, token] of Object.entries(rejected)) {
    it(`rejects with a typed error: ${label}`, () => {
      assert.throws(() => decodeDraft(token), DraftCodecError)
    })
  }

  it('rejects a base64 payload that is not valid UTF-8 as a typed error', () => {
    /* 0xFF 0xFE is not a UTF-8 sequence. */
    assert.throws(() => decodeBase64Url('__4'), DraftCodecError)
  })

  it('accepts a payload that decodes to U+FFFD, because that is valid UTF-8', () => {
    /* `77-9` is the replacement character's own encoding — a payload that
     * merely *looks* like corruption is not corruption. Worth pinning: it is
     * the difference between validating UTF-8 and guessing at intent. */
    assert.equal(decodeBase64Url('77-9'), '\uFFFD')
  })

  it('rejects a non-string token', () => {
    assert.throws(() => decodeBase64Url(42), DraftCodecError)
    assert.throws(() => encodeDraft(42), DraftCodecError)
  })

  it('propagates as a typed error through the argument parser', () => {
    assert.throws(() => parseDraftArgument('b64:AAAA!'), DraftCodecError)
  })
})

describe('size ceiling', () => {
  it('accepts exactly the ceiling and rejects one character more', () => {
    const atLimit = 'x'.repeat(MAX_DRAFT_LENGTH)
    assert.equal(decodeDraft(encodeDraft(atLimit)).length, MAX_DRAFT_LENGTH)
    assert.throws(() => encodeDraft(`${atLimit}x`), DraftCodecError)
  })

  it('applies the ceiling to the decoded draft, not the token', () => {
    const oversizeToken = encodeBase64Url('中'.repeat(MAX_DRAFT_LENGTH + 1))
    assert.throws(() => decodeDraft(oversizeToken), DraftCodecError)
  })

  it('keeps the transport expansion within the documented 33% for a real draft', () => {
    const draft = '这是一段中文草稿，'.repeat(120)
    const ratio = encodeDraft(draft).length / Buffer.byteLength(draft, 'utf8')
    assert.ok(ratio > 1.33 && ratio < 1.34, `unexpected expansion ratio ${ratio}`)
  })
})

describe('chunked binary folding', () => {
  it('survives a draft whose UTF-8 bytes exceed one folding chunk', () => {
    /* The encoder folds bytes into String.fromCharCode in fixed-size chunks to
     * stay under the engine's argument ceiling; 20 000 CJK characters is
     * ~60 000 bytes, i.e. eight chunks. */
    const big = '这是一个很长的中文草稿，用来测试分块编码'.repeat(500)
    assert.ok(Buffer.byteLength(big, 'utf8') > 8192 * 2)
    assert.equal(decodeDraft(encodeDraft(big)), big)
  })
})
