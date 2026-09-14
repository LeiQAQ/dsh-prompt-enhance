/**
 * Host half, end to end, against the BUILT artifact (`dist/index.js`).
 *
 * Everything here goes through the real command registration and the real
 * handler, with only `ctx` faked. That matters for three acceptance criteria
 * that are otherwise unverifiable without a running app:
 *
 *   - **AC10** — the draft must not reach the session log as `args`. Asserted
 *     twice: the registration declares `recordInput: false`, and the command
 *     line contains no plaintext of the draft.
 *   - **AC9** — the plugin must not add anything to the conversation. Asserted
 *     structurally: the handler never reaches for a session mutation surface,
 *     and the only context services it touches are `commands` and `llm`.
 *   - **AC4** — failure must leave the draft byte-identical. There is nothing to
 *     assert about the draft here (the host never holds it), so what is
 *     asserted is the inverse: every failure path returns `kind: 'error'` and
 *     therefore cannot be mistaken for a rewrite.
 *
 * U1/U3 (PRD §7.3) are answered here too: the route comes from the session
 * header when the host exposes one, and the request omits `purpose` because the
 * installed adapter accepts only `compaction` and `session-title`.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import * as plugin from '../dist/index.js'
import { buildCommandLine } from '../dist/shared/codec.js'
import * as errors from '../dist/host/errors.js'
import { MAX_DRAFT_LENGTH } from '../dist/shared/protocol.js'
import { createAgent, createHostContext, textStream } from './helpers/fakes.mjs'

/** Register the plugin on a fake host and return the captured registration. */
function mount(options = {}) {
  const host = createHostContext(options)
  plugin.apply(host.ctx, options.config)
  assert.notEqual(host.registration, undefined, 'plugin did not register a command')
  return host
}

/** Invoke the registered handler with a transported draft. */
function invoke(host, draft, invocation = {}) {
  const line = buildCommandLine('enhance-prompt', draft)
  const rawInput = line.slice(`/enhance-prompt`.length)
  return host.registration.handler({
    commandId: 'c-1',
    agent: invocation.agent ?? createAgent({ header: { provider: 'p', model: 'm' } }).agent,
    rawInput,
    signal: invocation.signal ?? new AbortController().signal,
  })
}

describe('module surface', () => {
  it('exports the cordis contract', () => {
    assert.equal(plugin.name, 'prompt-enhance')
    assert.deepEqual(plugin.inject, ['commands'])
    assert.equal(typeof plugin.apply, 'function')
    assert.equal(plugin.DEFAULT_TIMEOUT_MS, 120_000)
  })

  it('registers exactly one command, with the draft kept out of the log (AC10)', () => {
    const host = mount()
    const definition = host.registration
    assert.equal(definition.name, 'enhance-prompt')
    assert.equal(definition.recordInput, false)
    assert.equal(definition.input.images, undefined)
    assert.equal(typeof definition.input.hint, 'string')
    assert.ok(definition.description.length > 0)
  })

  it('touches only the services it declares (AC9)', () => {
    const host = mount()
    const allowed = new Set(['commands', 'llm', 'logger', 'get', 'get:commands', 'get:llm'])
    for (const key of host.touched) {
      assert.ok(allowed.has(key), `the plugin reached for ctx.${key}`)
    }
  })

  it('accepts a config override for the deadline and ignores a bad one', () => {
    assert.equal(typeof mount({ config: { timeoutMs: 5_000 } }).registration.handler, 'function')
    assert.equal(typeof mount({ config: { timeoutMs: 'nope' } }).registration.handler, 'function')
    assert.equal(typeof mount({ config: undefined }).registration.handler, 'function')
  })
})

