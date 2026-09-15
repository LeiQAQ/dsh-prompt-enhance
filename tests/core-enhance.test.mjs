import test from 'node:test'
import assert from 'node:assert/strict'
import { ERROR_CODES } from '../src/shared/codes.js'
import { createEnhancer } from '../src/core/enhance.js'

test('core enhancer calls the provider and returns provider metadata', async () => {
  const calls = []
  const service = createEnhancer({
    provider: {
      id: 'local',
      model: 'test-model',
      enhance: async (text, options) => { calls.push({ text, options }); return 'enhanced prompt' },
    },
  })

  const result = await service.enhance('original prompt')
  assert.deepEqual(result.ok, true)
  assert.equal(result.text, 'enhanced prompt')
  assert.equal(result.provider, 'local')
  assert.equal(result.model, 'test-model')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].text, 'original prompt')
  assert.equal(calls[0].options.signal.aborted, false)
})

test('core enhancer rejects empty and oversized drafts before the provider call', async () => {
  let calls = 0
  const service = createEnhancer({
    maxDraftLength: 4,
    provider: { enhance: async () => { calls += 1; return 'never' } },
  })

  assert.deepEqual(await service.enhance('   '), {
    ok: false, code: ERROR_CODES.EMPTY_INPUT, detail: 'the draft is empty',
  })
  assert.equal((await service.enhance('12345')).code, ERROR_CODES.TOO_LONG)
  assert.equal(calls, 0)
})

test('core enhancer propagates cancellation and aborts the provider signal', async () => {
  let providerSignal
  const service = createEnhancer({
    provider: {
      enhance: (_text, { signal }) => new Promise((_resolve, reject) => {
        providerSignal = signal
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    },
    timeoutMs: 1000,
  })
  const controller = new AbortController()
  const promise = service.enhance('prompt', { signal: controller.signal })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  const result = await promise
  assert.equal(result.code, ERROR_CODES.ABORTED)
  assert.equal(providerSignal.aborted, true)
})

test('core enhancer maps timeout and provider failures without producing output', async () => {
  let timedOutSignal
  const timeoutService = createEnhancer({
    provider: {
      enhance: (_text, { signal }) => new Promise((_resolve, reject) => {
        timedOutSignal = signal
        signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
      }),
    },
    timeoutMs: 5,
  })
  const timeout = await timeoutService.enhance('prompt')
  assert.equal(timeout.code, ERROR_CODES.TIMEOUT)
  assert.equal(timedOutSignal.aborted, true)

  const failed = await createEnhancer({
    provider: { enhance: async () => { throw new Error('network down') } },
  }).enhance('prompt')
  assert.equal(failed.code, ERROR_CODES.LLM_ERROR)
  assert.match(failed.detail, /network down/u)

  const empty = await createEnhancer({
    provider: { enhance: async () => '   ' },
  }).enhance('prompt')
  assert.equal(empty.code, ERROR_CODES.OUTPUT_EMPTY)
})
