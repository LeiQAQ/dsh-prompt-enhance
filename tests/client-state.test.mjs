/**
 * The seat's decisions, without React or a network.
 *
 * Each case names the acceptance criterion it pins, because this file *is* the
 * offline half of the front-end acceptance suite: the component only wires
 * these functions to hooks, so a regression here is a regression in the product
 * contract, not in a rendering detail.
 *
 * @module dsh-prompt-enhance/tests/client-state
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  PHASES, baselineMatches, canStart, failureDiagnostic, failureKey, initialState, isBusy,
  oversizeFailure, reduce, revertTarget, viewModel,
} from '../src/core/rewrite-state.js'
import { en, zh } from '../src/client/locales.js'
import { ERROR_CODES, SILENT_CODES } from '../src/shared/codes.js'
import { MAX_DRAFT_LENGTH } from '../src/shared/protocol.js'

/** Codes that are never rendered: the silent ones never reach the banner. */
const RENDERED_CODES = Object.values(ERROR_CODES).filter(code => !SILENT_CODES.includes(code))

/** A translate function over the real zh dictionary, so the view model is asserted on shipped copy. */
function translator() {
  return (key, params) => {
    const found = zh[key]
    assert.notEqual(found, undefined, `missing dictionary key: ${key}`)
    return params === undefined
      ? found
      : Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), found)
  }
}

describe('the dictionaries', () => {
  it('ship the same key set in both locales', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  })

  it('key every code a failure banner can carry, in both locales', () => {
    for (const code of RENDERED_CODES) {
      assert.notEqual(zh[`enhance.error.${code}`], undefined, code)
      assert.notEqual(en[`enhance.error.${code}`], undefined, code)
    }
  })

  it('deliberately ship no sentence for the silent code: cancelling is not a failure', () => {
    for (const code of SILENT_CODES) {
      assert.equal(zh[`enhance.error.${code}`], undefined, code)
      assert.equal(en[`enhance.error.${code}`], undefined, code)
    }
  })

  it('tell the user, in the failure copy, that the draft survived', () => {
    /* The whole failure contract is "your text is untouched"; the model-caused
     * failures are the ones a user actually hits. */
    for (const code of [ERROR_CODES.LLM_ERROR, ERROR_CODES.TIMEOUT, ERROR_CODES.OUTPUT_EMPTY, ERROR_CODES.TRANSPORT]) {
      assert.equal(zh[`enhance.error.${code}`].includes('原文没动'), true, code)
      assert.equal(en[`enhance.error.${code}`].includes('untouched'), true, code)
    }
  })
})

describe('failureKey', () => {
  it('maps every renderable code to its own key', () => {
    for (const code of RENDERED_CODES) {
      assert.equal(failureKey(code), `enhance.error.${code}`)
    }
  })

  it('never routes a silent code to a sentence', () => {
    for (const code of SILENT_CODES) {
      assert.equal(failureKey(code), 'enhance.error.unknown', code)
    }
  })

  it('falls back to unknown for anything unrecognised', () => {
    for (const code of ['', 'weird', undefined, null, 42, {}]) {
      assert.equal(failureKey(code), 'enhance.error.unknown')
    }
  })
})

describe('failureDiagnostic — the cause the seat names out loud', () => {
  it('prefers the gateway\'s own code, which is the most specific fact a failure carries', () => {
    /* The 2026-09-14 shape verbatim: an RPC that failed host-side. Without
     * this the banner says "和后台通信失败" and the reason dies in a tooltip. */
    assert.equal(
      failureDiagnostic('gateway/lookup-not-found: no live agent for session-1'),
      'gateway/lookup-not-found',
    )
    assert.equal(failureDiagnostic('session/not-found: that session is gone'), 'session/not-found')
  })

  it('names a thrown value, so a defect is not reported as a transport problem', () => {
    assert.equal(failureDiagnostic("TypeError: Cannot read properties of undefined (reading 'aborted')"), 'TypeError')
    assert.equal(failureDiagnostic('Error: socket closed'), 'Error')
  })

  it('clips anything else, because half a sentence beats none', () => {
    const long = 'client api: remote/commands/execute expected 3 argument(s), got 4'
    const diagnostic = failureDiagnostic(long)
    assert.equal(diagnostic.length, 48)
    assert.equal(diagnostic.endsWith('…'), true)
    assert.equal(long.startsWith(diagnostic.slice(0, -1)), true)
  })

  it('keeps a short detail whole, and says nothing when there is nothing to say', () => {
    assert.equal(failureDiagnostic('  3 > 20000  '), '3 > 20000')
    for (const detail of ['', '   ', undefined, null, 42, {}]) {
      assert.equal(failureDiagnostic(detail), '')
    }
  })
})

