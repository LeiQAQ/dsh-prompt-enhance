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
export const ERROR_CODES = Object.freeze({
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
export const SILENT_CODES = Object.freeze([ERROR_CODES.ABORTED])

/** Opening marker of the machine-readable tag every error result text carries. */
export const ERROR_TAG_OPEN = '[prompt-enhance:'

/**
 * Format one failure as the handler's `error` result text.
 * @param code - one of {@link ERROR_CODES}.
 * @param detail - optional human sentence appended after the tag.
 * @returns the wire text.
 */
export function formatErrorText(code, detail) {
  const sentence = typeof detail === 'string' && detail.trim().length > 0 ? detail.trim() : ''
  return `${ERROR_TAG_OPEN}${code}]${sentence.length > 0 ? ` ${sentence}` : ''}`
}

/**
 * Recover the code and sentence from a handler error text.
 * @param text - the text returned by the handler.
 * @returns the parsed parts, or `undefined` when the text carries no tag.
 */
export function parseErrorText(text) {
  if (typeof text !== 'string' || !text.startsWith(ERROR_TAG_OPEN)) return undefined
  const close = text.indexOf(']', ERROR_TAG_OPEN.length)
  if (close < 0) return undefined
  const code = text.slice(ERROR_TAG_OPEN.length, close)
  if (code.length === 0) return undefined
  return { code, detail: text.slice(close + 1).trim() }
}
