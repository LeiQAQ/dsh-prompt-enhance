#!/usr/bin/env node
/**
 * Install-time verification: does this directory actually load in a dsh profile?
 *
 * The unit suites prove the plugin behaves; they cannot prove the *profile* it
 * is linked into will pick it up. The failure modes that live only at install
 * time are the ones this script exists for:
 *
 *   - a `link:` dependency that was added to `package.json` but never
 *     materialized in the profile's `node_modules`;
 *   - a `dsh.client.inject` name that is not a client plugin entry at all, so
 *     the arrival edge the browser module graph would draw from it is silently
 *     dropped (harmless at runtime — the gate is the `inject` list the client
 *     module itself exports, whose entries are service names — but it is the
 *     reliable symptom of a package built against a different platform
 *     version);
 *   - a `cordis.patch.yml` whose `insert[].name` does not resolve to the
 *     package the profile names;
 *   - a slot `id` or `order` that ties with an already-installed occupant of
 *     the same seat, which makes the two swap places across boots;
 *   - a command name another installed plugin already registered.
 *
 * Usage: node scripts/verify-install.mjs [--profile <dir>]
 *
 * @module dsh-prompt-enhance/scripts/verify-install
 */

import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COMMAND_NAME } from '../src/shared/protocol.js'
import { createFakeJsxRuntime, createFakePrimitives, createFakeReact, loadClientBundle } from '../tests/helpers/fakes.mjs'

const PACKAGE_NAME = 'dsh-prompt-enhance'
const SLOT = 'conversation.input.right'
const DEFAULT_PROFILE = join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'profiles', 'web')
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

let failures = 0
const findings = []
const note = (line) => { findings.push(line) }
const ok = (label, detail) => note(`  ok   ${label}${detail === undefined ? '' : ` — ${detail}`}`)
const bad = (label, detail) => { note(`  FAIL ${label} — ${detail}`); failures += 1 }

/* ---------------------------------------------------------------- *
 * 0. arguments
 * ---------------------------------------------------------------- */

const profileArg = process.argv.indexOf('--profile')
const profileDir = resolve(profileArg === -1 ? DEFAULT_PROFILE : process.argv[profileArg + 1])

/* ---------------------------------------------------------------- *
 * 1. the profile names the package, and the link is materialized
 * ---------------------------------------------------------------- */

const profileManifestPath = join(profileDir, 'package.json')
if (!existsSync(profileManifestPath)) {
  console.error(`verify-install: no profile at ${profileDir}`)
  process.exit(2)
}
const profile = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
note(`profile: ${profileDir}`)

const declared = profile.dependencies?.[PACKAGE_NAME]
if (typeof declared === 'string') ok('dependency declared', declared)
else bad('dependency declared', `missing from dependencies of ${profileManifestPath}`)

const bundles = profile.dsh?.profile?.bundles ?? []
if (bundles.includes(PACKAGE_NAME)) ok('listed in dsh.profile.bundles')
else bad('listed in dsh.profile.bundles', 'the loader never creates an entry without it')

const profileRequire = createRequire(profileManifestPath)
let installedManifestPath
try {
  installedManifestPath = profileRequire.resolve(`${PACKAGE_NAME}/package.json`)
  ok('resolves from the profile', installedManifestPath)
} catch (error) {
  bad('resolves from the profile', error.message)
}

/* ---------------------------------------------------------------- *
 * 2. the two bundles exist and the manifest points at them
 * ---------------------------------------------------------------- */

