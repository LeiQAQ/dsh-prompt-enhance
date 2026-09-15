/**
 * The composer seat: one button, three states, and the race handling that makes
 * "your text always wins" true.
 *
 * Component props are composed by the slot machinery, not by us: a strict
 * session slot receives the framework standard kit (`useInput`,
 * `inputActions`, `sessionId`, `t`) plus this registration's `inject` face —
 * here a single `startRewrite(line, signal)` bound to the session. That binding
 * is the only way out of the browser, and it rides `remote.commands.execute`,
 * the one front-end-reachable channel a third-party plugin can open.
 *
 * Two framework facts carry acceptance criteria for free, and are worth
 * naming because they are easy to lose in a refactor:
 *   - the slot is a strict session slot, and the shell remounts its entry per
 *     session id, so component state can never leak across a session switch
 *     (AC8) — no session map is needed on our side;
 *   - `useInput` is a selector over the live input store, so the button's
 *     disabled state and the post-flight CAS read the same source the textarea
 *     writes (AC2, AC5).
 *
 * @module dsh-prompt-enhance/client/component
 */

import { useEffect, useRef, useState } from 'react'
import { jsx } from 'react/jsx-runtime'
import {
  IconLoadingOutline16, IconRefreshOutline14, IconSparkle16, IconWarningOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ERROR_CODES } from '../shared/codes.js'
import { CLASS } from './styles.js'
import {
  PHASES, baselineMatches, canStart, initialState, oversizeFailure, reduce, viewModel,
} from '../core/rewrite-state.js'
import { buildLine, describeThrown, interpret } from './transport.js'

/** Stable selector: the live draft text. */
const selectDraft = state => state.draft

/** Stable selector: the monotonic draft revision, the CAS half that catches an edit which left the text identical. */
const selectRev = state => state.draftRev

/**
 * Glyph per state.
 *
 * `IconSparkle16` is the four-point sparkle — the same mark WorkBuddy puts on
 * its own enhance button, so the two composers read as one feature rather than
 * two lookalikes. Do NOT "clarify" this to `IconEnhanceOutline16`: despite the
 * name, that one is four stacked horizontal rules (a paragraph glyph), and
 * swapping it in makes the button look like a text-formatting control. The two
 * are the only sparkle/enhance candidates the primitives surface exports.
 */
const ICONS = Object.freeze({
  idle: IconSparkle16,
  busy: IconLoadingOutline16,
  failed: IconWarningOutline16,
})

/**
 * Render the enhance seat.
 * @param props - the composed slot props (see the module note).
 * @returns the seat element.
 */
