/**
 * The composer seat's state machine, as pure functions.
 *
 * Nothing here touches React, the DOM, or the network, so every acceptance
 * scenario that is really a *decision* — disable-on-empty, discard-on-edit,
 * silent-cancel, restore-original, session isolation — is testable offline.
 * The component is then a thin adapter: hooks in, actions out.
 *
 * The two behaviours that matter and are easy to get wrong:
 *
 *   1. **Failure never writes.** No transition out of a failed run carries
 *      text; the only transition that writes to the composer is `succeeded`,
 *      and the component applies it only after the CAS in
 *      {@link baselineMatches} passes.
 *   2. **A stale result is indistinguishable from a cancel.** A superseded run
 *      and a cancelled one both end in `idle` with no error, because in both
 *      cases the user's text is the one that must win.
 *
 * @module dsh-prompt-enhance/core/rewrite-state
 */

import { ERROR_CODES } from '../shared/codes.js'
import { MAX_DRAFT_LENGTH } from '../shared/protocol.js'

/** Character ceiling of the diagnostic chip, ellipsis included. */
const DIAGNOSTIC_CEILING = 48

/** The button's three states (PRD F4). */
export const PHASES = Object.freeze({
  /** Reachable, nothing in flight. */
  IDLE: 'idle',
  /** A run is in flight; the button cancels. */
  ENHANCING: 'enhancing',
  /** The last run failed; the copy explains why and the draft is untouched. */
  FAILED: 'failed',
})

/**
 * One captured baseline: the draft and its revision when a run started.
 * @typedef {{ text: string, rev: number }} Baseline
 */

/**
 * One failure worth telling the user about.
 * @typedef {{ code: string, detail: string }} Failure
 */

/**
 * The last successful rewrite, kept as one pair so `revert` can restore exactly
 * what the user had (PRD §8: never cache more than the current pair).
 * @typedef {{ before: string, after: string }} RevertPair
 */

/**
 * Build the initial state.
 * @returns a fresh idle state.
 */
export function initialState() {
  return Object.freeze({
    phase: PHASES.IDLE,
    baseline: undefined,
    failure: undefined,
    revert: undefined,
  })
}

/**
 * Apply one transition. Total: an action that does not apply to the current
 * phase returns the state unchanged, so a late arrival can never invent a
 * phase the user did not cause.
 * @param state - current state.
 * @param action - the transition to apply.
 * @returns the next state (the same reference when nothing changes).
 */
export function reduce(state, action) {
  switch (action.type) {
    case 'start': {
      if (state.phase === PHASES.ENHANCING) return state
      return Object.freeze({
        /* A new run clears the previous failure but keeps the previous revert
         * pair: a run that is cancelled or fails must not cost the user their
         * still-valid "restore original" affordance. */
        phase: PHASES.ENHANCING,
        baseline: action.baseline,
        failure: undefined,
        revert: state.revert,
      })
    }
    case 'succeeded': {
      /* Only a run that is still the current one may write, and only while it
       * is the running one: a superseded or cancelled run can no longer hold
       * the phase it started in. */
      if (state.phase !== PHASES.ENHANCING) return state
      return Object.freeze({
        phase: PHASES.IDLE,
        baseline: undefined,
        failure: undefined,
        revert: Object.freeze({ before: action.before, after: action.after }),
      })
    }
    case 'failed': {
      return Object.freeze({
        phase: PHASES.FAILED,
        baseline: undefined,
        failure: Object.freeze({ code: action.code, detail: action.detail }),
        revert: state.revert,
      })
    }
    /* Cancelled, superseded, and "the user edited mid-flight" all land here:
     * back to idle, no error, draft untouched. */
    case 'settled':
    case 'cancelled': {
      if (state.phase !== PHASES.ENHANCING) return state
      return Object.freeze({
        phase: PHASES.IDLE,
        baseline: undefined,
        failure: undefined,
        revert: state.revert,
      })
    }
    case 'reverted': {
      return Object.freeze({
        phase: state.phase === PHASES.ENHANCING ? PHASES.ENHANCING : PHASES.IDLE,
        baseline: state.baseline,
        failure: undefined,
        revert: undefined,
      })
    }
    case 'reset': {
      return initialState()
    }
    default: {
      return state
    }
  }
}

/**
 * Whether a run is in flight.
 * @param state - current state.
 * @returns true while enhancing.
 */
export function isBusy(state) {
  return state.phase === PHASES.ENHANCING
}

/**
 * The empty-draft gate (PRD F2, AC2).
 * @param state - current state.
 * @param draft - the live draft.
 * @returns true when a run may start.
 */
export function canStart(state, draft) {
  if (isBusy(state)) return false
  return typeof draft === 'string' && draft.trim().length > 0
}

/**
 * The CAS that protects the user's edits (PRD §5.2, AC5/F8).
 *
 * Identity of "the draft I sent" is the pair (text, revision) rather than the
 * text alone: an edit that leaves the text identical still advances `draftRev`,
 * and a program write from a superseded run advances it too. Requiring both to
 * match is the conservative reading of dsh's input machine contract, and it is
 * the reading that can never clobber a user edit.
 *
 * @param baseline - the captured baseline.
 * @param current - the live draft and revision.
 * @returns true when the composer still holds exactly what was sent.
 */
