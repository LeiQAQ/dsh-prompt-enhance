/**
 * A local deadline: the timing/classification half of a timeout.
 *
 * `@deepseek-ai/dsh-timeout` documents exactly this contract — fuse the caller's
 * cancellation with a timer into one `AbortSignal`, and keep the ability to tell
 * "timed out" from "cancelled" afterwards — but it is a plain library that the
 * host may or may not have resolvable from a third-party plugin's module root.
 * Reimplementing the two pure functions here keeps the plugin free of any
 * runtime value-import of a dsh package (PRD §6.3) with identical semantics.
 *
 * The signal only *notifies*: handing it to `ctx.llm.stream` is what actually
 * closes the provider request, which is the termination path this deadline
 * relies on.
 *
 * @module dsh-prompt-enhance/deadline
 */

/** Distinguishes this deadline's timer from an upstream cancel when classifying an abort. */
export const ENHANCE_TIMEOUT_CODE = 'PROMPT_ENHANCE_TIMEOUT'

/**
 * The internal reason stamped onto a timeout abort.
 * @typedef {{ code: string, timeoutMs: number }} TimeoutReason
 */

/**
 * Read the timeout reason off an aborted signal, scoped to one code.
 * @param signal - the possibly-aborted signal.
 * @param code - only a timer stamped with this code counts as a timeout.
 * @returns the reason, or `undefined` for a plain cancel / no abort.
 */
export function timeoutOf(signal, code) {
  if (signal === undefined || signal.aborted !== true) return undefined
  const reason = signal.reason
  if (reason === undefined || reason === null || typeof reason !== 'object') return undefined
  if (reason.code !== code) return undefined
  return reason
}

/**
 * Arm one deadline over an optional upstream signal.
 * @param upstream - the caller's cancellation, if any.
 * @param timeoutMs - positive finite budget in milliseconds.
 * @param code - the reason code stamped on a timer abort.
 * @returns the fused signal, a classifier, and a disposer that clears the timer.
 */
export function deadline(upstream, timeoutMs, code) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`deadline timeout must be a positive finite number, got ${String(timeoutMs)}`)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(Object.freeze({ code, timeoutMs }))
  }, timeoutMs)
  /* A pending timer must never hold the host process open. */
  if (typeof timer.unref === 'function') timer.unref()

  const sources = [upstream, controller.signal].filter(source => source !== undefined)
  /* `AbortSignal.any` preserves an upstream TimeoutReason when that timer fires
   * first, and short-circuits immediately when a source is already aborted. */
  const fused = typeof AbortSignal.any === 'function'
    ? AbortSignal.any(sources)
    : linkFirstAbort(sources)

  return {
    signal: fused,
    /** Whether this deadline's own timer produced the abort. */
    timedOut: () => timeoutOf(fused, code) !== undefined,
    /** Clear the timer; idempotent. */
    dispose: () => {
      clearTimeout(timer)
    },
  }
}

/**
 * Fallback for runtimes without `AbortSignal.any`: mirror the first abort onto a
 * fresh controller. Only reached on an older V8, so it stays minimal.
 * @param sources - signals to observe in order.
 * @returns a signal that aborts with the first aborting source's reason.
 */
function linkFirstAbort(sources) {
  const controller = new AbortController()
  for (const source of sources) {
    if (source.aborted) {
      controller.abort(source.reason)
      break
    }
    source.addEventListener('abort', () => controller.abort(source.reason), { once: true })
  }
  return controller.signal
}
