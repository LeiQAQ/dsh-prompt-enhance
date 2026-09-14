/**
 * Probe the *real* client-side Remote contract for `commands/execute`.
 *
 * Why this exists
 * ---------------
 * `ctx.remote.commands.execute(...)` has three failure layers that all reach the
 * caller as the same shape, and the plugin can only report one sentence for all
 * of them. The 2026-09-14 incident ("和后台通信失败") could not be localised from
 * the running app: no CDP port, no renderer console on disk, no host log.
 *
 * What this does
 * --------------
 * It loads the **actual** client bundles shipped by the installed dsh build —
 * `@deepseek-ai/dsh-api-gateway/lib/client.js` (the `remote` service) and
 * `@deepseek-ai/dsh-api-remotes/lib/client.js` (the descriptor contributions) —
 * into a real cordis root with a stub `connection`, then invokes
 * `commands/execute` with the exact argument list the plugin uses and with the
 * official 3-argument list for comparison.
 *
 * The `connection` stub never opens a socket: it records the RPC call and
 * answers with a canned `{ ok: true, value: undefined }`. That isolates the
 * **client-side argument/dispatch contract** (arity, scope projection, identity
 * lookup, serialization) from the host entirely.
 *
 * Usage
 * -----
 *   node scripts/probe-remote-contract.mjs [--dsh <app.asar.unpacked dir>]
 *
 * Exit 0 when the plugin's call shape survives the client contract; 1 otherwise.
 *
 * @module dsh-prompt-enhance/scripts/probe-remote-contract
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/* Locate the live dsh install. The desktop app is the one that matters here
 * because that is where the failure was observed; DSH_BIN/DSH_HOME overrides
 * keep this usable against a source checkout. */
const CANDIDATES = [
  process.env.DSH_CHECKOUT,
  'D:/Ruanjian/DSHDesktop/resources/app.asar.unpacked',
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Programs/DSH Desktop/resources/app.asar.unpacked')
    : undefined,
].filter(candidate => typeof candidate === 'string')

function locateCheckout(argv) {
  const flag = argv.indexOf('--dsh')
  if (flag >= 0 && argv[flag + 1] !== undefined) return resolve(argv[flag + 1])
  for (const candidate of CANDIDATES) if (existsSync(join(candidate, 'node_modules/@deepseek-ai/cordis'))) return candidate
  return undefined
}

const argv = process.argv.slice(2)
const checkout = locateCheckout(argv)
if (checkout === undefined) {
  console.error('probe: no dsh install found. Pass --dsh <app.asar.unpacked dir>.')
  process.exit(2)
}

const MODULES = join(checkout, 'node_modules')
const PACKAGES = join(MODULES, '@deepseek-ai')
const require_ = createRequire(join(MODULES, 'noop.cjs'))

const result = []
const record = (level, message) => {
  result.push(`${level.padEnd(4)} ${message}`)
  console.log(`${level === 'FAIL' ? '✗' : level === 'WARN' ? '!' : '✓'} ${message}`)
}

/* ------------------------------------------------------------------ *
 * 1. Load the shipped client bundles through their own module loader. *
 * ------------------------------------------------------------------ */

/** Captured `{ id → factory }` registrations from `window.__ModuleLoader__`. */
const factories = new Map()

