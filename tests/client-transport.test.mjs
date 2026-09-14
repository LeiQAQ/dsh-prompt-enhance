/**
 * The browser half's seam onto the host, pinned layer by layer.
 *
 * `interpret` is the only place where three structurally different failures —
 * an RPC that never arrived, a command the host does not know, and a handler
 * that ran and refused — are told apart. Conflating any two of them produces a
 * user-visible lie ("retry in a moment" for a plugin that is not loaded), so
 * each layer gets its own case rather than being folded into the happy path.
 *
 * @module dsh-prompt-enhance/tests/client-transport
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildLine, describeThrown, interpret } from '../src/client/transport.js'
import { decodeDraft } from '../src/shared/codec.js'
import { formatErrorText, ERROR_CODES } from '../src/shared/codes.js'
import { TRANSPORT_PREFIX } from '../src/shared/protocol.js'

/** Wrap a handler result the way the RPC layer does. */
const envelope = result => ({ ok: true, value: { commandId: 'c-1', result } })

describe('buildLine', () => {
  it('produces a parseable slash command whose token round-trips the draft', () => {
    const line = buildLine('把这段改清楚点\n第二行')
    assert.match(line, /^\/enhance-prompt b64:[A-Za-z0-9_-]+$/u)
    const token = line.slice('/enhance-prompt b64:'.length)
    assert.equal(decodeDraft(token), '把这段改清楚点\n第二行')
  })

  it('keeps the line free of whitespace other than the one separator', () => {
    const line = buildLine('tab\there and  spaces')
    assert.equal(line.split(/\s/u).length, 2)
  })

  it('survives a draft that is itself a command line', () => {
    const line = buildLine('/compact --now')
    assert.equal(line.startsWith('/enhance-prompt b64:'), true)
    assert.equal(decodeDraft(line.slice('/enhance-prompt b64:'.length)), '/compact --now')
  })
})

describe('interpret — the envelope layers', () => {
  it('reads a success result as a rewrite', () => {
    assert.deepEqual(interpret(envelope({ kind: 'success', text: 'stronger' })), {
      kind: 'rewrite',
      text: 'stronger',
    })
  })

  it('treats a non-object resolution as a transport failure', () => {
    for (const value of [undefined, null, 'nope', 7]) {
      assert.equal(interpret(value).kind, 'failure')
      assert.equal(interpret(value).code, ERROR_CODES.TRANSPORT)
    }
  })

  it('reads an RPC failure as transport, keeping the code and message', () => {
    const outcome = interpret({ ok: false, error: { code: 'ENOENT', message: 'socket closed' } })
    assert.equal(outcome.kind, 'failure')
    assert.equal(outcome.code, ERROR_CODES.TRANSPORT)
    assert.equal(outcome.detail, 'ENOENT: socket closed')
  })

  it('falls back when the RPC error carries nothing usable', () => {
    const outcome = interpret({ ok: false })
    assert.equal(outcome.code, ERROR_CODES.TRANSPORT)
    assert.equal(outcome.detail, 'unknown')
  })

  it('reads an unresolved command as no_command, not as a transport fault', () => {
    const outcome = interpret({ ok: true, value: undefined })
    assert.equal(outcome.kind, 'failure')
    assert.equal(outcome.code, ERROR_CODES.NO_COMMAND)
  })

  it('reads a value without a result as internal', () => {
    const outcome = interpret({ ok: true, value: { commandId: 'c-1' } })
    assert.equal(outcome.kind, 'failure')
    assert.equal(outcome.code, ERROR_CODES.INTERNAL)
  })

  it('reads a success with empty text as output_empty', () => {
    assert.equal(interpret(envelope({ kind: 'success', text: '' })).code, ERROR_CODES.OUTPUT_EMPTY)
    assert.equal(interpret(envelope({ kind: 'success' })).code, ERROR_CODES.OUTPUT_EMPTY)
  })
})

describe('interpret — handler errors', () => {
  const tagged = (code, detail) => envelope({ kind: 'error', text: formatErrorText(code, detail) })

  it('stays silent on aborted', () => {
    assert.deepEqual(interpret(tagged(ERROR_CODES.ABORTED, 'the rewrite was cancelled')), { kind: 'silent' })
  })

  it('carries the machine code and the host sentence for every other tag', () => {
    for (const code of [
      ERROR_CODES.EMPTY_INPUT, ERROR_CODES.TOO_LONG, ERROR_CODES.BAD_ENCODING,
      ERROR_CODES.NO_MODEL, ERROR_CODES.LLM_ERROR, ERROR_CODES.TIMEOUT,
      ERROR_CODES.OUTPUT_EMPTY, ERROR_CODES.INTERNAL,
    ]) {
      const outcome = interpret(tagged(code, `sentence for ${code}`))
      assert.equal(outcome.kind, 'failure', code)
      assert.equal(outcome.code, code)
      assert.equal(outcome.detail, `sentence for ${code}`)
    }
  })

  it('reports an untagged error text verbatim as internal', () => {
    const outcome = interpret(envelope({ kind: 'error', text: 'TypeError: btoa is not a function' }))
    assert.equal(outcome.kind, 'failure')
    assert.equal(outcome.code, ERROR_CODES.INTERNAL)
    assert.equal(outcome.detail, 'TypeError: btoa is not a function')
  })

  it('keeps a tagged error with no sentence tagless-but-typed', () => {
    const outcome = interpret(tagged(ERROR_CODES.TIMEOUT, ''))
    assert.equal(outcome.code, ERROR_CODES.TIMEOUT)
    assert.equal(outcome.detail, '')
  })

  it('reads an empty error text as internal with an empty detail', () => {
    const outcome = interpret(envelope({ kind: 'error', text: '' }))
    assert.equal(outcome.code, ERROR_CODES.INTERNAL)
    assert.equal(outcome.detail, '')
  })
})

describe('describeThrown', () => {
  it('renders an Error as name: message', () => {
    assert.equal(describeThrown(new TypeError('bad')), 'TypeError: bad')
  })

  it('renders a message-less Error as its name alone', () => {
    assert.equal(describeThrown(new Error('')), 'Error')
  })

  it('passes a string through', () => {
    assert.equal(describeThrown('plain'), 'plain')
  })

  it('serialises anything else, and never throws on a cycle', () => {
    assert.equal(describeThrown({ a: 1 }), '{"a":1}')
    assert.equal(describeThrown(Object.create(null)), '{}')
    assert.equal(describeThrown(undefined), 'undefined')
    assert.equal(describeThrown(() => {}), '() => {}')
    const cyclic = {}
    cyclic.self = cyclic
    assert.equal(describeThrown(cyclic), '[object Object]')
  })
})

describe('the transport contract itself', () => {
  it('agrees with the host codec on the prefix the seat emits', () => {
    assert.equal(buildLine('x').startsWith(`/enhance-prompt ${TRANSPORT_PREFIX}`), true)
  })
})