describe('canStart — the empty-draft gate (AC2)', () => {
  it('refuses an empty, whitespace-only, or non-string draft', () => {
    const state = initialState()
    for (const draft of ['', '   ', '\n\t', undefined, null, 7]) {
      assert.equal(canStart(state, draft), false, JSON.stringify(draft))
    }
  })

  it('allows any draft with content', () => {
    assert.equal(canStart(initialState(), '  hi  '), true)
  })

  it('refuses while a run is in flight, so one seat never holds two runs', () => {
    const busy = reduce(initialState(), { type: 'start', baseline: { text: 'a', rev: 1 } })
    assert.equal(canStart(busy, 'a'), false)
  })
})

describe('reduce — the phase machine (F4)', () => {
  const start = state => reduce(state, { type: 'start', baseline: { text: 'a', rev: 1 } })

  it('starts from idle into enhancing, holding the baseline', () => {
    const state = start(initialState())
    assert.equal(state.phase, PHASES.ENHANCING)
    assert.deepEqual(state.baseline, { text: 'a', rev: 1 })
    assert.equal(isBusy(state), true)
  })

  it('ignores a second start rather than restarting the clock', () => {
    const once = start(initialState())
    assert.equal(reduce(once, { type: 'start', baseline: { text: 'b', rev: 2 } }), once)
  })

  it('records the revert pair on success and returns to idle', () => {
    const state = reduce(start(initialState()), { type: 'succeeded', before: 'a', after: 'A' })
    assert.equal(state.phase, PHASES.IDLE)
    assert.deepEqual(state.revert, { before: 'a', after: 'A' })
    assert.equal(state.baseline, undefined)
  })

  it('refuses a success that no longer owns the phase', () => {
    const idle = initialState()
    assert.equal(reduce(idle, { type: 'succeeded', before: 'a', after: 'A' }), idle)
    const cancelled = reduce(start(initialState()), { type: 'cancelled' })
    assert.equal(reduce(cancelled, { type: 'succeeded', before: 'a', after: 'A' }), cancelled)
  })

  it('lands on failed with the code and detail, and writes nothing', () => {
    const state = reduce(start(initialState()), { type: 'failed', code: ERROR_CODES.LLM_ERROR, detail: 'boom' })
    assert.equal(state.phase, PHASES.FAILED)
    assert.deepEqual(state.failure, { code: ERROR_CODES.LLM_ERROR, detail: 'boom' })
    assert.equal(state.revert, undefined)
  })

  it('keeps a previous revert pair across a failed retry (F7 survives a bad second run)', () => {
    const succeeded = reduce(start(initialState()), { type: 'succeeded', before: 'a', after: 'A' })
    const failed = reduce(reduce(succeeded, { type: 'start', baseline: { text: 'A', rev: 2 } }), {
      type: 'failed', code: ERROR_CODES.TIMEOUT, detail: 'slow',
    })
    assert.deepEqual(failed.revert, { before: 'a', after: 'A' })
  })

  it('clears a previous failure when a new run starts', () => {
    const failed = reduce(start(initialState()), { type: 'failed', code: ERROR_CODES.LLM_ERROR, detail: 'boom' })
    assert.equal(reduce(failed, { type: 'start', baseline: { text: 'a', rev: 1 } }).failure, undefined)
  })

  it('settles back to idle with no error, keeping the revert affordance', () => {
    for (const type of ['settled', 'cancelled']) {
      const before = reduce(start(initialState()), { type: 'succeeded', before: 'a', after: 'A' })
      const state = reduce(reduce(before, { type: 'start', baseline: { text: 'A', rev: 2 } }), { type })
      assert.equal(state.phase, PHASES.IDLE, type)
      assert.equal(state.failure, undefined, type)
      assert.deepEqual(state.revert, { before: 'a', after: 'A' }, type)
    }
  })

  it('ignores a settle that arrives when nothing is running', () => {
    const failed = reduce(start(initialState()), { type: 'failed', code: ERROR_CODES.LLM_ERROR, detail: 'boom' })
    assert.equal(reduce(failed, { type: 'settled' }), failed)
    assert.equal(reduce(failed, { type: 'cancelled' }), failed)
  })

  it('clears the revert pair when the user takes it', () => {
    const state = reduce(start(initialState()), { type: 'succeeded', before: 'a', after: 'A' })
    const reverted = reduce(state, { type: 'reverted' })
    assert.equal(reverted.revert, undefined)
    assert.equal(reverted.phase, PHASES.IDLE)
  })

  it('does not resurrect a phase when a revert lands mid-run', () => {
    const running = start(initialState())
    assert.equal(reduce(running, { type: 'reverted' }).phase, PHASES.ENHANCING)
  })

  it('resets to the exact initial state', () => {
    const state = reduce(start(initialState()), { type: 'failed', code: ERROR_CODES.INTERNAL, detail: 'x' })
    assert.deepEqual(reduce(state, { type: 'reset' }), initialState())
  })

  it('ignores an action it does not know', () => {
    const state = initialState()
    assert.equal(reduce(state, { type: 'no-such-action' }), state)
  })
})