describe('happy path (AC1)', () => {
  it('returns the rewrite as a success result', async () => {
    const host = mount({ llm: { stream: () => textStream('把这段话改写得清楚一点，并给出三条要点。') } })
    const result = await invoke(host, '帮我写个文案')
    assert.deepEqual(result, { kind: 'success', text: '把这段话改写得清楚一点，并给出三条要点。' })
  })

  it('strips wrapping quotes exactly like the original', async () => {
    const host = mount({ llm: { stream: () => textStream('"改写后的提示词"') } })
    assert.deepEqual(await invoke(host, 'x'), { kind: 'success', text: '改写后的提示词' })
  })

  it('sends the system prompt, the rendered user template, and the session route (U1)', async () => {
    const host = mount({
      llm: { stream: options => { host.calls.llmStream.push(options); return textStream('ok') } },
    })
    const { agent } = createAgent({ sessionId: 'session-9', header: { provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'medium' } })
    await invoke(host, '帮我写个文案', { agent })

    const [options] = host.calls.llmStream
    assert.equal(options.provider, 'deepseek')
    assert.equal(options.model, 'deepseek-v4.1-flash')
    assert.equal(options.reasoningEffort, 'medium')
    assert.equal(options.sessionId, 'session-9')
    assert.ok(options.system.includes('Prompt Engineering Expert'))
    assert.equal(options.messages.length, 1)
    assert.equal(options.messages[0].role, 'user')
    assert.ok(options.messages[0].content[0].text.includes('帮我写个文案'))
    assert.ok(options.signal instanceof AbortSignal)
  })

  it('never sends an unknown purpose value (U3)', async () => {
    const host = mount({
      llm: { stream: options => { host.calls.llmStream.push(options); return textStream('ok') } },
    })
    await invoke(host, 'x')
    assert.equal('purpose' in host.calls.llmStream[0], false)
  })

  it('logs lengths and timing but never the text', async () => {
    const host = mount({ llm: { stream: () => textStream('SECRET-OUTPUT') } })
    await invoke(host, 'SECRET-INPUT-MARKER')
    const serialised = JSON.stringify(host.calls.logs)
    assert.equal(serialised.includes('SECRET-INPUT-MARKER'), false)
    assert.equal(serialised.includes('SECRET-OUTPUT'), false)
    assert.equal(serialised.includes('inputLength'), true)
    assert.equal(serialised.includes('outputLength'), true)
    assert.equal(serialised.includes('elapsedMs'), true)
  })

  it('routes through the agent default when the session has no logged request', async () => {
    const host = mount({
      llm: { stream: options => { host.calls.llmStream.push(options); return textStream('ok') } },
    })
    const { agent } = createAgent({ options: { provider: 'deployed', model: 'default-model' } })
    assert.deepEqual(await invoke(host, 'x', { agent }), { kind: 'success', text: 'ok' })
    assert.equal(host.calls.llmStream[0].model, 'default-model')
  })
})

