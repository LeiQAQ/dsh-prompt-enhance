/**
 * The model-call seam: chunk aggregation, terminal classification, and the
 * post-processing step that mirrors WorkBuddy's `stripWrappingQuotes`.
 *
 * dsh's `ctx.llm.stream` is a raw chunk protocol. The terminal chunk is
 * `{ type: 'finish', reason }` where `reason` is `{ kind, failure? }` with
 * `kind` in `stop | error | aborted | max-tokens | tool-calls`; `error` and
 * `aborted` carry `failure { code, message }` (verified against
 * `dsh-llm`'s `adapterFailureChunk` and `dsh-llm-deepseek`'s adapter, both of
 * which nest the reason under `chunk.reason` — the `BlockAssembler` does
 * `this._finish = chunk.reason`). A model-request failure therefore arrives as
 * a value, not as a throw. `dsh-compaction-basic` and `dsh-session-title-llm`
 * both classify it through this same switch, and both discard any deltas
 * collected before the failure.
 *
 * Aggregation is hand-rolled rather than delegating to `BlockAssembler`: the
 * request declares no tools and expects one text block, so the whole assembly
 * contract reduces to "concatenate text deltas, read the terminal finish". That
 * choice also keeps the plugin from value-importing a dsh package at runtime
 * (PRD §6.3).
 *
 * @module dsh-prompt-enhance/llm
 */

/**
 * Terminal failure of one model call.
 * @typedef {{ code: string, message: string }} CallFailure
 */

/**
 * Collect text deltas and the terminal finish from one stream.
 * @returns a collector whose `text`/`finish`/`sawText` read the accumulated state.
 */
export function createChunkCollector() {
  let text = ''
  let finish
  let deltas = 0
  return {
    /**
     * Absorb one chunk.
     * @param chunk - a `StreamChunk` from `ctx.llm.stream`.
     */
    push(chunk) {
      if (chunk === null || typeof chunk !== 'object') return
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
        deltas += 1
        return
      }
      if (chunk.type === 'finish') finish = chunk
    },
    /** Accumulated text, exactly as delivered. */
    get text() {
      return text
    },
    /** The terminal `finish` chunk, or `undefined` when the stream ended without one. */
    get finish() {
      return finish
    },
    /** How many `text-delta` chunks were absorbed. */
    get deltas() {
      return deltas
    },
  }
}

/**
 * Classify a terminal `finish` chunk.
 * @param chunk - the terminal chunk (`{ type: 'finish', reason }`), or
 *   `undefined` when the iterator ended without one. A flat
 *   `{ type: 'finish', kind, failure? }` shape is also accepted defensively,
 *   in case a future dsh version documents that form.
 * @returns the failure to report, or `undefined` for a clean stop.
 */
export function finishFailure(chunk) {
  if (chunk === undefined || chunk === null) {
    return { code: 'llm_error', message: 'the model stream ended without a terminal finish' }
  }
  /* The shipped dsh-llm nests the classification under `chunk.reason`; unwrap
   * it, falling back to the chunk itself for a flat shape. */
  const reason = typeof chunk.reason === 'object' && chunk.reason !== null ? chunk.reason : chunk
  const holder = reason.failure !== undefined && reason.failure !== null && typeof reason.failure === 'object'
    ? reason.failure
    : undefined
  switch (reason.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const code = holder !== undefined && typeof holder.code === 'string' ? holder.code : reason.kind
      const message = holder !== undefined && typeof holder.message === 'string'
        ? holder.message
        : `the model call finished with kind "${reason.kind}"`
      return { code, message }
    }
    case 'max-tokens':
      return { code: 'max-tokens', message: 'the model hit its output limit before finishing the rewrite' }
    case 'tool-calls':
      return { code: 'tool-calls', message: 'the model requested a tool instead of rewriting the prompt' }
    default:
      return { code: 'llm_error', message: `unsupported finish kind "${String(reason.kind)}"` }
  }
}

/**
 * WorkBuddy's exact post-processing step: trim, then drop at most one wrapping
 * quote character from each end (straight or curly, single or double).
 *
 * Copied verbatim in behaviour from the original
 * `stripWrappingQuotes(text) { return text.trim().replace(/^["'"“”‘’]|["'"“”‘']$/g, "") }`.
 * Note there is deliberately no second trim: the original's regex can expose
 * whitespace that sat inside a wrapping quote, and matching that quirk is the
 * point of copying rather than improving it.
 * @param text - the raw model output.
 * @returns the cleaned rewrite.
 */
export function stripWrappingQuotes(text) {
  return text.trim().replace(/^["'"“”‘’]|["'"“”‘']$/gu, '')
}

/** Frozen empty array shared by every built message. */
const NO_BLOCKS = Object.freeze([])

/**
 * Build the one user message an auxiliary call sends.
 *
 * Constructed to the `Message` shape directly (`id` + `role` + `content` +
 * `source`) instead of through `createUserMessage`, because that constructor
 * lives in a dsh package this plugin does not value-import; the produced value
 * is structurally identical and deep-frozen, which is the invariant the loop's
 * own `deepFreeze` establishes before dispatch.
 *
 * @param text - the complete user-message text.
 * @param pluginName - the producing plugin, recorded in the message source.
 * @returns a frozen user message.
 */
export function buildUserMessage(text, pluginName) {
  const randomUuid = globalThis.crypto !== undefined && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    /* Non-secret fallback for a host without WebCrypto: the id only has to be unique per process. */
    : `prompt-enhance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return Object.freeze({
    id: randomUuid,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'plugin', plugin: pluginName }),
  })
}

/** Re-exported so callers do not reach for a second empty constant. */
export { NO_BLOCKS }