describe('baselineMatches — the CAS that protects a user edit (AC5)', () => {
  it('matches only when both the text and the revision agree', () => {
    const baseline = { text: 'hello', rev: 4 }
    assert.equal(baselineMatches(baseline, { text: 'hello', rev: 4 }), true)
    assert.equal(baselineMatches(baseline, { text: 'hello!', rev: 4 }), false)
    /* An edit that leaves the text identical still advances the revision — the
     * conservative half, and the reason identity is a pair. */
    assert.equal(baselineMatches(baseline, { text: 'hello', rev: 5 }), false)
  })

  it('never matches a missing side', () => {
    assert.equal(baselineMatches(undefined, { text: 'a', rev: 1 }), false)
    assert.equal(baselineMatches({ text: 'a', rev: 1 }, undefined), false)
    assert.equal(baselineMatches(undefined, undefined), false)
  })
})

describe('revertTarget — restore original (F7, AC6)', () => {
  const succeeded = () => reduce(
    reduce(initialState(), { type: 'start', baseline: { text: 'before', rev: 1 } }),
    { type: 'succeeded', before: 'before', after: 'after' },
  )

  it('offers the original while the composer still holds the rewrite', () => {
    assert.equal(revertTarget(succeeded(), 'after'), 'before')
  })

  it('disappears the moment the user edits, so it can never overwrite new typing', () => {
    assert.equal(revertTarget(succeeded(), 'after and more'), undefined)
    assert.equal(revertTarget(succeeded(), ''), undefined)
  })

  it('is absent with no pair, and empty strings are a legitimate pair', () => {
    assert.equal(revertTarget(initialState(), ''), undefined)
    const emptied = reduce(
      reduce(initialState(), { type: 'start', baseline: { text: 'text', rev: 1 } }),
      { type: 'succeeded', before: 'text', after: '' },
    )
    assert.equal(revertTarget(emptied, ''), 'text')
  })
})

