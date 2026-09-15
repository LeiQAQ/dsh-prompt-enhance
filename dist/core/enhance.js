/**
 * Platform-neutral prompt enhancement service.
 *
 * The service owns admission, timeout/cancellation propagation, output
 * validation, and the stable result contract. It knows nothing about DSH,
 * Codex, React, the DOM, or a particular HTTP provider.
 *
 * @module dsh-prompt-enhance/core/enhance
 */

import { ERROR_CODES } from '../shared/codes.js'
import { MAX_DRAFT_LENGTH } from '../shared/protocol.js'

/**
 * Describe a caught value without exposing a stack or request payload.
 * @param error - the caught value.
 * @returns a short diagnostic string.
 */
export function describeEnhancementError(error) {
  if (error instanceof Error) return error.message.length > 0 ? `${error.name}: ${error.message}` : error.name
  if (typeof error === 'string') return error
  try {
    const text = JSON.stringify(error)
    return text === undefined ? String(error) : text
  } catch {
    return Object.prototype.toString.call(error)
  }
}

/**
 * Validate a draft before a provider call.
 * @param text - candidate composer text.
 * @param maxLength - UTF-16 code-unit ceiling.
 * @returns a failure result, or undefined when admissible.
 */
export function validateDraft(text, maxLength = MAX_DRAFT_LENGTH) {
  if (typeof text !== 'string') {
    return { ok: false, code: ERROR_CODES.EMPTY_INPUT, detail: 'draft must be text' }
  }
  if (text.trim().length === 0) {
    return { ok: false, code: ERROR_CODES.EMPTY_INPUT, detail: 'the draft is empty' }
  }
  if (text.length > maxLength) {
    return {
      ok: false,
      code: ERROR_CODES.TOO_LONG,
      detail: `the draft is ${text.length} characters; the limit is ${maxLength}`,
    }
  }
  return undefined
}

/**
 * Create the provider-independent enhancement service.
 *
 * Provider contract:
 *   `{ id, model, enhance(text, { signal }) => string | { text } }`
 *
 * @param options - service dependencies and limits.
 * @returns an object with `enhance(text, options)`.
 */
export function createEnhancer({ provider, maxDraftLength = MAX_DRAFT_LENGTH, timeoutMs = 120_000 } = {}) {
  if (provider === undefined || provider === null || typeof provider.enhance !== 'function') {
    throw new TypeError('createEnhancer requires a provider with enhance(text, options)')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number')
  }

  return {
    async enhance(text, { signal } = {}) {
      const invalid = validateDraft(text, maxDraftLength)
      if (invalid !== undefined) return invalid
      if (signal?.aborted === true) {
        return { ok: false, code: ERROR_CODES.ABORTED, detail: 'the rewrite was cancelled' }
      }

      const controller = new AbortController()
      const started = Date.now()
      let timer
      let onAbort
      if (signal !== undefined) {
        onAbort = () => controller.abort(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
      }
      timer = setTimeout(() => controller.abort('timeout'), timeoutMs)

      try {
        let value
        try {
          value = await provider.enhance(text, { signal: controller.signal })
        } catch (error) {
          if (controller.signal.aborted) {
            const code = signal?.aborted === true ? ERROR_CODES.ABORTED : ERROR_CODES.TIMEOUT
            return { ok: false, code, detail: code === ERROR_CODES.TIMEOUT ? `no answer within ${timeoutMs} ms` : 'the rewrite was cancelled' }
          }
          return { ok: false, code: ERROR_CODES.LLM_ERROR, detail: describeEnhancementError(error) }
        }

        if (signal?.aborted === true) {
          return { ok: false, code: ERROR_CODES.ABORTED, detail: 'the rewrite was cancelled' }
        }
        if (controller.signal.aborted) {
          return { ok: false, code: ERROR_CODES.TIMEOUT, detail: `no answer within ${timeoutMs} ms` }
        }

        const output = typeof value === 'string' ? value : value?.text
        if (typeof output !== 'string' || output.trim().length === 0) {
          return { ok: false, code: ERROR_CODES.OUTPUT_EMPTY, detail: 'the provider returned no usable text' }
        }
        return {
          ok: true,
          text: output,
          provider: typeof provider.id === 'string' ? provider.id : 'unknown',
          model: typeof provider.model === 'string' ? provider.model : undefined,
          elapsedMs: Date.now() - started,
        }
      } finally {
        clearTimeout(timer)
        if (signal !== undefined && onAbort !== undefined) signal.removeEventListener('abort', onAbort)
      }
    },
  }
}