const pretendGlobals = {
  window: {
    __ModuleLoader__: {
      load: spec => {
        if (typeof spec?.id !== 'string' || typeof spec?.factory !== 'function') {
          throw new TypeError('probe: __ModuleLoader__.load received an unexpected spec')
        }
        factories.set(spec.id, spec.factory)
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1' },
  },
  navigator: { userAgent: 'node-probe', onLine: true, language: 'zh-CN' },
  document: { addEventListener: () => {}, removeEventListener: () => {}, createElement: () => ({ style: {} }) },
  location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1' },
  addEventListener: () => {},
  removeEventListener: () => {},
  fetch: () => Promise.reject(new Error('probe: no network')),
  WebSocket: class {},
}

/** Evaluate one `__ModuleLoader__.load` bundle and return its exports. */
function loadBundle(packageName, relative = 'lib/client.js') {
  const file = join(PACKAGES, packageName, relative)
  if (!existsSync(file)) throw new Error(`probe: missing ${file}`)
  const source = readFileSync(file, 'utf8')
  const names = Object.keys(pretendGlobals)
  /* The bundle is a classic script that only touches `window`; give it the
   * stubbed globals by parameter so nothing leaks onto the real globalThis. */
  const run = new Function(...names, `${source}\n//# sourceURL=${packageName}/${relative}`)
  run(...names.map(name => pretendGlobals[name]))
  const factory = factories.get(`@deepseek-ai/${packageName}`)
  if (factory === undefined) throw new Error(`probe: ${packageName} registered no module`)
  return factory(specifier => require_(specifier))
}

const remotes = loadBundle('dsh-api-remotes')
const gateway = loadBundle('dsh-api-gateway')

/* ------------------------------------------------------------------ *
 * 2. Boot a real cordis root with the two stub services.             *
 * ------------------------------------------------------------------ */

const cordis = require_('@deepseek-ai/cordis')
const { Context } = cordis
if (typeof Context !== 'function') throw new Error('probe: cordis exposed no Context')

const typert = loadBundle('dsh-typert-registry')

/** Every RPC the gateway attempted, in order. */
const calls = []

const root = new Context()

/* Surface why a fiber refuses to settle: cordis reports plugin failures on its
 * internal event channel rather than by rejecting `ctx.plugin`. */
const internal = []
for (const event of ['internal/error', 'internal/warning']) {
  root.on(event, (...args) => {
    const detail = args
      .map(arg => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .filter(text => text !== undefined && text !== '{}')
      .join(' | ')
    internal.push(`${event}: ${detail}`)
  })
}

root.provide('connection', {
  /* `ClientRemoteService` constructs a generation-scoped event bridge over the
   * connection, so the stub must carry the same four members a real one does —
   * without them the gateway fiber dies at construction and the probe would
   * report "no `remote` service" instead of testing the contract. */
  isLoopback: true,
  generation: {
    getSnapshot: () => undefined,
    subscribe: () => () => {},
  },
  registerGenerationSource: () => () => {},
  rpc: {
    call: async (channel, endpoint, payload /* , signal */) => {
      calls.push({ channel, endpoint, payload })
      /* `execute` on a host that knows the command resolves to the command
       * outcome object; `undefined` is the documented "not a command" answer. */
      return { ok: true, value: { commandId: 'probe-0', result: { kind: 'success', text: 'probe' } } }
    },
    open: async () => {
      throw new Error('probe: no streaming endpoint is exercised')
    },
  },
  start: () => () => {},
})

/** Apply one bundle and surface why its fiber refused to settle. */
async function mount(name, plugin) {
  try {
    await root.plugin({ name, apply: ctx => { ctx.plugin(plugin) } })
    return undefined
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
}

const typertError = await mount('probe-typert', typert)
record(typertError === undefined ? 'PASS' : 'FAIL', `typert bundle mounted${typertError === undefined ? '' : ` — ${typertError}`}`)
record(root.get('typert') === undefined ? 'FAIL' : 'PASS', 'typert service registered')

const gatewayError = await mount('probe-gateway', gateway)
record(gatewayError === undefined ? 'PASS' : 'FAIL', `gateway bundle mounted${gatewayError === undefined ? '' : ` — ${gatewayError}`}`)

const remotesError = await mount('probe-remotes', remotes)
record(remotesError === undefined ? 'PASS' : 'FAIL', `remotes bundle mounted${remotesError === undefined ? '' : ` — ${remotesError}`}`)

await new Promise(resolve => setTimeout(resolve, 100))

if (internal.length > 0) {
  for (const line of internal) record('WARN', `cordis ${line}`)
}

if (root.remote === undefined) {
  record('FAIL', 'the gateway client mounted no `remote` service')
  console.log(result.join('\n'))
  process.exit(1)
}
record('PASS', `remote service mounted with namespaces: ${Object.keys(root.remote).filter(k => !k.startsWith('$')).length}`)

const commands = root.remote.commands
if (commands === undefined || typeof commands.execute !== 'function') {
  record('FAIL', 'remote.commands.execute is not a function on this build')
  console.log(result.join('\n'))
  process.exit(1)
}
record('PASS', 'remote.commands.execute is callable')

/* ------------------------------------------------------------------ *
 * 3. Exercise both argument lists and compare.                       *
 * ------------------------------------------------------------------ */

const SESSION = 'session-00000000-0000-4000-8000-000000000000'
const LINE = '/enhance-prompt b64:cHJvYmU='
const controller = new AbortController()

async function attempt(label, args) {
  const before = calls.length
  try {
    const value = await commands.execute(...args)
    const call = calls[before]
    return {
      label,
      ok: true,
      value,
      rpc: call === undefined ? undefined : { channel: call.channel, endpoint: call.endpoint, args: call.payload?.args },
    }
  } catch (error) {
    return { label, ok: false, thrown: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

const pluginCall = await attempt('plugin 4-arg (sessionId, line, [], signal)', [SESSION, LINE, [], controller.signal])
const officialCall = await attempt('official 3-arg (sessionId, line, [])', [SESSION, LINE, []])

for (const outcome of [pluginCall, officialCall]) {
  if (outcome.ok) {
    record('PASS', `${outcome.label} — resolved; rpc=${JSON.stringify(outcome.rpc)}`)
  } else {
    record('FAIL', `${outcome.label} — threw ${outcome.thrown}`)
  }
}

/* The decisive comparison: both forms must produce the same wire arguments,
 * because the host only ever sees `{ agentId, line, images }`. */
const sameArgs =
  pluginCall.ok && officialCall.ok && JSON.stringify(pluginCall.rpc?.args) === JSON.stringify(officialCall.rpc?.args)

if (sameArgs) record('PASS', 'both arities put identical arguments on the wire')
else if (pluginCall.ok && officialCall.ok) record('FAIL', 'the two arities produced different wire arguments')
else record('WARN', 'arity comparison incomplete — at least one form was rejected')

/* ------------------------------------------------------------------ *
 * 4. Report.                                                         *
 * ------------------------------------------------------------------ */

const failures = result.filter(line => line.startsWith('FAIL'))
console.log('')
console.log(`probe: ${result.length} checks, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