describe('oversizeFailure — the local ceiling', () => {
  it('passes a draft at exactly the limit', () => {
    assert.equal(oversizeFailure('a'.repeat(MAX_DRAFT_LENGTH)), undefined)
  })

  it('refuses one character over, naming both numbers', () => {
    const failure = oversizeFailure(`${'a'.repeat(MAX_DRAFT_LENGTH)}b`)
    assert.equal(failure.code, ERROR_CODES.TOO_LONG)
    assert.equal(failure.detail, `${MAX_DRAFT_LENGTH + 1} > ${MAX_DRAFT_LENGTH}`)
  })

  it('passes a non-string through to the emptiness gate instead', () => {
    assert.equal(oversizeFailure(undefined), undefined)
    assert.equal(oversizeFailure(null), undefined)
  })
})

describe('viewModel — what the seat shows', () => {
  const t = translator()

  it('idle with a usable draft: enabled, idle glyph, the action tooltip', () => {
    const view = viewModel(initialState(), 'write me', t)
    assert.equal(view.busy, false)
    assert.equal(view.failed, false)
    assert.equal(view.disabled, false)
    assert.equal(view.icon, 'idle')
    assert.equal(view.tooltip, zh['enhance.tooltip'])
    assert.equal(view.ariaLabel, zh['enhance.aria'])
    assert.equal(view.ariaBusy, undefined)
    assert.equal(view.error, '')
  })

  it('idle with nothing to send: disabled, with the reason in the tooltip', () => {
    for (const draft of ['', '   ']) {
      const view = viewModel(initialState(), draft, t)
      assert.equal(view.disabled, true, JSON.stringify(draft))
      assert.equal(view.tooltip, zh['enhance.tooltip.disabled'])
    }
  })

  it('enhancing: busy, not disabled (the same button must be able to cancel), spinner, aria-busy', () => {
    const view = viewModel(reduce(initialState(), { type: 'start', baseline: { text: 'x', rev: 1 } }), 'x', t)
    assert.equal(view.busy, true)
    assert.equal(view.disabled, false)
    assert.equal(view.icon, 'busy')
    assert.equal(view.ariaBusy, 'true')
    assert.equal(view.ariaLabel, zh['enhance.aria.busy'])
    assert.equal(view.tooltip, zh['enhance.tooltip.busy'])
  })

  it('failed: warning glyph, retry tooltip, and the localised sentence with the limit interpolated', () => {
    const state = reduce(initialState(), { type: 'failed', code: ERROR_CODES.TOO_LONG, detail: 'x' })
    const view = viewModel(state, 'x', t)
    assert.equal(view.failed, true)
    assert.equal(view.icon, 'failed')
    assert.equal(view.tooltip, zh['enhance.tooltip.failed'])
    assert.equal(view.ariaLabel, zh['enhance.aria.failed'])
    assert.equal(view.error, `草稿太长了，上限 ${MAX_DRAFT_LENGTH} 个字符`)
    assert.equal(view.error.includes('{limit}'), false)
  })

  it('failed on an unknown code still says something, and still shows the detail', () => {
    const state = reduce(initialState(), { type: 'failed', code: 'mystery', detail: 'raw detail' })
    const view = viewModel(state, 'x', t)
    assert.equal(view.error, zh['enhance.error.unknown'])
    assert.equal(view.errorDetail, 'raw detail')
    assert.equal(view.diagnostic, 'raw detail')
  })

  it('shows no diagnostic chip unless a run failed', () => {
    for (const state of [initialState(), reduce(initialState(), { type: 'start', baseline: { text: 'x', rev: 1 } })]) {
      const view = viewModel(state, 'x', t)
      assert.equal(view.errorDetail, '')
      assert.equal(view.diagnostic, '')
    }
  })

  it('exposes the revert target only through the pair (single source with the button)', () => {
    const state = reduce(
      reduce(initialState(), { type: 'start', baseline: { text: 'a', rev: 1 } }),
      { type: 'succeeded', before: 'a', after: 'A' },
    )
    assert.equal(viewModel(state, 'A', t).revertTarget, 'a')
    assert.equal(viewModel(state, 'A!', t).revertTarget, undefined)
  })
})
