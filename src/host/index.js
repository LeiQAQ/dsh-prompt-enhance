/**
 * `dsh-prompt-enhance` — host half.
 *
 * Delivers one behaviour: rewrite the composer's draft into a stronger prompt
 * through a single model call, using WorkBuddy's own system prompt and user
 * template. It is registered as an ordinary human command, which is the only
 * front-end-reachable channel a third-party plugin can open (the client's
 * `remote` faces are fixed at build time), and it is declared
 * `recordInput: false` so the draft never lands in the session log as `args`.
 *
 * Zero runtime value-imports of dsh packages: every host capability arrives
 * through `ctx` (`commands`, `llm`), and the `Message`/`StreamChunk` shapes are
 * handled structurally. That keeps the plugin loading on a host whose module
 * root does not expose dsh internals to third-party plugins.
 *
 * @module dsh-prompt-enhance
 */

import { CODEC_REASONS, DraftCodecError, parseDraftArgument } from '../shared/codec.js'
import { COMMAND_NAME, MAX_DRAFT_LENGTH } from '../shared/protocol.js'
import { ENHANCE_TIMEOUT_CODE, deadline } from './deadline.js'
import { ERROR_CODES, describeThrown, formatError } from './errors.js'
import {
  buildUserMessage,
  createChunkCollector,
  finishFailure,
  stripWrappingQuotes,
} from './llm.js'
import { SYSTEM_PROMPT, renderUserPrompt } from './prompts.js'
import { resolveSelection, sessionIdOf } from './selection.js'

/** Cordis plugin name. */
export const name = 'prompt-enhance'

/** Required services. `llm` is read lazily so a host without it still mounts and reports `no_model`. */
export const inject = ['commands']

/** The plugin's own deadline, in milliseconds. WorkBuddy's original was 300 000. */
export const DEFAULT_TIMEOUT_MS = 120_000

/** Short summary shown by command discovery. */
const COMMAND_DESCRIPTION =
  'rewrite the composer draft into a stronger prompt (input-toolbar button is the usual entry)'

/** Input hint advertised to capable clients; the transport form is opaque by design. */
const COMMAND_HINT = '[<draft text>, or the encoded transport form the toolbar sends]'

/**
 * One model call, from an already-decoded draft to a cleaned rewrite.
 *
 * @param deps - the resolved collaborators for this invocation.
 * @param deps.llm - the `llm` service (`ctx.get('llm')`).
 * @param deps.text - the decoded draft.
 * @param deps.route - the resolved provider/model route.
 * @param deps.sessionId - session to stamp the request with, when known.
 * @param deps.signal - the invocation's cancellation signal.
 * @param deps.timeoutMs - the plugin's deadline budget.
 * @param deps.log - structured logger for lengths and timings only.
 * @returns the rewrite, or the failure to report as a command error.
 */
async function rewrite(deps) {
  const { llm, text, route, sessionId, signal, timeoutMs, log } = deps
  const started = Date.now()
  const arm = deadline(signal, timeoutMs, ENHANCE_TIMEOUT_CODE)
  try {
    const options = {
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
      system: SYSTEM_PROMPT,
      messages: [buildUserMessage(renderUserPrompt(text), 'dsh-prompt-enhance')],
      ...(sessionId === undefined ? {} : { sessionId }),
      signal: arm.signal,
    }

    const collector = createChunkCollector()
    for await (const chunk of llm.stream(options)) collector.push(chunk)

    /* Classify before looking at the text: a failed call may have emitted
     * partial deltas, and those must never be mistaken for a rewrite. */
    if (arm.timedOut()) {
      return { ok: false, code: ERROR_CODES.TIMEOUT, detail: `no answer within ${timeoutMs} ms` }
    }
    if (arm.signal.aborted) {
      return { ok: false, code: ERROR_CODES.ABORTED, detail: 'the rewrite was cancelled' }
    }
    const failure = finishFailure(collector.finish)
    if (failure !== undefined) {
      log({ code: ERROR_CODES.LLM_ERROR, failure: failure.code, elapsedMs: Date.now() - started })
      return { ok: false, code: ERROR_CODES.LLM_ERROR, detail: failure.message }
    }

    const cleaned = stripWrappingQuotes(collector.text)
    if (cleaned.trim().length === 0) {
      return { ok: false, code: ERROR_CODES.OUTPUT_EMPTY, detail: 'the model returned no usable text' }
    }

    log({
      code: 'ok',
      inputLength: text.length,
      outputLength: cleaned.length,
      elapsedMs: Date.now() - started,
      model: route.model,
      route: route.source,
    })
    return { ok: true, text: cleaned }
  } finally {
    arm.dispose()
  }
}

