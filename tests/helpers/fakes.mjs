/**
 * Test doubles for the two seams the plugin actually has.
 *
 * There is no browser and no dsh runtime in CI, so the two halves are exercised
 * through the narrowest possible substitutes:
 *
 *   - **host**: a fake cordis context that records every property read and
 *     every service call, so "the plugin never touches anything but commands,
 *     llm and the logger" is an assertion rather than a claim (this is what
 *     makes AC9/AC10 checkable offline);
 *   - **client**: a fake module loader plus a minimal React, so the real
 *     `dist/client.cjs` is materialized and its component is shallow-rendered.
 *     The React substitute implements exactly the three hooks the component
 *     uses, and nothing else — a hook the component starts using that this
 *     harness cannot honour will fail loudly rather than pass silently.
 *
 * @module dsh-prompt-enhance/tests/fakes
 */

import vm from 'node:vm'

/* ------------------------------------------------------------------ *
 * host side
 * ------------------------------------------------------------------ */

/**
 * Build a fake host context.
 * @param options - `{ llm, services, logger }`.
 * @returns `{ ctx, registration, touched, calls }`.
 */
export function createHostContext(options = {}) {
  const touched = new Set()
  const calls = { llmStream: [], logs: [] }
  const state = { registration: undefined }

  const commands = {
    register(definition) {
      if (state.registration !== undefined) throw new Error('fake host: command registered twice')
      state.registration = definition
      return () => {}
    },
  }

  const llm = options.llm === undefined
    ? { stream: (streamOptions) => { calls.llmStream.push(streamOptions); return emptyStream() } }
    : options.llm

  const services = { commands, llm, ...(options.services ?? {}) }

  const logger = {
    info: (...args) => { calls.logs.push(args) },
    warn: (...args) => { calls.logs.push(args) },
  }

  const ctx = new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      touched.add(key)
      if (key === 'logger') return options.logger === undefined ? logger : options.logger
      if (key === 'get') return name => { touched.add(`get:${name}`); return services[name] }
      return services[key]
    },
  })

  return { ctx, touched, calls, get registration() { return state.registration } }
}

/** A stream that ends cleanly with no text. */
export function emptyStream() {
  return (async function* stream() {
    yield { type: 'finish', kind: 'stop' }
  })()
}

/**
 * A stream that emits text deltas then one terminal chunk.
 * @param text - the text to emit (as a single delta).
 * @param finish - the terminal chunk kind and optional failure.
 * @returns an async iterable of chunks.
 */
export function textStream(text, finish = { kind: 'stop' }) {
  return (async function* stream() {
    if (text.length > 0) yield { type: 'text-delta', text }
    yield { type: 'finish', ...finish }
  })()
}

/**
 * A fake agent for one session.
 * @param options - `{ sessionId, header, options, requestHeaderThrows }`.
 * @returns the agent plus a spy recording whether `session.append` was reached.
 */
export function createAgent(options = {}) {
  const appended = []
  const session = {
    id: options.sessionId ?? 'session-1',
    /** Every dsh session mutation surface the plugin must never touch. */
    append: (...args) => { appended.push(args) },
    requestHeader: () => {
      if (options.requestHeaderThrows === true) throw new Error('unreadable log')
      if (options.header === undefined) return undefined
      return { config: options.header }
    },
  }
  if (options.hasRequestHeader === false) delete session.requestHeader
  const agent = { session, options: options.options }
  return { agent, appended }
}

/* ------------------------------------------------------------------ *
 * client side
 * ------------------------------------------------------------------ */

/**
 * A minimal React: `useState`, `useRef`, `useEffect` and nothing else.
 * @returns the fake react module.
 */
export function createFakeReact() {
  const runtime = {
    /** Hook slots, stable across renders of one mounted component. */
    slots: [],
    index: 0,
    /** Effects queued during the current render. */
    pendingEffects: [],
    /** Effect cleanups, keyed by hook index. */
    cleanups: new Map(),
    /** The render function of the mounted component; set by `mount`. */
    render: () => {},
  }

  function useState(initial) {
    const index = runtime.index
    runtime.index += 1
    if (runtime.slots.length <= index) {
      runtime.slots.push({ kind: 'state', value: typeof initial === 'function' ? initial() : initial })
    }
    const slot = runtime.slots[index]
    if (slot.kind !== 'state') throw new Error(`fake react: hook ${index} changed kind`)
    return [slot.value, (next) => {
      slot.value = typeof next === 'function' ? next(slot.value) : next
      runtime.render()
    }]
  }

  function useRef(initial) {
    const index = runtime.index
    runtime.index += 1
    if (runtime.slots.length <= index) runtime.slots.push({ kind: 'ref', current: initial })
    const slot = runtime.slots[index]
    if (slot.kind !== 'ref') throw new Error(`fake react: hook ${index} changed kind`)
    return slot
  }

  function useEffect(effect, deps) {
    const index = runtime.index
    runtime.index += 1
    if (runtime.slots.length <= index) {
      runtime.slots.push({ kind: 'effect', deps })
      /* Effects run once after the first render; this harness has no
       * dependency-change semantics because the plugin has no such effect. */
      runtime.pendingEffects.push({ index, effect })
      return
    }
    const slot = runtime.slots[index]
    if (slot.kind !== 'effect') throw new Error(`fake react: hook ${index} changed kind`)
  }

  runtime.useState = useState
  runtime.useRef = useRef
  runtime.useEffect = useEffect

  /**
   * Mount one component and return a handle onto its renders.
   * @param component - the component function.
   * @param props - the initial props.
   * @returns the mounted handle.
   */
  runtime.mount = (component, props) => {
    let current = props
    let tree
    const draw = () => {
      runtime.index = 0
      tree = component(current)
      while (runtime.pendingEffects.length > 0) {
        const { index, effect } = runtime.pendingEffects.shift()
        const cleanup = effect()
        if (typeof cleanup === 'function') runtime.cleanups.set(index, cleanup)
      }
    }
    runtime.render = draw
    draw()
    return {
      get tree() { return tree },
      get props() { return current },
      setProps(next) { current = next; draw() },
      unmount() {
        for (const cleanup of runtime.cleanups.values()) cleanup()
        runtime.cleanups.clear()
      },
    }
  }

  return runtime
}

