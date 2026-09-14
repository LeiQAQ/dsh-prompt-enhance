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
export const COMMAND_NAME = 'enhance-prompt'

/**
 * Marks the command argument as an encoded draft rather than literal text.
 *
 * The composer draft is arbitrary user text: newlines, non-ASCII, leading
 * slashes, even a bare `/name` that the parser would read as a second command.
 * Encoding it into `[A-Za-z0-9_-]` makes the line unambiguous by construction;
 * the prefix exists so the command stays usable by hand (`/enhance-prompt
 * 把这段话说清楚点` still works, the literal branch).
 */
export const TRANSPORT_PREFIX = 'b64:'

/** Hard ceiling on one draft, measured in UTF-16 code units of the decoded text. */
export const MAX_DRAFT_LENGTH = 20000

/** Locale dictionary namespace owned by the browser half. */
export const LOCALE_NS = 'prompt-enhance'