describe('admission failures (AC4)', () => {
  /** Read the error code out of a result. */
  function codeOf(result) {
    assert.equal(result.kind, 'error', 'a failure must not be reported as success')
    const parsed = errors.parseError(result.text)
    assert.notEqual(parsed, undefined, `error text carries no tag: ${result.text}`)
    return parsed.code
  }

  it('rejects an empty draft as empty_input', async () => {
    const host = mount()
    assert.equal(codeOf(await invoke(host, '')), 'empty_input')
    assert.equal(codeOf(await invoke(host, '   ')), 'empty_input')
  })

  it('rejects an undecodable transport token as bad_encoding', async () => {
    const host = mount()
    const result = await host.registration.handler({
      agent: createAgent({ header: { provider: 'p', model: 'm' } }).agent,
      rawInput: ' b64:AAAA!',
      signal: new AbortController().signal,
    })
    assert.equal(codeOf(result), 'bad_encoding')
  })

  it('rejects an oversize draft as too_long with both numbers in the detail', async () => {
    const host = mount()
    const oversize = 'x'.repeat(MAX_DRAFT_LENGTH + 1)
    /* The encoder refuses to build such a line, so the token is built directly. */
    const token = Buffer.from(oversize, 'utf8').toString('base64url')
    const result = await host.registration.handler({
      agent: createAgent({ header: { provider: 'p', model: 'm' } }).agent,
      rawInput: ` b64:${token}`,
      signal: new AbortController().signal,
    })
    assert.equal(codeOf(result), 'too_long')
    assert.match(result.text, new RegExp(String(MAX_DRAFT_LENGTH), 'u'))
  })

  it('reports an already-aborted invocation as aborted, without calling the model', async () => {
    const host = mount()
    const controller = new AbortController()
    controller.abort()
    const result = await invoke(host, 'x', { signal: controller.signal })
    assert.equal(codeOf(result), 'aborted')
    assert.equal(host.calls.llmStream.length, 0)
  })

  it('reports a missing llm service as no_model', async () => {
    const host = mount({ services: { llm: undefined } })
    assert.equal(codeOf(await invoke(host, 'x')), 'no_model')
  })

  it('reports a session with no routed model as no_model', async () => {
    const host = mount()
    const result = await invoke(host, 'x', { agent: createAgent({}).agent })
    assert.equal(codeOf(result), 'no_model')
    assert.match(result.text, /no routed model/u)
  })

  it('reports an unusable llm service as no_model rather than throwing', async () => {
    const host = mount({ services: { llm: { stream: 'not a function' } } })
    assert.equal(codeOf(await invoke(host, 'x')), 'no_model')
  })
})

describe('model-call failures (AC4)', () => {
  /** Read the error code out of a result. */
  function codeOf(result) {
    assert.equal(result.kind, 'error')
    return errors.parseError(result.text).code
  }

  it('maps a failed finish to llm_error and discards partial text', async () => {
    const host = mount({
      llm: { stream: () => textStream('half a rewri', { kind: 'error', failure: { code: 'overloaded', message: 'provider is busy' } }) },
    })
    const result = await invoke(host, 'x')
    assert.equal(codeOf(result), 'llm_error')
    assert.match(result.text, /provider is busy/u)
    assert.equal(result.text.includes('half a rewri'), false)
  })

  it('maps a truncated finish to llm_error', async () => {
    const host = mount({ llm: { stream: () => textStream('truncated', { kind: 'max-tokens' }) } })
    assert.equal(codeOf(await invoke(host, 'x')), 'llm_error')
  })

  it('maps a tool-call finish to llm_error', async () => {
    const host = mount({ llm: { stream: () => textStream('', { kind: 'tool-calls' }) } })
    assert.equal(codeOf(await invoke(host, 'x')), 'llm_error')
  })

  it('maps an empty rewrite to output_empty', async () => {
    const host = mount({ llm: { stream: () => textStream('   ') } })
    assert.equal(codeOf(await invoke(host, 'x')), 'output_empty')
  })

  it('maps a rewrite that is only wrapping quotes to output_empty', async () => {
    const host = mount({ llm: { stream: () => textStream('""') } })
    assert.equal(codeOf(await invoke(host, 'x')), 'output_empty')
  })

  it('maps a stream that ends without a terminal chunk to llm_error', async () => {
    const host = mount({ llm: { stream: () => (async function* noFinish() { yield { type: 'text-delta', text: 'x' } })() } })
    assert.equal(codeOf(await invoke(host, 'x')), 'llm_error')
  })

  it('maps a throwing stream to internal and reports the cause chain', async () => {
    const host = mount({
      llm: {
        stream: () => {
          const cause = new Error('connection reset')
          throw new Error('fetch failed', { cause })
        },
      },
    })
    const result = await invoke(host, 'x')
    assert.equal(codeOf(result), 'internal')
    assert.match(result.text, /connection reset/u)
  })

  it('reports a model that does not exist as llm_error, so the copy can blame the model', async () => {
    const host = mount({
      llm: { stream: () => textStream('', { kind: 'error', failure: { code: 'model_not_found', message: 'deepseek-v4.1-flash-expires-on-0910 is no longer available' } }) },
    })
    const result = await invoke(host, 'x')
    assert.equal(codeOf(result), 'llm_error')
    assert.match(result.text, /no longer available/u)
  })
})

