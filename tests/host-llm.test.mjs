/**
 * The model-call seam: aggregation, terminal classification, and the one
 * post-processing step (PRD §6.3, §5.1 steps [6]–[7]).
 *
 * The classification is the part that silently rots: dsh reports a model
 * failure as a *value* (`finish.kind`), not as a throw, and both in-box
 * auxiliary callers discard partial text on failure. Getting that wrong would
 * hand the user half a rewrite as if it were finished.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildUserMessage, createChunkCollector, finishFailure, stripWrappingQuotes,
} from '../dist/host/llm.js'

/** The verbatim original implementation, restated so a divergence is a failure. */
function referenceStripWrappingQuotes(text) {
  return text.trim().replace(/^["'"“”‘’]|["'"“”‘']$/g, '')
}

describe('chunk aggregation', () => {
  it('concatenates text deltas in arrival order and ignores non-text chunks', () => {
    const collector = createChunkCollector()
    collector.push({ type: 'text-delta', text: '你' })
    collector.push({ type: 'reasoning-delta', text: 'thinking…' })
    collector.push({ type: 'text-delta', text: '好' })
    collector.push({ type: 'finish', kind: 'stop' })
    assert.equal(collector.text, '你好')
    assert.equal(collector.finish.kind, 'stop')
  })

  it('survives junk chunks without corrupting the text', () => {
    const collector = createChunkCollector()
    collector.push(null)
    collector.push(undefined)
    collector.push('a string')
    collector.push({ type: 'text-delta' })
    collector.push({ type: 'finish', kind: 'stop' })
    assert.equal(collector.text, '')
  })

  it('reports how many text blocks arrived', () => {
    const collector = createChunkCollector()
    collector.push({ type: 'text-delta', text: 'a' })
    collector.push({ type: 'text-delta', text: 'b' })
    assert.equal(collector.deltas, 2)
  })

  it('keeps the last finish chunk', () => {
    const collector = createChunkCollector()
    collector.push({ type: 'finish', kind: 'stop' })
    collector.push({ type: 'finish', kind: 'error', failure: { code: 'x', message: 'y' } })
    assert.equal(collector.finish.kind, 'error')
  })
})

describe('terminal classification', () => {
  it('treats a clean stop as success', () => {
    assert.equal(finishFailure({ type: 'finish', kind: 'stop' }), undefined)
  })

  it('unwraps the shipped dsh-llm envelope `{ type, reason: { kind } }`', () => {
    /* The shape actually emitted by `dsh-llm`'s `adapterFailureChunk` and the
     * deepseek adapter; the flat form below is the documented fallback. */
    assert.equal(finishFailure({ type: 'finish', reason: { kind: 'stop' } }), undefined)
    assert.deepEqual(
      finishFailure({ type: 'finish', reason: { kind: 'error', failure: { code: 'rate_limit', message: 'slow down' } } }),
      { code: 'rate_limit', message: 'slow down' },
    )
    assert.equal(finishFailure({ type: 'finish', reason: { kind: 'max-tokens' } }).code, 'max-tokens')
    assert.deepEqual(
      finishFailure({ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled' } } }),
      { code: 'ABORTED', message: 'cancelled' },
    )
  })

  it('treats a missing terminal chunk as a failure, not as success', () => {
    const failure = finishFailure(undefined)
    assert.equal(failure.code, 'llm_error')
    assert.match(failure.message, /without a terminal finish/u)
  })

  it('surfaces the provider failure code and message', () => {
    const failure = finishFailure({ type: 'finish', kind: 'error', failure: { code: 'rate_limit', message: 'slow down' } })
    assert.deepEqual(failure, { code: 'rate_limit', message: 'slow down' })
  })

  it('falls back to the finish kind when the failure payload is absent', () => {
    assert.deepEqual(finishFailure({ kind: 'aborted' }), { code: 'aborted', message: 'the model call finished with kind "aborted"' })
    assert.deepEqual(finishFailure({ kind: 'error' }), { code: 'error', message: 'the model call finished with kind "error"' })
  })

  it('classifies truncation and tool-calls as failures rather than as text', () => {
    assert.equal(finishFailure({ kind: 'max-tokens' }).code, 'max-tokens')
    assert.equal(finishFailure({ kind: 'tool-calls' }).code, 'tool-calls')
  })

  it('classifies an unknown kind as a failure (forward compatibility)', () => {
    const failure = finishFailure({ kind: 'something-new' })
    assert.equal(failure.code, 'llm_error')
    assert.match(failure.message, /something-new/u)
  })
})

describe('stripWrappingQuotes', () => {
  const samples = [
    'plain',
    '  padded  ',
    '"quoted"',
    "'single quoted'",
    '“curly double”',
    '‘curly single’',
    '"only opening',
    'only closing"',
    '',
    '   ',
    '"  spaced inside quotes  "',
    '「bracket quotes are not stripped」',
    '""',
    '“”',
    'a"b',
    '多行\n"含引号"\n结束',
    '"-“mixed”-"',
  ]

  for (const sample of samples) {
    it(`matches the original implementation for ${JSON.stringify(sample)}`, () => {
      assert.equal(stripWrappingQuotes(sample), referenceStripWrappingQuotes(sample))
    })
  }

  it('trims but does not re-trim after quote removal (original quirk preserved)', () => {
    assert.equal(stripWrappingQuotes('"  x  "'), '  x  ')
  })

  it('strips at most one quote character from each end', () => {
    assert.equal(stripWrappingQuotes('""x""'), '"x"')
  })
})

describe('buildUserMessage', () => {
  it('builds a frozen user message in the shape the loop dispatches', () => {
    const message = buildUserMessage('hello', 'dsh-prompt-enhance')
    assert.equal(message.role, 'user')
    assert.deepEqual(message.content, [{ type: 'text', text: 'hello' }])
    assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-prompt-enhance' })
    assert.equal(Object.isFrozen(message), true)
    assert.equal(Object.isFrozen(message.content), true)
    assert.equal(Object.isFrozen(message.content[0]), true)
    assert.equal(typeof message.id, 'string')
    assert.ok(message.id.length > 0)
  })

  it('mints a distinct id per message', () => {
    const ids = new Set(Array.from({ length: 50 }, () => buildUserMessage('x', 'p').id))
    assert.equal(ids.size, 50)
  })
})
