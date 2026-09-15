window.__ModuleLoader__.load({
  id: "dsh-prompt-enhance",
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var IconLoadingOutline16 = require("@deepseek-ai/dsh-client-ui-primitives").IconLoadingOutline16
    var IconRefreshOutline14 = require("@deepseek-ai/dsh-client-ui-primitives").IconRefreshOutline14
    var IconSparkle16 = require("@deepseek-ai/dsh-client-ui-primitives").IconSparkle16
    var IconWarningOutline16 = require("@deepseek-ai/dsh-client-ui-primitives").IconWarningOutline16
    var jsx = require("react/jsx-runtime").jsx
    var Tooltip = require("@deepseek-ai/dsh-client-ui-primitives").Tooltip
    var useEffect = require("react").useEffect
    var useRef = require("react").useRef
    var useState = require("react").useState

    /* ---- src/shared/protocol.js ---- */
    /**
     * The wire agreement between the two halves of the plugin.
     *
     * Everything here is a value both halves must read identically; keeping it in
     * one module is what makes the browser half's command line and the host half's
     * parser provably agree (the build inlines this module into the client bundle,
     * so there is no second copy to drift).
     *
     * @module dsh-prompt-enhance/shared/protocol
     */

    /** Registered command name, without the leading slash. Must match the host's `parseCommand` grammar. */
    const COMMAND_NAME = 'enhance-prompt'

    /**
     * Marks the command argument as an encoded draft rather than literal text.
     *
     * The composer draft is arbitrary user text: newlines, non-ASCII, leading
     * slashes, even a bare `/name` that the parser would read as a second command.
     * Encoding it into `[A-Za-z0-9_-]` makes the line unambiguous by construction;
     * the prefix exists so the command stays usable by hand (`/enhance-prompt
     * 把这段话说清楚点` still works, the literal branch).
     */
    const TRANSPORT_PREFIX = 'b64:'

    /** Hard ceiling on one draft, measured in UTF-16 code units of the decoded text. */
    const MAX_DRAFT_LENGTH = 20000

    /** Locale dictionary namespace owned by the browser half. */
    const LOCALE_NS = 'prompt-enhance'

    /* ---- src/shared/codes.js ---- */
    /**
     * Error codes shared by both halves of the plugin.
     *
     * The host half formats a failure into the only channel a command result offers
     * (`text`); the browser half parses it back to decide between "stay silent"
     * (the user cancelled) and "show a localised sentence". One module owns the
     * vocabulary so the two halves cannot drift.
     *
     * `export` keywords are stripped when this file is inlined into the browser
     * bundle (see `scripts/build.mjs`), and left intact for the host build, which
     * ships it as an ordinary ES module.
     *
     * @module dsh-prompt-enhance/shared/codes
     */

    /** Stable machine codes carried in the error tag. */
    const ERROR_CODES = Object.freeze({
      /** The decoded draft has no non-whitespace content. */
      EMPTY_INPUT: 'empty_input',
      /** The draft exceeds the transport's draft ceiling. */
      TOO_LONG: 'too_long',
      /** The command argument claimed the transport form but is not decodable. */
      BAD_ENCODING: 'bad_encoding',
      /** No LLM service is composed, or no provider/model route could be resolved. */
      NO_MODEL: 'no_model',
      /** The model call reached a terminal failure finish. */
      LLM_ERROR: 'llm_error',
      /** The call exceeded the plugin's own deadline. */
      TIMEOUT: 'timeout',
      /** The caller cancelled the invocation. */
      ABORTED: 'aborted',
      /** The model returned nothing usable after quote stripping. */
      OUTPUT_EMPTY: 'output_empty',
      /** The call never reached the host (transport/RPC failure). Client-side only. */
      TRANSPORT: 'transport',
      /** The host does not know this command — the plugin is not loaded. Client-side only. */
      NO_COMMAND: 'no_command',
      /** Anything the plugin did not classify: a defect, reported verbatim. */
      INTERNAL: 'internal',
    })

    /** Tags that mean "the user cancelled", so the browser half stays silent. */
    const SILENT_CODES = Object.freeze([ERROR_CODES.ABORTED])

    /** Opening marker of the machine-readable tag every error result text carries. */
    const ERROR_TAG_OPEN = '[prompt-enhance:'

    /**
     * Format one failure as the handler's `error` result text.
     * @param code - one of {@link ERROR_CODES}.
     * @param detail - optional human sentence appended after the tag.
     * @returns the wire text.
     */
    function formatErrorText(code, detail) {
      const sentence = typeof detail === 'string' && detail.trim().length > 0 ? detail.trim() : ''
      return `${ERROR_TAG_OPEN}${code}]${sentence.length > 0 ? ` ${sentence}` : ''}`
    }

    /**
     * Recover the code and sentence from a handler error text.
     * @param text - the text returned by the handler.
     * @returns the parsed parts, or `undefined` when the text carries no tag.
     */
    function parseErrorText(text) {
      if (typeof text !== 'string' || !text.startsWith(ERROR_TAG_OPEN)) return undefined
      const close = text.indexOf(']', ERROR_TAG_OPEN.length)
      if (close < 0) return undefined
      const code = text.slice(ERROR_TAG_OPEN.length, close)
      if (code.length === 0) return undefined
      return { code, detail: text.slice(close + 1).trim() }
    }

    /* ---- src/client/styles.js ---- */
    /**
     * The seat's own stylesheet, injected once as a plain `<style>` tag.
     *
     * The composer toolbar is a flex row of `display:contents` slot anchors, so the
     * seat contributes exactly one inline-flex box. Everything coloured reads a
     * platform alias token (`--dsw-alias-*`), which is what keeps the button
     * visually identical to its neighbours across themes; no hardcoded palette.
     *
     * Injecting through a `<style>` tag rather than a CSS-module import is the
     * convention for a third-party bundle here (the platform's own bundles do the
     * same), and it costs no extra dependency.
     *
     * @module dsh-prompt-enhance/client/styles
     */

    /** Class names, namespaced so they cannot collide with platform or other plugin styles. */
    const CLASS = Object.freeze({
      seat: 'dpe-seat',
      button: 'dpe-button',
      spinning: 'dpe-spinning',
      failed: 'dpe-failed',
      error: 'dpe-error',
      diagnostic: 'dpe-diagnostic',
    })

    /** Identity of the injected tag; also the idempotence key. */
    const STYLE_TAG_ID = 'dsh-prompt-enhance/seat.css'

    const CSS = [
      '.dpe-seat{display:inline-flex;align-items:center;gap:2px;min-width:0}',
      '.dpe-button{display:inline-flex;align-items:center;justify-content:center;',
      'width:28px;height:28px;padding:0;border:none;border-radius:8px;cursor:pointer;',
      'background:transparent;color:var(--dsw-alias-label-secondary);',
      'transition:background .15s ease,color .15s ease}',
      '.dpe-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-primary)}',
      '.dpe-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.dpe-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dpe-button:disabled{opacity:.4;cursor:default}',
      '.dpe-button.dpe-failed{color:var(--dsw-alias-state-error-primary)}',
      '.dpe-spinning{animation:dpe-spin 1s linear infinite}',
      '@keyframes dpe-spin{to{transform:rotate(360deg)}}',
      '.dpe-error{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
      /* The diagnostic chip is deliberately quiet — secondary label colour, the
       * composer's own type scale, a monospace face because its content is a code
       * and not prose — and clipped, so a chatty host message cannot push the send
       * button around. The full text stays reachable through its `title`. */
      '.dpe-diagnostic{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:18px;',
      'color:var(--dsw-alias-label-secondary)}',
    ].join('')

    /**
     * Install the seat's stylesheet, at most once per document.
     * @returns a disposer removing the tag this call created, or a no-op when the tag was already present.
     */
    function installStyles() {
      if (typeof document === 'undefined' || document.head === null) return () => {}
      if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-prompt-enhance'
      tag.dataset.pluginCss = STYLE_TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /* ---- src/core/rewrite-state.js ---- */
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



    /** Character ceiling of the diagnostic chip, ellipsis included. */
    const DIAGNOSTIC_CEILING = 48

    /** The button's three states (PRD F4). */
    const PHASES = Object.freeze({
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
    function initialState() {
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
    function reduce(state, action) {
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
    function isBusy(state) {
      return state.phase === PHASES.ENHANCING
    }

    /**
     * The empty-draft gate (PRD F2, AC2).
     * @param state - current state.
     * @param draft - the live draft.
     * @returns true when a run may start.
     */
    function canStart(state, draft) {
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
    function baselineMatches(baseline, current) {
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
    function revertTarget(state, draft) {
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
    function oversizeFailure(draft) {
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
    function failureKey(code) {
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
    function failureDiagnostic(detail) {
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
    function viewModel(state, draft, t) {
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

    /* ---- src/shared/codec.js ---- */
    /**
     * Draft transport codec — the only hard technical risk in the whole design.
     *
     * A command line is `/name` + a whitespace-separated raw argument, parsed by
     * dsh's own grammar (`/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u` plus a split on
     * whitespace). The composer draft is arbitrary user text — it may contain
     * newlines, non-ASCII, a leading slash, or literally another command line. So
     * the draft never travels as text: it travels as an unpadded base64url token
     * over its UTF-8 bytes, prefixed with `b64:` so the literal form stays usable.
     *
     * Properties this buys, all of which the tests pin:
     *   - the line contains no character the parser can misread;
     *   - the session log never carries the draft as an `args` value (the command
     *     is declared `recordInput: false`, and even the transport token is opaque);
     *   - encode/decode round-trips exactly, including astral-plane characters
     *     (emoji) and lone-`\r\n` line endings;
     *   - a malformed token fails as a typed {@link DraftCodecError}, never as a
     *     raw `TypeError` from a platform primitive.
     *
     * Both halves import this module — the browser one for `encode`, the host one
     * for `decode` — and the build inlines it into the client bundle, so there is
     * exactly one implementation of the agreement.
     *
     * @module dsh-prompt-enhance/shared/codec
     */


    /** base64url (RFC 4648 §5) alphabet; no padding is ever emitted. */
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

    /** Reverse alphabet for validation, sized to ASCII so a non-ASCII code unit is an instant reject. */
    const LOOKUP = /* @__PURE__ */ createLookup()

    function createLookup() {
      const table = new Int16Array(128).fill(-1)
      for (let index = 0; index < ALPHABET.length; index += 1) {
        table[ALPHABET.charCodeAt(index)] = index
      }
      return table
    }

    /**
     * Bytes folded into one `String.fromCharCode` call stay far below the engine's
     * argument ceiling while keeping the concatenation count negligible: a 20 000
     * character draft is at most 60 000 UTF-8 bytes, i.e. eight chunks.
     */
    const BINARY_CHUNK = 8192

    /** Why a draft could not be transported, so the caller can report the right thing. */
    const CODEC_REASONS = Object.freeze({
      /** A non-string reached the codec. */
      TYPE: 'type',
      /** The token holds a character outside the base64url alphabet. */
      ALPHABET: 'alphabet',
      /** The token's length cannot be a base64 length (`length % 4 === 1`). */
      LENGTH: 'length',
      /** The platform decoder rejected the token. */
      BASE64: 'base64',
      /** The decoded bytes are not valid UTF-8. */
      UTF8: 'utf8',
      /** The decoded draft exceeds {@link MAX_DRAFT_LENGTH}. Not a transport fault: the message is the point. */
      SIZE: 'size',
    })

    /** Raised for every transport-layer rejection, so callers catch one type. */
    class DraftCodecError extends Error {
      /**
       * @param reason - one of {@link CODEC_REASONS}.
       * @param message - what went wrong, in the host's diagnostic voice.
       */
      constructor(reason, message) {
        super(message)
        this.name = 'DraftCodecError'
        /** Why it failed — the caller maps this to a user-facing verdict. */
        this.reason = reason
      }
    }

    /**
     * Encode one string as an unpadded base64url token over its UTF-8 bytes.
     * @param text - the text to encode.
     * @returns the token, matching `/^[A-Za-z0-9_-]*$/`.
     */
    function encodeBase64Url(text) {
      const bytes = new TextEncoder().encode(text)
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + BINARY_CHUNK))
      }
      return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
    }

    /**
     * Decode one unpadded base64url token back into text.
     * @param token - the token produced by {@link encodeBase64Url}.
     * @returns the decoded text.
     * @throws {DraftCodecError} when the token is not base64url, or its bytes are not UTF-8.
     */
    function decodeBase64Url(token) {
      if (typeof token !== 'string') throw new DraftCodecError(CODEC_REASONS.TYPE, 'the encoded draft is not a string')
      for (const character of token) {
        const code = character.charCodeAt(0)
        if (code > 127 || LOOKUP[code] < 0) {
          throw new DraftCodecError(CODEC_REASONS.ALPHABET, 'the encoded draft contains a character outside the base64url alphabet')
        }
      }
      const remainder = token.length % 4
      if (remainder === 1) throw new DraftCodecError(CODEC_REASONS.LENGTH, 'the encoded draft has an impossible length')
      const padded = remainder === 0 ? token : `${token}${'='.repeat(4 - remainder)}`
      const base64 = padded.replace(/-/gu, '+').replace(/_/gu, '/')
      let binary
      try {
        binary = atob(base64)
      } catch {
        throw new DraftCodecError(CODEC_REASONS.BASE64, 'the encoded draft is not valid base64url')
      }
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new DraftCodecError(CODEC_REASONS.UTF8, 'the encoded draft is not valid UTF-8')
      }
    }

    /**
     * Encode a draft for transport, enforcing the ceiling before spending bytes.
     * @param text - the draft text.
     * @returns the unpadded base64url token.
     * @throws {DraftCodecError} when the draft exceeds {@link MAX_DRAFT_LENGTH}.
     */
    function encodeDraft(text) {
      if (typeof text !== 'string') throw new DraftCodecError(CODEC_REASONS.TYPE, 'the draft is not a string')
      if (text.length > MAX_DRAFT_LENGTH) {
        throw new DraftCodecError(CODEC_REASONS.SIZE, `the draft is ${text.length} characters; the limit is ${MAX_DRAFT_LENGTH}`)
      }
      return encodeBase64Url(text)
    }

    /**
     * Decode a transported draft, enforcing the ceiling after decoding (the
     * ceiling is a property of the draft, not of its encoding).
     * @param token - the unpadded base64url token.
     * @returns the decoded draft text.
     * @throws {DraftCodecError} when the token is malformed or the draft is too long.
     */
    function decodeDraft(token) {
      const text = decodeBase64Url(token)
      if (text.length > MAX_DRAFT_LENGTH) {
        throw new DraftCodecError(CODEC_REASONS.SIZE, `the draft is ${text.length} characters; the limit is ${MAX_DRAFT_LENGTH}`)
      }
      return text
    }

    /**
     * Build the complete slash-command line the browser half sends.
     * @param name - the command name, without the leading slash.
     * @param text - the draft text.
     * @returns `/name b64:<token>`.
     */
    function buildCommandLine(name, text) {
      return `/${name} ${TRANSPORT_PREFIX}${encodeDraft(text)}`
    }

    /**
     * One parsed command argument.
     * @typedef {{ text: string, transport: 'literal' | 'b64' }} DraftArgument
     */

    /**
     * Parse the host-side `rawInput` into a draft.
     *
     * Two accepted forms: an explicit `b64:` token (what the toolbar sends), or
     * literal text (so `/enhance-prompt 把这段话写清楚点` typed by hand still
     * works). An empty argument is an empty draft, not an error — the handler owns
     * the "empty input" verdict so both entry points answer identically.
     *
     * @param rawInput - the argument as dsh's parser produced it.
     * @returns the parsed draft.
     * @throws {DraftCodecError} when the argument claims the transport form but is not decodable.
     */
    function parseDraftArgument(rawInput) {
      const raw = typeof rawInput === 'string' ? rawInput.trim() : ''
      if (raw.length === 0) return { text: '', transport: 'literal' }
      if (!raw.startsWith(TRANSPORT_PREFIX)) return { text: raw, transport: 'literal' }
      /* `parseCommand` deliberately does not normalize trailing input, so the token
       * is stripped of every whitespace character rather than merely trimmed — a
       * base64url token never contains one. */
      const token = raw.slice(TRANSPORT_PREFIX.length).replace(/\s+/gu, '')
      return { text: decodeDraft(token), transport: 'b64' }
    }

    /* ---- src/client/transport.js ---- */
    /**
     * The browser half's single seam onto the host: build the command line,
     * interpret what came back.
     *
     * dsh delivers a command result as a `CommandResult` — `{ kind: 'success',
     * text? } | { kind: 'error', text }` — wrapped in the RPC envelope
     * `{ ok: true, value } | { ok: false, error }`. Three distinct failure layers
     * therefore arrive through one call, and they must not be conflated:
     *
     *   1. **RPC failure** (`!ok`): the call never reached the handler. A transport
     *      problem, not a rewrite problem.
     *   2. **Unresolved command** (`value === undefined`): the host does not know
     *      `/enhance-prompt` — the plugin is not loaded. The user must be told,
     *      because retrying will never help.
     *   3. **Handler failure** (`result.kind === 'error'`): the tag inside
     *      `result.text` carries the machine code; `aborted` is the user's own
     *      cancel and stays silent, everything else gets a localised sentence.
     *
     * `interpret` is pure, so all three layers are pinned by unit tests instead of
     * by hoping the happy path generalises.
     *
     * @module dsh-prompt-enhance/client/transport
     */




    /**
     * What one round trip means to the seat.
     * @typedef {{ kind: 'rewrite', text: string }
     *   | { kind: 'silent' }
     *   | { kind: 'failure', code: string, detail: string }} Outcome
     */

    /**
     * Build the command line for one draft.
     * @param text - the draft as it stands in the composer.
     * @returns the complete slash-command line.
     */
    function buildLine(text) {
      return buildCommandLine(COMMAND_NAME, text)
    }

    /**
     * Reduce a resolved command call to an outcome.
     * @param result - the value `ctx.remote.commands.execute` resolved to.
     * @returns the outcome the seat acts on.
     */
    function interpret(result) {
      if (result === null || typeof result !== 'object') {
        return { kind: 'failure', code: ERROR_CODES.TRANSPORT, detail: 'the command call resolved to nothing' }
      }
      if (result.ok !== true) {
        const error = result.error ?? {}
        const code = typeof error.code === 'string' ? error.code : 'unknown'
        const message = typeof error.message === 'string' ? error.message : ''
        return {
          kind: 'failure',
          code: ERROR_CODES.TRANSPORT,
          detail: message.length > 0 ? `${code}: ${message}` : code,
        }
      }
      const value = result.value
      if (value === null || typeof value !== 'object') {
        return { kind: 'failure', code: ERROR_CODES.NO_COMMAND, detail: `/${COMMAND_NAME}` }
      }
      const command = value.result
      if (command === null || typeof command !== 'object') {
        return { kind: 'failure', code: ERROR_CODES.INTERNAL, detail: 'the command settled without a result' }
      }
      if (command.kind === 'success') {
        const text = typeof command.text === 'string' ? command.text : ''
        if (text.length === 0) {
          return { kind: 'failure', code: ERROR_CODES.OUTPUT_EMPTY, detail: '' }
        }
        return { kind: 'rewrite', text }
      }
      const tagged = parseErrorText(typeof command.text === 'string' ? command.text : '')
      if (tagged === undefined) {
        /* An untagged error text is the host reporting something the plugin did not
         * classify (a thrown `TypeError` from a platform primitive, say). Show it
         * verbatim as the detail; the sentence stays generic. */
        const detail = typeof command.text === 'string' ? command.text : ''
        return { kind: 'failure', code: ERROR_CODES.INTERNAL, detail }
      }
      if (tagged.code === ERROR_CODES.ABORTED) return { kind: 'silent' }
      return { kind: 'failure', code: tagged.code, detail: tagged.detail }
    }

    /**
     * Render a caught value as one short diagnostic line.
     * @param error - the caught value.
     * @returns a non-empty description.
     */
    function describeThrown(error) {
      if (error instanceof Error) return error.message.length > 0 ? `${error.name}: ${error.message}` : error.name
      if (typeof error === 'string') return error
      try {
        const text = JSON.stringify(error)
        return text === undefined ? String(error) : text
      } catch {
        return Object.prototype.toString.call(error)
      }
    }

    /* ---- src/client/component.js ---- */
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
    function PromptEnhanceSeat(props) {
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

    /* ---- src/client/locales.js ---- */
    /**
     * The composer seat's copy, in both shipped locales.
     *
     * Keys are flat and grouped by surface. The error sentences are the part that
     * matters: each one answers "was my draft touched?" explicitly, because the
     * whole failure contract of the feature is "the original text survives". A
     * failure whose cause is an unusable model (PRD §7.4) must read as a model
     * problem, not as a broken button.
     *
     * @module dsh-prompt-enhance/client/locales
     */

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'enhance.tooltip': '增强提示词',
      'enhance.tooltip.busy': '正在增强提示词… 点击取消',
      'enhance.tooltip.failed': '上次没成功，点一下再试',
      'enhance.tooltip.disabled': '先写点内容再增强',
      'enhance.aria': '增强提示词',
      'enhance.aria.busy': '正在增强提示词，按下取消',
      'enhance.aria.failed': '增强提示词失败，按下重试',
      'enhance.revert': '恢复原文',
      'enhance.revert.aria': '恢复增强前的原文',

      'enhance.error.empty_input': '输入框里还没有内容',
      'enhance.error.too_long': '草稿太长了，上限 {limit} 个字符',
      'enhance.error.bad_encoding': '草稿传输失败，重新点一次试试',
      'enhance.error.no_model': '这个会话还没有可用的模型。先发一条消息，或在设置里选一个模型',
      'enhance.error.llm_error': '模型调用失败，多半是模型不可用或网络问题。原文没动',
      'enhance.error.timeout': '等太久了，已经中止。原文没动',
      'enhance.error.output_empty': '模型没返回可用内容。原文没动',
      'enhance.error.transport': '和后台通信失败。原文没动',
      'enhance.error.no_command': '没找到增强命令，插件可能没装好',
      'enhance.error.internal': '出了个意外错误。原文没动',
      'enhance.error.unknown': '增强失败。原文没动',
    }

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'enhance.tooltip': 'Enhance prompt',
      'enhance.tooltip.busy': 'Enhancing… click to cancel',
      'enhance.tooltip.failed': 'That attempt failed — click to retry',
      'enhance.tooltip.disabled': 'Write something first',
      'enhance.aria': 'Enhance prompt',
      'enhance.aria.busy': 'Enhancing prompt, press to cancel',
      'enhance.aria.failed': 'Prompt enhancement failed, press to retry',
      'enhance.revert': 'Restore original',
      'enhance.revert.aria': 'Restore the text from before the enhancement',

      'enhance.error.empty_input': 'The composer is empty',
      'enhance.error.too_long': 'That draft is too long — the limit is {limit} characters',
      'enhance.error.bad_encoding': 'The draft could not be transferred. Click again',
      'enhance.error.no_model': 'This session has no model yet. Send a message first, or pick a model in settings',
      'enhance.error.llm_error': 'The model call failed — usually an unavailable model or a network problem. Your text is untouched',
      'enhance.error.timeout': 'That took too long, so it was stopped. Your text is untouched',
      'enhance.error.output_empty': 'The model returned nothing usable. Your text is untouched',
      'enhance.error.transport': 'Could not reach the background process. Your text is untouched',
      'enhance.error.no_command': 'The enhance command was not found — the plugin may not be installed',
      'enhance.error.internal': 'Something unexpected broke. Your text is untouched',
      'enhance.error.unknown': 'Enhancement failed. Your text is untouched',
    }

    /* ---- src/client/index.js ---- */
    /**
     * Browser half: put the "enhance prompt" seat in the composer toolbar.
     *
     * The registration is deliberately thin. Everything decidable is a pure
     * function in `state.js`/`transport.js`; everything visual is in
     * `component.js`; this file only wires the three platform services the seat
     * needs and states the one fact worth stating — the seat communicates with the
     * host through `remote.commands`, the only front-end-reachable channel
     * available to a third-party plugin (the client's remote faces are fixed at
     * build time, so a bespoke namespace is not an option).
     *
     * @module dsh-prompt-enhance/client
     */





    /** Cordis plugin name. */
    const name = 'prompt-enhance'

    /**
     * Required services: the slot registry, the Remote gateway, the mounted
     * `commands` namespace, and the locale registry.
     *
     * `remote` and `remote.commands` are both required, and that is not a
     * formality: cordis resolves the parent property first, and a property the
     * declaration does not name throws `cannot get property "remote" without
     * inject`. The throw happens on the *call*, never on the mount, so a
     * declaration one name short still renders a healthy seat and only fails the
     * moment a user clicks it — reporting an unreachable host while the host was
     * never asked.
     */
    const inject = ['slots', 'remote', 'remote.commands', 'locale']

    /** The toolbar seat this plugin occupies — a `list` slot, session-scoped. */
    const SLOT = 'conversation.input.right'

    /** Cell identity inside that slot: one registration per plugin, so the plugin name is the natural id. */
    const SEAT_ID = 'prompt-enhance'

    /**
     * Row order within the seat. Occupied neighbours in a real profile rule this
     * number: `dsh-codex-connect` holds 10 (fast-mode toggle) and 20 (quota
     * indicator). 40 sits to their right — nearest the send button, which is where
     * an action performed *on the draft* belongs — and, unlike the PRD's original
     * 10, it cannot tie with an installed occupant, so the two never swap places
     * across boot order.
     */
    const SEAT_ORDER = 40

    /**
     * Install the seat.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'prompt-enhance: dictionaries')

      ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT,
        id: SEAT_ID,
        order: SEAT_ORDER,
        locale: LOCALE_NS,
        /* The seat's business face: one bound call. The binding is per session, so
         * a result can never be addressed to the wrong composer (AC8's other half)
         * — `execute` takes the images array (always empty: the draft is text) and
         * the caller's abort signal, which the host forwards to the provider. */
        inject: sessionId => ({
          startRewrite: (line, signal) => ctx.remote.commands.execute(sessionId, line, [], signal),
        }),
      }, PromptEnhanceSeat))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  },
})