let manifest
let hostEntry
let clientEntry
if (installedManifestPath !== undefined) {
  manifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'))
  const packageDir = dirname(installedManifestPath)
  const hostRel = manifest.exports?.['.']
  const clientRel = manifest.exports?.['./client']
  hostEntry = typeof hostRel === 'string' ? join(packageDir, hostRel) : undefined
  clientEntry = typeof clientRel === 'string' ? join(packageDir, clientRel) : undefined

  if (hostEntry !== undefined && existsSync(hostEntry) && statSync(hostEntry).size > 0) {
    ok('host entry present', hostEntry)
  } else {
    bad('host entry present', `exports["."] → ${String(hostRel)}`)
  }
  if (clientEntry !== undefined && existsSync(clientEntry) && statSync(clientEntry).size > 0) {
    ok('client bundle present', `${clientEntry} (${statSync(clientEntry).size} bytes)`)
  } else {
    bad('client bundle present', `exports["./client"] → ${String(clientRel)} (run npm run build)`)
  }
  if (manifest.dsh?.client?.platform === 'web') ok('dsh.client.platform', 'web')
  else bad('dsh.client.platform', `must be "web", found ${String(manifest.dsh?.client?.platform)}`)
}

/* ---------------------------------------------------------------- *
 * 3. every dsh.client.inject name is a real client plugin entry
 * ---------------------------------------------------------------- */

/**
 * The host reads `exports["./client"]` in two forms: a plain path, or a
 * condition map whose `default` is the path (the platform's own packages use
 * the second). A name is a boot row only if one of them yields a path.
 * @param exportsField - the package's `exports` object.
 * @returns the client bundle's relative path, or `undefined`.
 */
function clientPathOf(exportsField) {
  const client = exportsField?.['./client']
  if (typeof client === 'string') return client
  if (client !== null && typeof client === 'object' && typeof client.default === 'string') return client.default
  return undefined
}

if (manifest !== undefined) {
  const declaredInject = manifest.dsh?.client?.inject ?? []
  for (const specifier of declaredInject) {
    let target
    try {
      target = profileRequire.resolve(`${specifier}/package.json`)
    } catch {
      bad(`inject ${specifier}`, 'is not resolvable from the profile, so the browser module graph draws no arrival edge from it')
      continue
    }
    const targetManifest = JSON.parse(readFileSync(target, 'utf8'))
    const client = targetManifest.dsh?.client
    if (client?.platform === 'web' && clientPathOf(targetManifest.exports) !== undefined) {
      ok(`inject ${specifier}`, 'a real web client entry')
    } else {
      bad(`inject ${specifier}`, `resolves to ${target}, which publishes no dsh.client web bundle — not a boot row`)
    }
  }
}

/* ---------------------------------------------------------------- *
 * 4. the patch layer names the package the profile names
 * ---------------------------------------------------------------- */

if (manifest !== undefined) {
  const patchRel = manifest.dsh?.bundle?.patch
  const patchPath = typeof patchRel === 'string' ? join(dirname(installedManifestPath), patchRel) : undefined
  if (patchPath !== undefined && existsSync(patchPath)) {
    const patch = readFileSync(patchPath, 'utf8')
    if (new RegExp(`name:\\s*${PACKAGE_NAME}\\b`, 'u').test(patch)) {
      ok('cordis patch inserts the package', patchRel)
    } else {
      bad('cordis patch', `${patchRel} has no insert row naming ${PACKAGE_NAME}`)
    }
  } else {
    bad('cordis patch', `dsh.bundle.patch → ${String(patchRel)} is missing`)
  }
}

/* ---------------------------------------------------------------- *
 * 5. the client bundle materializes the way the shell will load it
 * ---------------------------------------------------------------- */

let ourSeat
if (clientEntry !== undefined && existsSync(clientEntry)) {
  const modules = {
    react: createFakeReact(),
    'react/jsx-runtime': createFakeJsxRuntime(),
    '@deepseek-ai/dsh-client-ui-primitives': createFakePrimitives(),
  }
  const loaded = loadClientBundle({ source: readFileSync(clientEntry, 'utf8'), id: PACKAGE_NAME, modules })
  if (loaded.exports?.name === PACKAGE_NAME.slice('dsh-'.length) || loaded.exports?.name === 'prompt-enhance') {
    ok('bundle registers', loaded.exports.name)
  } else {
    bad('bundle registration', `registered name is ${String(loaded.exports?.name)}`)
  }

  const registrations = []
  const ctx = {
    effect: callback => callback(),
    locale: { register: () => {} },
    slots: { inject: (name, callback) => callback(), register: (definition) => { registrations.push(definition); return () => {} } },
    remote: { commands: { execute: async () => ({ ok: true, value: undefined }) } },
  }
  try {
    loaded.exports.apply(ctx)
  } catch (error) {
    bad('bundle apply', error.message)
  }
  ourSeat = registrations[0]
  if (ourSeat !== undefined) ok('seat registered', `${ourSeat.name} id=${ourSeat.id} order=${ourSeat.order}`)
  else bad('seat registered', 'apply registered nothing')
}

