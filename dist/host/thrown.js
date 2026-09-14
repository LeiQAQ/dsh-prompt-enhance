/**
 * Thrown-value rendering, following the `cause` chain the way dsh's own
 * `errorChain` helper does — transport wrappers otherwise report only
 * `fetch failed` and hide the real reason.
 *
 * Split from `errors.js` so the re-export barrel there stays a plain
 * vocabulary surface, and so this (host-only) helper never risks being pulled
 * into the browser bundle by a shared import.
 *
 * @module dsh-prompt-enhance/thrown
 */

/**
 * Render a thrown value as one diagnostic sentence.
 * @param error - the thrown value.
 * @returns a single-line, non-empty description.
 */
export function describeThrown(error) {
  const parts = []
  let current = error
  const seen = new Set()
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      parts.push(current.message.length > 0 ? `${current.name}: ${current.message}` : current.name)
      current = current.cause
      continue
    }
    parts.push(typeof current === 'string' ? current : safeStringify(current))
    break
  }
  return parts.length > 0 ? parts.join(' <- ') : 'unknown error'
}

/**
 * `JSON.stringify` a value that may not be stringifiable (cycles, bigint).
 * @param value - any thrown value.
 * @returns a short representation.
 */
function safeStringify(value) {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text
  } catch {
    return Object.prototype.toString.call(value)
  }
}