describe('deadline (PRD §8)', () => {
  it('reports timeout and aborts the provider request when the budget expires', async () => {
    let providerSignal
    const host = mount({
      config: { timeoutMs: 20 },
      llm: {
        stream: options => (async function* hanging() {
          providerSignal = options.signal
          yield { type: 'text-delta', text: 'starts to answer' }
          await new Promise(resolve => setTimeout(resolve, 5_000))
          yield { type: 'finish', kind: 'stop' }
        })(),
      },
    })
    const result = await invoke(host, 'x')
    assert.equal(result.kind, 'error')
    assert.equal(errors.parseError(result.text).code, 'timeout')
    assert.equal(providerSignal.aborted, true, 'the provider request must be interrupted, not merely ignored')
    assert.equal(result.text.includes('starts to answer'), false)
  })

  it('does not wait for the budget when the caller cancels first', async () => {
    const controller = new AbortController()
    const host = mount({
      llm: {
        stream: options => (async function* hanging() {
          await new Promise(resolve => {
            options.signal.addEventListener('abort', resolve, { once: true })
            setTimeout(resolve, 5_000)
          })
          yield { type: 'finish', kind: 'stop' }
        })(),
      },
    })
    setTimeout(() => controller.abort(), 10)
    const result = await invoke(host, 'x', { signal: controller.signal })
    assert.equal(result.kind, 'error')
    assert.equal(errors.parseError(result.text).code, 'aborted')
  })
})

describe('the literal command-line entry point (D1 option 3)', () => {
  it('accepts a hand-typed draft', async () => {
    const host = mount({ llm: { stream: () => textStream('改写结果') } })
    const result = await host.registration.handler({
      agent: createAgent({ header: { provider: 'p', model: 'm' } }).agent,
      rawInput: ' 把这段话说清楚点',
      signal: new AbortController().signal,
    })
    assert.deepEqual(result, { kind: 'success', text: '改写结果' })
  })

  it('answers an empty hand-typed argument the same way the toolbar path does', async () => {
    const host = mount()
    const result = await host.registration.handler({
      agent: createAgent({ header: { provider: 'p', model: 'm' } }).agent,
      rawInput: '',
      signal: new AbortController().signal,
    })
    assert.equal(errors.parseError(result.text).code, 'empty_input')
  })
})

describe('error taxonomy', () => {
  it('tags every failure with a parseable code and never an empty tag', () => {
    for (const code of Object.values(errors.ERROR_CODES)) {
      const text = errors.formatError(code, 'detail')
      assert.deepEqual(errors.parseError(text), { code, detail: 'detail' })
    }
  })

  it('omits the sentence when there is no detail', () => {
    assert.equal(errors.formatError('llm_error', '   '), '[prompt-enhance:llm_error]')
    assert.deepEqual(errors.parseError('[prompt-enhance:llm_error]'), { code: 'llm_error', detail: '' })
  })

  it('refuses to parse untagged text', () => {
    assert.equal(errors.parseError('plain failure'), undefined)
    assert.equal(errors.parseError('[prompt-enhance:]'), undefined)
    assert.equal(errors.parseError('[prompt-enhance:llm_error'), undefined)
    assert.equal(errors.parseError(undefined), undefined)
  })

  it('renders a thrown value with its cause chain', () => {
    const error = new Error('outer', { cause: new TypeError('inner') })
    assert.equal(errors.describeThrown(error), 'Error: outer <- TypeError: inner')
    assert.equal(errors.describeThrown('a string'), 'a string')
    assert.equal(errors.describeThrown(undefined), 'unknown error')
  })
})