/* ---------------------------------------------------------------- *
 * 5b. every platform name the client half imports is really exported
 * ---------------------------------------------------------------- */

/**
 * The platform module the client half draws its UI from is a *seed word* baked
 * into the shell's front-end bundle, not a package on disk. A name it does not
 * export is therefore invisible to every other check here: the bundle builds,
 * the VM harness passes (the fakes answer whatever is asked), npm resolves —
 * and the seat renders an empty button at runtime. Diffing our import list
 * against the installed bundle's real export surface is the only cheap way to
 * catch it.
 *
 * @returns the names imported from the primitives module across `src/client`.
 */
function platformImports() {
  const names = new Set()
  const dir = join(ROOT, 'src', 'client')
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js')) continue
    const source = readFileSync(join(dir, file), 'utf8')
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@deepseek-ai\/dsh-client-ui-primitives['"]/gu)) {
      for (const entry of match[1].split(',')) {
        const name = entry.trim().split(/\s+as\s+/u)[0].trim()
        if (name !== '') names.add(name)
      }
    }
  }
  return [...names].sort()
}

/** The installed front-end's script bundles — the module table the shell builds. */
function frontendScripts() {
  const found = []
  try {
    const manifestPath = profileRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json')
    const assets = join(dirname(manifestPath), 'dist', 'assets')
    if (existsSync(assets)) {
      for (const file of readdirSync(assets)) if (file.endsWith('.js')) found.push(join(assets, file))
    }
  } catch {
    /* Reported by the caller as a failure. */
  }
  return found
}

/**
 * Read the export surface of every copy of the primitives module in one bundle.
 *
 * Anchored on `Tooltip` — a name the module certainly owns — then refined by
 * requiring the enclosing object to be a real ESM export map (the one the
 * bundler closes with `Symbol.toStringTag`). Brace counting is exact here
 * because an export map holds only identifiers and short literals.
 *
 * @param source - one front-end script.
 * @returns the exported key names, across all copies found.
 */
function primitivesSurface(source) {
  const keys = new Set()
  for (let at = source.indexOf('Tooltip:'); at !== -1; at = source.indexOf('Tooltip:', at + 1)) {
    let depth = 0
    let open = -1
    for (let index = at - 1; index >= 0; index -= 1) {
      if (source[index] === '}') depth += 1
      else if (source[index] === '{') {
        if (depth === 0) { open = index; break }
        depth -= 1
      }
    }
    if (open === -1) continue
    let inner = 0
    let close = -1
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === '{') inner += 1
      else if (source[index] === '}') {
        inner -= 1
        if (inner === 0) { close = index; break }
      }
    }
    if (close === -1 || !source.startsWith(',Symbol.toStringTag', close + 1)) continue
    for (const match of source.slice(open, close).matchAll(/([A-Za-z_$][\w$]*)\s*:/gu)) keys.add(match[1])
  }
  return keys
}

{
  const wanted = platformImports()
  const scripts = frontendScripts()
  if (scripts.length === 0) {
    bad('front-end bundle', 'could not resolve @deepseek-ai/dsh-web-frontend from the profile, so imported names were not checked')
  } else {
    let surface
    let where
    for (const file of scripts) {
      const keys = primitivesSurface(readFileSync(file, 'utf8'))
      /* The first script that presents a surface wins; a later one is only
       * preferred if it is somehow larger. Comparing against `surface?.size`
       * here would silently drop the first hit, because `n > undefined` is
       * false for every n. */
      if (keys.has('Tooltip') && (surface === undefined || keys.size > surface.size)) {
        surface = keys
        where = file
      }
    }
    if (surface === undefined) {
      bad('primitives surface', `no script under the installed front-end presents a primitives export surface (looked at ${scripts.length})`)
    } else {
      ok('primitives surface', `${surface.size} exports read from ${where}`)
      for (const name of wanted) {
        if (surface.has(name)) ok(`primitives export ${name}`)
        else bad(`primitives export ${name}`, 'is imported by src/client but absent from the installed front-end — the seat would render an empty glyph and nothing else would complain')
      }
    }
  }
}

