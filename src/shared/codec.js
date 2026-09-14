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

import { MAX_DRAFT_LENGTH, TRANSPORT_PREFIX } from './protocol.js'

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
export const CODEC_REASONS = Object.freeze({
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
export class DraftCodecError extends Error {
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
export function encodeBase64Url(text) {
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
export function decodeBase64Url(token) {
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
export function encodeDraft(text) {
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
export function decodeDraft(token) {
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
export function buildCommandLine(name, text) {
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
export function parseDraftArgument(rawInput) {
  const raw = typeof rawInput === 'string' ? rawInput.trim() : ''
  if (raw.length === 0) return { text: '', transport: 'literal' }
  if (!raw.startsWith(TRANSPORT_PREFIX)) return { text: raw, transport: 'literal' }
  /* `parseCommand` deliberately does not normalize trailing input, so the token
   * is stripped of every whitespace character rather than merely trimmed — a
   * base64url token never contains one. */
  const token = raw.slice(TRANSPORT_PREFIX.length).replace(/\s+/gu, '')
  return { text: decodeDraft(token), transport: 'b64' }
}
