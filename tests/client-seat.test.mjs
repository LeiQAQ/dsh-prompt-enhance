/**
 * The seat end to end: the real built bundle, materialized and mounted.
 *
 * This is the only place the client half is exercised as a whole, and it is
 * deliberately built on the *built artifact* (`dist/client.cjs`) rather than on
 * `src/` — the module table, the inlining of the shared codec, and the
 * `require` surface are all part of the contract with the shell, and a test
 * against source would not notice a break in any of them.
 *
 * The fake React implements exactly `useState`/`useRef`/`useEffect`; the fake
 * loader answers exactly the specifiers the bundle may require. A new hook or a
 * new import therefore fails loudly instead of passing silently.
 *
 * @module dsh-prompt-enhance/tests/client-seat
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { CLASS } from '../src/client/styles.js'
import { decodeDraft } from '../src/shared/codec.js'
import { ERROR_CODES, formatErrorText } from '../src/shared/codes.js'
import { COMMAND_NAME, LOCALE_NS, MAX_DRAFT_LENGTH } from '../src/shared/protocol.js'
import {
  createFakeJsxRuntime, createFakePrimitives, createFakeReact,
  findAllTags, findTag, loadClientBundle, textOf,
} from './helpers/fakes.mjs'

const BUNDLE = readFileSync(new URL('../dist/client.cjs', import.meta.url), 'utf8')
const BUNDLE_ID = 'dsh-prompt-enhance'
const SLOT = 'conversation.input.right'
const SEAT_ID = 'prompt-enhance'
/** Room to the right of `dsh-codex-connect`'s 10/20 in the same slot. */
const SEAT_ORDER = 40

/** The primitives surface the bundle is allowed to reach for. */
const PRIMITIVES = createFakePrimitives()

/** Map the glyph component back to its name — the fake icons render as inert markers. */
const GLYPH = new Map([
  [PRIMITIVES.IconSparkle16, 'sparkle'],
  [PRIMITIVES.IconLoadingOutline16, 'loading'],
  [PRIMITIVES.IconWarningOutline16, 'warning'],
])

/**
 * Materialize the bundle without installing it.
 *
 * The React instance handed to the bundle is *the same object* the caller
 * mounts with: the component resolves its hooks through the module table, so a
 * second instance would keep a second hook ledger and the render would walk off
 * the end of it.
 *
 * @param react - the fake React to expose to the bundle.
 * @returns the plugin's exports and the React instance that owns its hooks.
 */
function materialize(react = createFakeReact()) {
  const loaded = loadClientBundle({
    source: BUNDLE,
    id: BUNDLE_ID,
    modules: {
      react,
      'react/jsx-runtime': createFakeJsxRuntime(),
      '@deepseek-ai/dsh-client-ui-primitives': PRIMITIVES,
    },
  })
  return { plugin: loaded.exports, requires: loaded.requires, react }
}