export function baselineMatches(baseline, current) {
  if (baseline === undefined || current === undefined) return false
  return current.rev === baseline.rev && current.text === baseline.text
}

/**
 * The draft `revert` would restore (PRD F7, AC6).
 *
 * Guarded by equality with the rewrite that produced it, so the affordance
 * disappears the moment the user edits — a revert can never overwrite text the
 * user typed after the enhancement.
 *
 * @param state - current state.
 * @param draft - the live draft.
 * @returns the text to restore, or `undefined` when revert does not apply.
 */
export function revertTarget(state, draft) {
  const pair = state.revert
  if (pair === undefined) return undefined
  return pair.after === draft ? pair.before : undefined
}

/**
 * The oversize verdict, decided before anything is sent.
 *
 * The host enforces the same ceiling (it is the same constant), but a draft
 * that cannot be transported should fail instantly and locally rather than
 * spend a round trip to be told so.
 *
 * @param draft - the live draft.
 * @returns the failure to show, or `undefined` when the draft is sendable.
 */
export function oversizeFailure(draft) {
  if (typeof draft !== 'string' || draft.length <= MAX_DRAFT_LENGTH) return undefined
  return Object.freeze({
    code: ERROR_CODES.TOO_LONG,
    detail: `${draft.length} > ${MAX_DRAFT_LENGTH}`,
  })
}

/**
 * Map a machine code to its dictionary key.
 * @param code - an error code from either half.
 * @returns a key present in both dictionaries.
 */
export function failureKey(code) {
  switch (code) {
    case ERROR_CODES.EMPTY_INPUT:
    case ERROR_CODES.TOO_LONG:
    case ERROR_CODES.BAD_ENCODING:
    case ERROR_CODES.NO_MODEL:
    case ERROR_CODES.LLM_ERROR:
    case ERROR_CODES.TIMEOUT:
    case ERROR_CODES.OUTPUT_EMPTY:
    case ERROR_CODES.TRANSPORT:
    case ERROR_CODES.NO_COMMAND:
    case ERROR_CODES.INTERNAL:
      return `enhance.error.${code}`
    default:
      return 'enhance.error.unknown'
  }
}

/**
 * The one-line machine diagnosis shown beside a failure sentence.
 *
 * The visible sentence answers "was my draft touched?" and deliberately says
 * nothing about *why* — the reason is a machine fact, not something a user can
 * act on. That is the right split for the user and the wrong one for whoever has
 * to explain a failure they cannot reproduce: a `transport` failure arrives
 * carrying the gateway's own words (`gateway/lookup-not-found: …`) or a thrown
 * `TypeError`, and that string used to live only in the banner's `title` —
 * legible by hovering, invisible in a screenshot and absent from a bug report.
 *
 * So the seat shows a *short* form next to the sentence while the untouched
 * detail stays in the tooltip: enough to name the cause at a glance, not enough
 * to drown the composer.
 *
 * Recognition order, first match wins:
 *   1. a namespaced code (`gateway/lookup-not-found`, `session/…`) — the
 *      gateway's own vocabulary, and the most specific fact available;
 *   2. a JavaScript error name (`TypeError`, `Error`) — a thrown value that
 *      reached the caller unfiltered;
 *   3. the detail itself, clipped — anything else is a sentence, and half of it
 *      beats none.
 *
 * @param detail - the failure detail as the transport recorded it.
 * @returns a non-empty one-line diagnosis, or `''` when there is nothing to say.
 */
export function failureDiagnostic(detail) {
  if (typeof detail !== 'string') return ''
  const text = detail.trim()
  if (text.length === 0) return ''
  const code = /^([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)/u.exec(text)
  if (code !== null) return code[1]
  const thrown = /^([A-Za-z]*Error)\b/u.exec(text)
  if (thrown !== null) return thrown[1]
  return text.length > DIAGNOSTIC_CEILING ? `${text.slice(0, DIAGNOSTIC_CEILING - 1)}…` : text
}

/**
 * Everything the component renders, derived in one place.
 * @param state - current state.
 * @param draft - the live draft.
 * @param t - the namespace-bound translate function.
 * @returns the view model.
 */
export function viewModel(state, draft, t) {
  const busy = isBusy(state)
  const failed = state.phase === PHASES.FAILED
  const enabled = canStart(state, draft)
  return {
    busy,
    failed,
    /** Which glyph the seat shows. */
    icon: busy ? 'busy' : failed ? 'failed' : 'idle',
    /** Disabled covers both "busy" (the button then acts as cancel) and "nothing to enhance". */
    disabled: !enabled && !busy,
    ariaLabel: busy ? t('enhance.aria.busy') : failed ? t('enhance.aria.failed') : t('enhance.aria'),
    ariaBusy: busy ? 'true' : undefined,
    tooltip: busy
      ? t('enhance.tooltip.busy')
      : failed
        ? t('enhance.tooltip.failed')
        : enabled ? t('enhance.tooltip') : t('enhance.tooltip.disabled'),
    error: failed ? t(failureKey(state.failure?.code), { limit: MAX_DRAFT_LENGTH }) : '',
    errorDetail: failed ? state.failure?.detail ?? '' : '',
    /** The abridged cause, rendered next to {@link viewModel.error}'s sentence. */
    diagnostic: failed ? failureDiagnostic(state.failure?.detail ?? '') : '',
    revertTarget: revertTarget(state, draft),
  }
}