/* ---------------------------------------------------------------- *
 * 6. slot-collision scan across the profile's other plugins
 * ---------------------------------------------------------------- */

/** Every package directory in the profile's node_modules, scoped names included. */
function installedPackages() {
  const nodeModules = join(profileDir, 'node_modules')
  if (!existsSync(nodeModules)) return []
  const found = []
  for (const entry of readdirSync(nodeModules)) {
    if (entry === '.bin') continue
    const path = join(nodeModules, entry)
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(path)) found.push({ name: `${entry}/${scoped}`, dir: join(path, scoped) })
    } else {
      found.push({ name: entry, dir: path })
    }
  }
  return found
}

/** JS artifacts worth scanning inside one package, without walking a nested node_modules. */
function candidateFiles(packageDir) {
  const files = []
  const visit = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path, depth + 1)
      else if (/\.(?:js|cjs|mjs)$/u.test(entry.name)) files.push(path)
    }
  }
  visit(packageDir, 0)
  return files
}

const occupants = []
const seenOccupants = new Set()
const commandHits = []
for (const pkg of installedPackages()) {
  if (pkg.name === PACKAGE_NAME) continue
  for (const file of candidateFiles(pkg.dir)) {
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (source.includes(`'${COMMAND_NAME}'`) || source.includes(`"${COMMAND_NAME}"`)) {
      commandHits.push(`${pkg.name} → ${file.replace(profileDir, '.')}`)
    }
    let index = source.indexOf(SLOT)
    while (index !== -1) {
      /* The registration call follows the slot name; a narrow window is enough
       * to read the `id` and `order` of each seat without a JS parser. The same
       * seat is named twice by most packages (once in `inject`, once in
       * `register`), so identical readings collapse. */
      const window = source.slice(index, index + 400)
      const id = window.match(/id:\s*["']([^"']+)["']/u)?.[1]
      const order = window.match(/order:\s*(\d+)/u)?.[1]
      const key = `${pkg.name}|${id}|${order}`
      if ((id !== undefined || order !== undefined) && !seenOccupants.has(key)) {
        seenOccupants.add(key)
        occupants.push({ pkg: pkg.name, id, order })
      }
      index = source.indexOf(SLOT, index + SLOT.length)
    }
  }
}

if (occupants.length === 0) {
  ok('seat collisions', `${SLOT} is free across ${installedPackages().length - 1} other packages`)
} else {
  for (const occupant of occupants) {
    const sameId = ourSeat !== undefined && occupant.id === ourSeat.id
    const sameOrder = ourSeat !== undefined && occupant.order === String(ourSeat.order)
    if (sameId) bad('seat id collision', `${occupant.pkg} also registers id=${occupant.id} in ${SLOT}`)
    else if (sameOrder) {
      bad(
        'seat order tie',
        `${occupant.pkg} holds order=${occupant.order} in ${SLOT} (id=${String(occupant.id)}); ` +
        'a tie resolves by registration order, so the two swap places across boots',
      )
    } else {
      ok('seat coexists', `${occupant.pkg} holds id=${String(occupant.id)} order=${String(occupant.order)}`)
    }
  }
}

if (commandHits.length === 0) ok('command name is free', `/${COMMAND_NAME}`)
else for (const hit of commandHits) bad('command name also appears in', hit)

/* ---------------------------------------------------------------- *
 * report
 * ---------------------------------------------------------------- */

console.log(findings.join('\n'))
console.log(failures === 0 ? '\nverify-install: OK' : `\nverify-install: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
