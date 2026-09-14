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

import { ERROR_CODES, parseErrorText } from '../shared/codes.js'
import { buildCommandLine } from '../shared/codec.js'
import { COMMAND_NAME } from '../shared/protocol.js'

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
export function buildLine(text) {
  return buildCommandLine(COMMAND_NAME, text)
}

/**
 * Reduce a resolved command call to an outcome.
 * @param result - the value `ctx.remote.commands.execute` resolved to.
 * @returns the outcome the seat acts on.
 */
export function interpret(result) {
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
export function describeThrown(error) {
  if (error instanceof Error) return error.message.length > 0 ? `${error.name}: ${error.message}` : error.name
  if (typeof error === 'string') return error
  try {
    const text = JSON.stringify(error)
    return text === undefined ? String(error) : text
  } catch {
    return Object.prototype.toString.call(error)
  }
}