/**
 * Execute one `/enhance-prompt` invocation.
 * @param ctx - the plugin context.
 * @param invocation - the command invocation supplied by the registry.
 * @param timeoutMs - the resolved deadline budget.
 * @returns the command result rendered by the dispatching adapter.
 */
async function handle(ctx, invocation, timeoutMs) {
  const logger = ctx.logger
  const log = (payload) => {
    try {
      logger?.info?.('[prompt-enhance]', payload)
    } catch {
      /* Diagnostics must never be able to fail the user's rewrite. */
    }
  }

  /* [3] admission. One codec reports both "the token is not a token" and "the
   * draft is over the ceiling", but those are different verdicts to the user:
   * the second is a statement about their text, and the codec's message already
   * names both numbers. Only genuine transport faults become `bad_encoding`. */
  let draft
  try {
    draft = parseDraftArgument(invocation.rawInput)
  } catch (error) {
    if (error instanceof DraftCodecError && error.reason === CODEC_REASONS.SIZE) {
      return { kind: 'error', text: formatError(ERROR_CODES.TOO_LONG, error.message) }
    }
    const detail = error instanceof DraftCodecError
      ? 'the draft argument did not decode; reopen the composer draft and use the toolbar button again'
      : describeThrown(error)
    return { kind: 'error', text: formatError(ERROR_CODES.BAD_ENCODING, detail) }
  }
  /* Reachable for the literal entry point only: a `b64:` oversize draft is
   * already rejected by the codec above, with a better message. */
  const text = draft.text
  if (text.trim().length === 0) {
    return { kind: 'error', text: formatError(ERROR_CODES.EMPTY_INPUT, 'the draft is empty.') }
  }
  if (text.length > MAX_DRAFT_LENGTH) {
    return {
      kind: 'error',
      text: formatError(
        ERROR_CODES.TOO_LONG,
        `the draft is ${text.length} characters; the limit is ${MAX_DRAFT_LENGTH}.`,
      ),
    }
  }
  if (invocation.signal !== undefined && invocation.signal.aborted) {
    return { kind: 'error', text: formatError(ERROR_CODES.ABORTED, 'the rewrite was cancelled') }
  }

  /* [4] route. Missing LLM service and missing route share one user-visible
   * code: from the composer both mean "there is no model to call". */
  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
    return { kind: 'error', text: formatError(ERROR_CODES.NO_MODEL, 'no model service is composed on this host.') }
  }
  const route = resolveSelection(invocation.agent)
  if (route === undefined) {
    return {
      kind: 'error',
      text: formatError(
        ERROR_CODES.NO_MODEL,
        'this session has no routed model yet. Send one message first, or set a default model.',
      ),
    }
  }

  /* [5]-[8] call, classify, post-process. */
  try {
    const outcome = await rewrite({
      llm,
      text,
      route,
      sessionId: sessionIdOf(invocation.agent),
      signal: invocation.signal,
      timeoutMs,
      log,
    })
    if (!outcome.ok) return { kind: 'error', text: formatError(outcome.code, outcome.detail) }
    return { kind: 'success', text: outcome.text }
  } catch (error) {
    const detail = describeThrown(error)
    log({ code: ERROR_CODES.INTERNAL, error: detail })
    return { kind: 'error', text: formatError(ERROR_CODES.INTERNAL, detail) }
  }
}

/**
 * Resolve the deadline budget from the plugin entry's config.
 *
 * A cordis entry may carry config (`{ id, name, config }` in the patch file);
 * an absent or unusable value falls back to {@link DEFAULT_TIMEOUT_MS} rather
 * than failing the mount over a configuration typo.
 * @param config - the entry config, when one was supplied.
 * @returns the budget in milliseconds.
 */
function resolveTimeoutMs(config) {
  const requested = config !== undefined && config !== null ? config.timeoutMs : undefined
  return typeof requested === 'number' && Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_TIMEOUT_MS
}

/**
 * Register the command.
 * @param ctx - the plugin context.
 * @param config - optional entry config (`{ timeoutMs }`).
 */
export function apply(ctx, config) {
  const timeoutMs = resolveTimeoutMs(config)
  ctx.commands.register({
    name: COMMAND_NAME,
    description: COMMAND_DESCRIPTION,
    input: { hint: COMMAND_HINT },
    /* The draft is the payload of a request whose real domain is the composer;
     * recording `args` would duplicate it in the session log (AC10). */
    recordInput: false,
    handler: invocation => handle(ctx, invocation, timeoutMs),
  })
}
