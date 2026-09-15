/**
 * DeepSeek/local OpenAI-compatible provider adapter.
 *
 * The endpoint and credential are supplied by the caller. This deliberately
 * avoids embedding a URL, API key, or Codex credential in the renderer.
 *
 * @module dsh-prompt-enhance/providers/openai-compatible
 */

import { SYSTEM_PROMPT } from '../host/prompts.js'

/** Error with a stable provider-side classification. */
export class ProviderError extends Error {
  constructor(message, code = 'provider_error') {
    super(message)
    this.name = 'ProviderError'
    this.code = code
  }
}

/**
 * Create a provider for a DeepSeek or local OpenAI-compatible endpoint.
 *
 * @param options - endpoint, model, optional bearer token and fetch function.
 * @returns provider implementing the core provider contract.
 */
export function createOpenAICompatibleProvider({
  id = 'openai-compatible',
  endpoint,
  apiKey,
  model,
  systemPrompt = SYSTEM_PROMPT,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof endpoint !== 'string' || endpoint.trim().length === 0) throw new TypeError('provider endpoint is required')
  if (typeof model !== 'string' || model.trim().length === 0) throw new TypeError('provider model is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('provider requires fetch')

  return {
    id,
    model,
    async enhance(text, { signal } = {}) {
      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(typeof apiKey === 'string' && apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: text },
            ],
            stream: false,
          }),
          signal,
        })
      } catch (error) {
        if (signal?.aborted === true) throw error
        throw new ProviderError(error instanceof Error ? error.message : String(error), 'network_error')
      }

      let payload
      try {
        payload = await response.json()
      } catch (error) {
        throw new ProviderError(`invalid provider JSON: ${error instanceof Error ? error.message : String(error)}`, 'invalid_json')
      }
      if (!response.ok) {
        const message = typeof payload?.error?.message === 'string' ? payload.error.message : `HTTP ${response.status}`
        throw new ProviderError(message, 'http_error')
      }

      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new ProviderError('response has no choices[0].message.content', 'invalid_response')
      return content
    },
  }
}

/** Explicit factory for a configured DeepSeek endpoint. */
export function createDeepSeekProvider(options = {}) {
  return createOpenAICompatibleProvider({ id: 'deepseek', ...options })
}

/** Explicit factory for a local OpenAI-compatible endpoint. */
export function createLocalProvider(options = {}) {
  return createOpenAICompatibleProvider({ id: 'local', ...options })
}