/** An `execute` that never settles on its own and rejects when the caller aborts — the RPC's real contract. */
function hangUntilAborted(seen) {
  return (sessionId, line, images, signal) => new Promise((resolve, reject) => {
    seen.signal = signal
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
}

/**
 * Materialize the bundle and mount its seat in one step.
 *
 * @param options - `{ draft, draftRev, execute, sessionId }`.
 * @returns the mounted harness: the input store, the spies, the slot
 *   registration, and the render handle.
 */
function mountSeat(options = {}) {
  const execute = options.execute ?? (async () => ({ ok: true, value: undefined }))
  const calls = { execute: [], setDraft: [], registrations: [], touched: new Set() }

  const { plugin, react } = materialize()

  /* The core context surface: present without any declaration, because cordis
   * puts it on the context itself instead of registering it as a service. */
  const core = { effect: callback => callback() }
  /* The services this plugin may reach. On a real context each one exists
   * exactly while `inject` names it. */
  const services = {
    locale: { register: (ns, dicts) => { calls.locale = { ns, dicts } } },
    slots: {
      inject: (name, callback) => { calls.injectedSlot = name; callback() },
      register: (definition, Component) => {
        calls.registrations.push({ definition, Component })
        return () => {}
      },
    },
    remote: { commands: { execute: (...args) => { calls.execute.push(args); return execute(...args) } } },
  }
  /* Resolve exactly as cordis does — `ReflectService.handler.get` throws
   * `cannot get property "x" without inject` for a property that is neither on
   * the context nor named by the declaration. A permissive mock cannot catch a
   * declaration that is one name short, and a miss like that stays invisible
   * until someone clicks. */
  const declared = new Set(plugin.inject)
  const ctx = new Proxy(core, {
    get(target, key) {
      if (typeof key !== 'string') return undefined
      calls.touched.add(key)
      if (key in target) return target[key]
      if (!declared.has(key)) throw new Error(`cannot get property "${key}" without inject`)
      return services[key]
    },
  })
  plugin.apply(ctx)

  const registration = calls.registrations[0]
  assert.notEqual(registration, undefined, 'the bundle did not register a seat')

  const store = { draft: options.draft ?? 'write me something', draftRev: options.draftRev ?? 1 }
  const props = {
    ...registration.definition.inject(options.sessionId ?? 'session-1'),
    useInput: selector => selector(store),
    inputActions: { setDraft: text => { calls.setDraft.push(text); store.draft = text; store.draftRev += 1 } },
    t: key => key,
    sessionId: options.sessionId ?? 'session-1',
  }

  const handle = react.mount(registration.Component, props)
  return {
    plugin, calls, store, handle, registration,
    /** Simulate a user edit: the store moves, then React re-renders. */
    edit(text) { store.draft = text; store.draftRev += 1; handle.setProps({ ...props }) },
    /** Let pending `await` continuations run. */
    async flush(turns = 6) {
      for (let index = 0; index < turns; index += 1) await Promise.resolve()
    },
  }
}

/** The seat's primary button, whatever phase it is in. */
const primaryButton = harness => findAllTags(harness.handle.tree, 'button')[0]

/** The revert button, present only while a revert is offered. */
const revertButton = harness => findAllTags(harness.handle.tree, 'button')[1]

/** The glyph the seat chose. */
const glyphOf = tree => GLYPH.get(findAllTags(tree, 'button')[0]?.props?.children?.type)

/** The failure banner, found by class rather than by tag (the seat root is a `span` too). */
const bannerOf = tree => findAllTags(tree, 'span').find(node => node.props.className === CLASS.error)

/** The visible diagnostic chip beside the banner, absent unless a failure named a cause. */
const diagnosticOf = tree => findAllTags(tree, 'span').find(node => node.props.className === CLASS.diagnostic)

describe('the bundle as the shell sees it', () => {
  it('registers under its package name and returns the cordis plugin shape', () => {
    const { plugin } = materialize()
    assert.equal(plugin.name, 'prompt-enhance')
    assert.deepEqual([...plugin.inject].sort(), ['locale', 'remote', 'remote.commands', 'slots'])
    assert.equal(typeof plugin.apply, 'function')
  })

  it('requires only the platform specifiers the manifest implies', () => {
    /* The bundle emits one `require` per imported binding, so the assertion is
     * over the distinct specifiers, not over the call count. */
    assert.deepEqual([...new Set(materialize().requires)].sort(), [
      '@deepseek-ai/dsh-client-ui-primitives',
      'react',
      'react/jsx-runtime',
    ])
  })

  it('contains no other module of its own beyond the inlined graph', () => {
    /* The build inlines every `src/` module into the single factory, so the
     * bundle must not ask the module table for anything of ours. */
    assert.equal(materialize().requires.some(specifier => specifier.startsWith('.')), false)
  })
})

describe('apply — the wiring', () => {
  it('registers into the composer toolbar slot, once, with a stable identity', () => {
    const harness = mountSeat()
    assert.equal(harness.calls.injectedSlot, SLOT)
    assert.equal(harness.calls.registrations.length, 1)
    const definition = harness.registration.definition
    assert.equal(definition.name, SLOT)
    assert.equal(definition.id, SEAT_ID)
    assert.equal(definition.locale, LOCALE_NS)
    assert.equal(definition.order, SEAT_ORDER)
  })

  it('takes an order that cannot tie with the seats a real profile already occupies', () => {
    /* `dsh-codex-connect` holds 10 and 20 in this very slot; a tie would make
     * the two swap places depending on registration order. */
    const harness = mountSeat()
    assert.equal([0, 10, 20].includes(harness.registration.definition.order), false)
  })

  it('registers both dictionaries under the shared namespace', () => {
    const harness = mountSeat()
    assert.equal(harness.calls.locale.ns, LOCALE_NS)
    assert.deepEqual(Object.keys(harness.calls.locale.dicts), ['zh', 'en'])
  })

  it('reaches for no service the declaration does not name', () => {
    /* `apply` installs styles, the dictionaries and the seat; `remote` is not
     * touched until a rewrite is actually started (the `inject` face reads it
     * lazily), so both states of the lifecycle are pinned. */
    const harness = mountSeat()
    assert.deepEqual([...harness.calls.touched].sort(), ['effect', 'locale', 'slots'])
  })

  it('binds one command call per session, so a result cannot be addressed to another composer (AC8)', async () => {
    const harness = mountSeat()
    const a = harness.registration.definition.inject('session-A')
    const b = harness.registration.definition.inject('session-B')
    await a.startRewrite('/enhance-prompt x', undefined)
    await b.startRewrite('/enhance-prompt y', undefined)
    assert.equal(harness.calls.execute[0][0], 'session-A')
    assert.equal(harness.calls.execute[1][0], 'session-B')
    /* Compared field by field: the argument array is built inside the bundle's
     * VM realm, so a deep comparison would trip over the foreign prototypes. */
    assert.equal(harness.calls.execute[0][1], '/enhance-prompt x')
    assert.equal(harness.calls.execute[0][2].length, 0)
    /* The service the declaration advertises, and only it, is what the call reached. */
    assert.deepEqual([...harness.calls.touched].sort(), ['effect', 'locale', 'remote', 'slots'])
  })

  it('forwards the caller signal as the fourth argument', async () => {
    const harness = mountSeat()
    const controller = new AbortController()
    const { startRewrite } = harness.registration.definition.inject('s')
    await startRewrite('/enhance-prompt x', controller.signal)
    assert.equal(harness.calls.execute[0][3], controller.signal)
  })
})

describe('the seat, idle', () => {
  it('renders one enabled button with the sparkle glyph and no revert offer', () => {
    const harness = mountSeat({ draft: 'make this better' })
    assert.equal(primaryButton(harness).props.disabled, false)
    /* The glyph is a parity requirement, not a detail: WorkBuddy's own enhance
     * button carries this sparkle, and the seat only reads as the same feature
     * if it wears the same mark. */
    assert.equal(glyphOf(harness.handle.tree), 'sparkle')
    assert.equal(harness.handle.tree.props['data-phase'], 'idle')
    assert.equal(revertButton(harness), undefined)
  })

  it('is disabled with an empty composer (AC2)', () => {
    for (const draft of ['', '   ', '\n']) {
      const harness = mountSeat({ draft })
      assert.equal(primaryButton(harness).props.disabled, true, JSON.stringify(draft))
    }
  })

  it('does nothing when clicked with nothing to send', () => {
    const harness = mountSeat({ draft: '   ' })
    primaryButton(harness).props.onClick()
    assert.equal(harness.calls.execute.length, 0)
    assert.equal(harness.handle.tree.props['data-phase'], 'idle')
  })

  it('carries an accessible name and no stale aria-busy (F9)', () => {
    const harness = mountSeat()
    assert.equal(typeof primaryButton(harness).props['aria-label'], 'string')
    assert.notEqual(primaryButton(harness).props['aria-label'], '')
    assert.equal(primaryButton(harness).props['aria-busy'], undefined)
  })
})

describe('the seat, enhancing', () => {
  it('sends the draft as a transport line and flips to busy (AC1)', async () => {
    let resolve
    const harness = mountSeat({
      draft: '把这段话写清楚点\n谢谢',
      execute: () => new Promise(res => { resolve = res }),
    })
    primaryButton(harness).props.onClick()

    assert.equal(harness.calls.execute.length, 1)
    const line = harness.calls.execute[0][1]
    assert.equal(line.startsWith(`/${COMMAND_NAME} b64:`), true)
    assert.equal(decodeDraft(line.slice(`/${COMMAND_NAME} b64:`.length)), '把这段话写清楚点\n谢谢')

    assert.equal(harness.handle.tree.props['data-phase'], 'enhancing')
    assert.equal(primaryButton(harness).props['aria-busy'], 'true')
    assert.equal(glyphOf(harness.handle.tree), 'loading')

    resolve({ ok: true, value: undefined })
    await harness.flush()
  })

  it('cancels on a second click, and the cancel is real rather than a UI reset (AC3)', async () => {
    const seen = {}
    const harness = mountSeat({ execute: hangUntilAborted(seen) })
    primaryButton(harness).props.onClick()
    assert.equal(seen.signal.aborted, false)

    primaryButton(harness).props.onClick()
    assert.equal(seen.signal.aborted, true)
    await harness.flush()
    assert.equal(harness.handle.tree.props['data-phase'], 'idle')
    assert.equal(harness.calls.setDraft.length, 0)
  })

  it('aborts the in-flight request when the seat goes away (F8: the seat dies)', async () => {
    const seen = {}
    const harness = mountSeat({ execute: hangUntilAborted(seen) })
    primaryButton(harness).props.onClick()
    harness.handle.unmount()
    assert.equal(seen.signal.aborted, true)
    await harness.flush()
    assert.equal(harness.calls.setDraft.length, 0)
  })

  it('stays silent when the host reports the abort (no error banner for a user cancel)', async () => {
    const harness = mountSeat({
      execute: async () => ({ ok: true, value: { result: { kind: 'error', text: formatErrorText(ERROR_CODES.ABORTED, 'cancelled') } } }),
    })
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.equal(harness.handle.tree.props['data-phase'], 'idle')
    assert.equal(textOf(harness.handle.tree), '')
    assert.equal(harness.calls.setDraft.length, 0)
  })
})

describe('the seat, success', () => {
  const rewrite = text => async () => ({ ok: true, value: { result: { kind: 'success', text } } })

  it('writes the rewrite into the composer and offers the original back (F3, F7)', async () => {
    const harness = mountSeat({ draft: 'weak', execute: rewrite('A strong prompt') })
    primaryButton(harness).props.onClick()
    await harness.flush()

    assert.deepEqual(harness.calls.setDraft, ['A strong prompt'])
    assert.equal(harness.handle.tree.props['data-phase'], 'idle')
    const revert = revertButton(harness)
    assert.notEqual(revert, undefined)
    assert.equal(typeof revert.props['aria-label'], 'string')
  })

  it('restores exactly the text the user had when revert is pressed (AC6)', async () => {
    const harness = mountSeat({ draft: 'weak', execute: rewrite('A strong prompt') })
    primaryButton(harness).props.onClick()
    await harness.flush()

    revertButton(harness).props.onClick()
    assert.deepEqual(harness.calls.setDraft, ['A strong prompt', 'weak'])
    assert.equal(revertButton(harness), undefined)
    assert.equal(harness.handle.tree.props['data-phase'], 'idle')
  })

  it('drops the revert affordance as soon as the user edits after the rewrite (AC6)', async () => {
    const harness = mountSeat({ draft: 'weak', execute: rewrite('A strong prompt') })
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.notEqual(revertButton(harness), undefined)

    harness.edit('A strong prompt and my own sentence')
    assert.equal(revertButton(harness), undefined)
  })

  it('can be run again after a success, and the second pair replaces the first', async () => {
    let reply = 'first'
    const harness = mountSeat({ draft: 'weak', execute: async () => ({ ok: true, value: { result: { kind: 'success', text: reply } } }) })
    primaryButton(harness).props.onClick()
    await harness.flush()

    reply = 'second'
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.deepEqual(harness.calls.setDraft, ['first', 'second'])

    revertButton(harness).props.onClick()
    assert.deepEqual(harness.calls.setDraft, ['first', 'second', 'first'])
  })
})

describe('the seat, a user edit during the flight (AC5)', () => {
  it('drops the rewrite instead of clobbering what the user typed', async () => {
    let resolve
    const harness = mountSeat({ draft: 'first draft', execute: () => new Promise(res => { resolve = res }) })
    primaryButton(harness).props.onClick()
    harness.edit('first draft, but I kept typing')
    resolve({ ok: true, value: { result: { kind: 'success', text: 'REWRITE' } } })
    await harness.flush()

    assert.equal(harness.calls.setDraft.length, 0, 'the stale rewrite must not be written')
    assert.equal(harness.handle.tree.props['data-phase'], 'idle')
    assert.equal(textOf(harness.handle.tree), '', 'and the user must not be shown a failure either')
  })

  it('drops it even when the edit left the text byte-identical (the revision is the guard)', async () => {
    let resolve
    const harness = mountSeat({ draft: 'same text', execute: () => new Promise(res => { resolve = res }) })
    primaryButton(harness).props.onClick()
    /* A program write from a superseded run advances the revision without
     * changing the text; identity is the pair, not the string. */
    harness.store.draftRev += 1
    harness.handle.setProps({ ...harness.handle.props })
    resolve({ ok: true, value: { result: { kind: 'success', text: 'REWRITE' } } })
    await harness.flush()
    assert.equal(harness.calls.setDraft.length, 0)
  })
})

describe('the seat, failure', () => {
  const failure = code => async () => ({
    ok: true,
    value: { result: { kind: 'error', text: formatErrorText(code, `${code} happened`) } },
  })

  const CODES = [
    ERROR_CODES.EMPTY_INPUT, ERROR_CODES.TOO_LONG, ERROR_CODES.BAD_ENCODING,
    ERROR_CODES.NO_MODEL, ERROR_CODES.LLM_ERROR, ERROR_CODES.TIMEOUT,
    ERROR_CODES.OUTPUT_EMPTY, ERROR_CODES.INTERNAL,
  ]

  it('shows the localised sentence, warns, and writes nothing (AC4)', async () => {
    for (const code of CODES) {
      const harness = mountSeat({ draft: 'weak', execute: failure(code) })
      primaryButton(harness).props.onClick()
      await harness.flush()

      assert.equal(harness.calls.setDraft.length, 0, `${code}: the draft must be untouched`)
      assert.equal(harness.handle.tree.props['data-phase'], 'failed', code)
      assert.equal(glyphOf(harness.handle.tree), 'warning', code)
      const banner = bannerOf(harness.handle.tree)
      assert.notEqual(banner, undefined, code)
      assert.equal(banner.props.role, 'status', code)
      assert.equal(banner.props.children, `enhance.error.${code}`, code)
      assert.equal(String(banner.props.title).includes(`${code} happened`), true, code)
    }
  })

  it('says the plugin is not loaded when the host does not know the command', async () => {
    const harness = mountSeat({ draft: 'weak', execute: async () => ({ ok: true, value: undefined }) })
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.equal(harness.handle.tree.props['data-phase'], 'failed')
    assert.equal(bannerOf(harness.handle.tree).props.children, 'enhance.error.no_command')
  })

  it('reports an RPC-level failure as a transport problem', async () => {
    const harness = mountSeat({ draft: 'weak', execute: async () => { throw new Error('socket closed') } })
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.equal(bannerOf(harness.handle.tree).props.children, 'enhance.error.transport')
    assert.equal(harness.calls.setDraft.length, 0)
  })

  it('names the cause on screen, and keeps the whole detail reachable', async () => {
    /* The 2026-09-14 regression this exists for: a host-side RPC failure whose
     * code (`gateway/lookup-not-found`) was visible only inside the banner's
     * `title`. A failure that cannot be reproduced from a screenshot cannot be
     * diagnosed, so the chip is asserted on screen and the detail on the title. */
    const detail = 'gateway/lookup-not-found: no live agent for session-1'
    const harness = mountSeat({
      draft: 'weak',
      execute: async () => ({ ok: false, error: { code: 'gateway/lookup-not-found', message: 'no live agent for session-1' } }),
    })
    primaryButton(harness).props.onClick()
    await harness.flush()
    const chip = diagnosticOf(harness.handle.tree)
    assert.notEqual(chip, undefined, 'the cause must be visible, not tooltip-only')
    assert.equal(chip.props.children, 'gateway/lookup-not-found')
    assert.equal(chip.props.title, detail)
    /* The sentence keeps its own job: it is the one the user reads. */
    assert.equal(bannerOf(harness.handle.tree).props.children, 'enhance.error.transport')
    assert.equal(bannerOf(harness.handle.tree).props.title.includes(detail), true)
  })

  it('renders no chip while the seat has nothing to diagnose', async () => {
    const harness = mountSeat({
      draft: 'weak',
      execute: async () => ({ ok: true, value: { result: { kind: 'success', text: 'stronger' } } }),
    })
    assert.equal(diagnosticOf(harness.handle.tree), undefined, 'idle seat')
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.equal(bannerOf(harness.handle.tree), undefined, 'a success shows no banner')
    assert.equal(diagnosticOf(harness.handle.tree), undefined, 'a success shows no chip')
  })

  it('treats an untagged handler error as internal and keeps the raw text as the detail', async () => {
    const harness = mountSeat({
      draft: 'weak',
      execute: async () => ({ ok: true, value: { result: { kind: 'error', text: 'TypeError: btoa is gone' } } }),
    })
    primaryButton(harness).props.onClick()
    await harness.flush()
    const banner = bannerOf(harness.handle.tree)
    assert.equal(banner.props.children, 'enhance.error.internal')
    assert.equal(banner.props.title.includes('TypeError: btoa is gone'), true)
  })

  it('a failure does not cost the user a revert pair earned by an earlier success', async () => {
    let reply = { ok: true, value: { result: { kind: 'success', text: 'IMPROVED' } } }
    const harness = mountSeat({ draft: 'weak', execute: async () => reply })
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.notEqual(revertButton(harness), undefined)

    reply = { ok: true, value: { result: { kind: 'error', text: formatErrorText(ERROR_CODES.TIMEOUT, 'slow') } } }
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.equal(harness.handle.tree.props['data-phase'], 'failed')

    const revert = revertButton(harness)
    assert.notEqual(revert, undefined)
    revert.props.onClick()
    assert.deepEqual(harness.calls.setDraft, ['IMPROVED', 'weak'])
  })

  it('retrying after a failure clears the banner on success', async () => {
    let reply = { ok: true, value: { result: { kind: 'error', text: formatErrorText(ERROR_CODES.LLM_ERROR, 'boom') } } }
    const harness = mountSeat({ draft: 'weak', execute: async () => reply })
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.equal(harness.handle.tree.props['data-phase'], 'failed')

    reply = { ok: true, value: { result: { kind: 'success', text: 'FIXED' } } }
    primaryButton(harness).props.onClick()
    await harness.flush()
    assert.equal(harness.handle.tree.props['data-phase'], 'idle')
    assert.equal(bannerOf(harness.handle.tree), undefined)
  })
})

describe('the seat, the oversize gate (AC10 boundary)', () => {
  it('refuses locally and spends no round trip', () => {
    const harness = mountSeat({ draft: `${'a'.repeat(MAX_DRAFT_LENGTH)}b` })
    primaryButton(harness).props.onClick()
    assert.equal(harness.calls.execute.length, 0, 'a draft the transport cannot carry must not be sent')
    assert.equal(harness.handle.tree.props['data-phase'], 'failed')
    assert.equal(bannerOf(harness.handle.tree).props.children, 'enhance.error.too_long')
  })

  it('sends a draft at exactly the limit', () => {
    const harness = mountSeat({ draft: 'a'.repeat(MAX_DRAFT_LENGTH), execute: () => new Promise(() => {}) })
    primaryButton(harness).props.onClick()
    assert.equal(harness.calls.execute.length, 1)
    assert.equal(harness.handle.tree.props['data-phase'], 'enhancing')
  })
})