/**
 * The fake `react/jsx-runtime`.
 * @returns `{ jsx, jsxs }`.
 */
export function createFakeJsxRuntime() {
  const jsx = (type, props, key) => ({
    type,
    props: key === undefined ? { ...props } : { ...props, key },
    $$element: true,
  })
  return { jsx, jsxs: jsx }
}

/** Walk an element tree, yielding every node. */
export function* walk(node) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child)
    return
  }
  if (node.$$element === true) {
    yield node
    yield* walk(node.props?.children)
  }
}

/**
 * Find the first element produced by a given intrinsic tag.
 * @param tree - the root node.
 * @param tag - the intrinsic tag (`'button'`, `'span'`, …).
 * @returns the element, or `undefined`.
 */
export function findTag(tree, tag) {
  for (const node of walk(tree)) {
    if (node.type === tag) return node
  }
  return undefined
}

/**
 * Find every element produced by a given intrinsic tag.
 * @param tree - the root node.
 * @param tag - the intrinsic tag.
 * @returns the elements, in document order.
 */
export function findAllTags(tree, tag) {
  const found = []
  for (const node of walk(tree)) {
    if (node.type === tag) found.push(node)
  }
  return found
}

/** All text content of a tree, concatenated. */
export function textOf(tree) {
  let text = ''
  for (const node of walk(tree)) {
    const children = node.props?.children
    if (typeof children === 'string') text += children
  }
  return text
}

/**
 * The primitives the client bundle requires. Icons render as inert markers so a
 * shallow render can assert which glyph a state chose without any real SVG.
 *
 * The surface is deliberately exact: a glyph the bundle stops using is dropped
 * here rather than kept around, so a stale import fails as `undefined is not a
 * function` instead of silently rendering nothing.
 *
 * @returns the fake module.
 */
export function createFakePrimitives() {
  const icon = name => props => ({ $$element: true, type: `icon:${name}`, props: { ...props } })
  return {
    IconLoadingOutline16: icon('loading'),
    IconRefreshOutline14: icon('refresh'),
    IconSparkle16: icon('sparkle'),
    IconWarningOutline16: icon('warning'),
    Tooltip: props => props.children,
  }
}

/**
 * Load `dist/client.cjs` in an isolated VM and materialize its factory.
 *
 * The bundle registers itself on `window.__ModuleLoader__.load`; this harness
 * captures that registration and calls the factory with a `require` backed by
 * the supplied module table — the same two-step contract the real browser module
 * table implements (register at script execution, materialize on first import).
 *
 * @param options - `{ source, modules, document }`.
 * @returns `{ id, exports, requires, documents }`.
 */
export function loadClientBundle(options) {
  const requires = []
  const registry = new Map()
  const appended = []
  const fakeDocument = options.document === undefined
    ? { head: { appendChild: child => appended.push(child) }, querySelector: () => (appended.length > 0 ? appended[0] : null), createElement: tag => ({ tag, dataset: {}, textContent: '' }) }
    : options.document

  const window = {
    __ModuleLoader__: {
      load(record) {
        registry.set(record.id, record)
      },
    },
  }
  const sandbox = {
    window,
    document: fakeDocument,
    console,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    AbortController,
    Symbol,
    Object,
  }
  const context = vm.createContext(sandbox)
  new vm.Script(options.source, { filename: 'dist/client.cjs' }).runInContext(context)

  const record = registry.get(options.id)
  if (record === undefined) throw new Error(`fake loader: bundle did not register "${options.id}"`)

  const require = specifier => {
    requires.push(specifier)
    const module = options.modules[specifier]
    if (module === undefined) throw new Error(`fake loader: no module registered for "${specifier}"`)
    return module
  }
  return { id: record.id, exports: record.factory(require), requires, appended }
}