export function PromptEnhanceSeat(props) {
  const { useInput, inputActions, t, startRewrite } = props
  const draft = useInput(selectDraft)
  const rev = useInput(selectRev)
  const [state, setState] = useState(initialState)

  /* One mutable cell for the values an async continuation needs: the live
   * draft/revision at settle time, and which controller owns the in-flight
   * run. Written during render, which is exactly the semantics wanted — the
   * continuation must see the last committed render, not a future one.
   *
   * The field is named `text`, not `draft`, because the cell has to be a valid
   * *candidate baseline*: `baselineMatches` compares the captured baseline
   * against this shape, and a mismatched key would silently make every rewrite
   * look stale. */
  const live = useRef(undefined)
  if (live.current === undefined) live.current = { text: draft, rev, controller: undefined }
  live.current.text = draft
  live.current.rev = rev

  useEffect(() => () => {
    /* The seat dies (session switch, plugin unload, hot reload) — take the
     * request with it rather than letting a rewrite land in a dead composer. */
    live.current.controller?.abort()
  }, [])

  /**
   * One run, from the captured baseline to a settled decision.
   *
   * Every exit is one of four outcomes, and they are exhaustive on purpose:
   * write the rewrite (the only path that touches the draft), show a failure,
   * stay silent, or drop the result because the composer moved on.
   *
   * @param baseline - the draft and revision captured at click time.
   * @param controller - the run's abort controller; also its identity token.
   */
  const run = (baseline, controller) => {
    void (async () => {
      let outcome
      try {
        outcome = interpret(await startRewrite(buildLine(baseline.text), controller.signal))
      } catch (error) {
        /* An aborted call rejects by contract; that is a cancel, not a fault. */
        outcome = controller.signal.aborted
          ? { kind: 'silent' }
          : { kind: 'failure', code: ERROR_CODES.TRANSPORT, detail: describeThrown(error) }
      }
      /* F8: a newer run owns the seat now — its result must not be overwritten
       * by this one, and this one must not report anything either. */
      if (live.current.controller !== controller) return
      live.current.controller = undefined
      if (controller.signal.aborted || outcome.kind === 'silent') {
        setState(current => reduce(current, { type: 'cancelled' }))
        return
      }
      if (outcome.kind === 'failure') {
        /* The chip is clipped and the banner says only whether the draft
         * survived, so DevTools gets the whole detail — plus, for a thrown
         * value, the stack the caller caught. This is the one place a failure
         * is still fully legible after the fact. */
        console.error('[prompt-enhance] enhancement failed:', outcome.code, outcome.detail)
        setState(current => reduce(current, { type: 'failed', code: outcome.code, detail: outcome.detail }))
        return
      }
      /* AC5: the composer is no longer holding what we sent, so the rewrite is
       * stale. Drop it silently — the user's edit outranks our result. */
      if (!baselineMatches(baseline, live.current)) {
        setState(current => reduce(current, { type: 'settled' }))
        return
      }
      inputActions.setDraft(outcome.text)
      setState(current => reduce(current, { type: 'succeeded', before: baseline.text, after: outcome.text }))
    })()
  }

  const onPrimary = () => {
    /* AC3: the same button cancels. A real abort, not a UI-only reset — the
     * signal reaches the provider request. */
    if (state.phase === PHASES.ENHANCING) {
      live.current.controller?.abort()
      return
    }
    /* The ceiling is enforced locally first: there is nothing a round trip
     * could add to "this draft is too long". */
    const oversize = oversizeFailure(draft)
    if (oversize !== undefined) {
      setState(current => reduce(current, { type: 'failed', code: oversize.code, detail: oversize.detail }))
      return
    }
    if (!canStart(state, draft)) return
    const baseline = { text: draft, rev }
    const controller = new AbortController()
    live.current.controller = controller
    setState(current => reduce(current, { type: 'start', baseline }))
    run(baseline, controller)
  }

  const view = viewModel(state, draft, t)
  const Icon = ICONS[view.icon]
  const revert = view.revertTarget

  return jsx('span', {
    className: CLASS.seat,
    'data-phase': state.phase,
    children: [
      jsx(Tooltip, {
        key: 'enhance',
        label: view.tooltip,
        children: jsx('button', {
          type: 'button',
          className: state.phase === PHASES.FAILED ? `${CLASS.button} ${CLASS.failed}` : CLASS.button,
          disabled: view.disabled,
          'aria-label': view.ariaLabel,
          'aria-busy': view.ariaBusy,
          onClick: onPrimary,
          children: jsx(Icon, { size: 16, className: view.busy ? CLASS.spinning : undefined }),
        }),
      }),
      revert === undefined ? null : jsx(Tooltip, {
        key: 'revert',
        label: t('enhance.revert'),
        children: jsx('button', {
          type: 'button',
          className: CLASS.button,
          'aria-label': t('enhance.revert.aria'),
          onClick: () => {
            inputActions.setDraft(revert)
            setState(current => reduce(current, { type: 'reverted' }))
          },
          children: jsx(IconRefreshOutline14, { size: 14 }),
        }),
      }),
      view.error === '' ? null : jsx('span', {
        key: 'error',
        className: CLASS.error,
        role: 'status',
        title: view.errorDetail === '' ? view.error : `${view.error} (${view.errorDetail})`,
        children: view.error,
      }),
      /* The cause, named. See `failureDiagnostic` for why this is visible copy
       * rather than another tooltip: a failure nobody can reproduce is only
       * debuggable if the machine fact survives a screenshot. */
      view.diagnostic === '' ? null : jsx('span', {
        key: 'diagnostic',
        className: CLASS.diagnostic,
        title: view.errorDetail,
        children: view.diagnostic,
      }),
    ],
  })
}
