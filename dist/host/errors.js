/**
 * The host half's error surface.
 *
 * A command handler can only answer `{ kind: 'success' | 'error', text }`, so a
 * machine code has to travel inside the text. The wire form is
 *
 *   `[prompt-enhance:<code>] <human sentence>`
 *
 * The bracket tag is what the browser half parses to render its own localised
 * copy; the sentence after it is what a reader of the conversation flow node
 * sees when the tag is not recognised. WorkBuddy's own normalisation used the
 * same four-code shape (`empty_input` / `sidecar_unavailable` / `llm_error` /
 * `unknown`); the shared taxonomy keeps those meanings and adds the cases a
 * provider-backed host can distinguish but a sidecar CLI could not.
 *
 * The vocabulary itself lives in `../shared/codes.js` — one module both halves
 * read, so the tag cannot drift between producer and parser. This file only
 * adds the host-only diagnostics.
 *
 * @module dsh-prompt-enhance/errors
 */

import { describeThrown } from './thrown.js'

export {
  ERROR_CODES, ERROR_TAG_OPEN, SILENT_CODES, formatErrorText, parseErrorText,
} from '../shared/codes.js'

/**
 * Aliases kept for the handler's reading rhythm: the host half formats a
 * failure and parses one back (its own tests do the latter), never anything
 * else, so the shorter names read as the two verbs of one wire format.
 */
export { formatErrorText as formatError, parseErrorText as parseError } from '../shared/codes.js'

export { describeThrown }
