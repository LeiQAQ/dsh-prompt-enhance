/**
 * Build both halves of the plugin.
 *
 * The two halves ship in two different module systems, and this script is the
 * only place that fact is handled:
 *
 *   - **host**: real ESM. `src/host/**` (minus the entry) and `src/shared/**`
 *     are copied to `dist/host/**` and `dist/shared/**` unchanged, so their
 *     relative imports keep resolving; `src/host/index.js` is promoted to
 *     `dist/index.js` with its relative specifiers rewritten for the new
 *     location. That file is the package's `.` export and what the host loader
 *     imports.
 *   - **client**: one CJS closure for `window.__ModuleLoader__.load`. The
 *     browser module table resolves only platform modules (react, the slot
 *     machinery, the primitives), so the plugin's own modules are INLINED into
 *     a single factory: relative imports disappear (every declaration lands in
 *     the factory's scope) and bare specifiers become destructured `require()`
 *     bindings the loader resolves.
 *
 * Because inlining shares one scope, every top-level declaration across the
 * inlined modules must be unique. That is checked here rather than trusted:
 * a duplicate would silently shadow, and the bug would surface as a wrong
 * string in a production rewrite.
 *
 * The script fails loudly on anything it does not understand (unsupported
 * import/export syntax, a missing file, a duplicate name, a syntax error in the
 * output) instead of emitting a bundle that half-works.
 *
 * Usage: node scripts/build.mjs
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const DIST = join(ROOT, 'dist')

const HOST_ENTRY = join(SRC, 'host', 'index.js')
const CLIENT_ENTRY = join(SRC, 'client', 'index.js')
const CLIENT_BUNDLE_ID = 'dsh-prompt-enhance'
const DIST_ENTRY = join(DIST, 'index.js')
const DIST_CLIENT = join(DIST, 'client.cjs')

/** One line of build progress. */
function progress(label, detail) {
  process.stdout.write(`build: ${label.padEnd(20)} ${detail}\n`)
}

/** Paths as the build reports them: relative, forward-slashed. */
function display(path) {
  return relative(ROOT, path).replace(/\\/gu, '/')
}

/** File size for a written artifact. */
function sizeOf(text) {
  return `${String(Buffer.byteLength(text)).padStart(7)} bytes`
}

/**
 * Rewrite the relative specifiers of the promoted host entry for the dist root,
 * where sibling host modules live one level deeper and shared modules are a
 * sibling directory.
 * @param source - the entry module source.
 * @returns the rewritten source.
 */
function promoteRelativeSpecifiers(source) {
  return source.replace(/(from\s*')(\.\.?\/[^']*)(')/gu, (_match, head, specifier, tail) => {
    if (specifier.startsWith('../shared/')) return `${head}./${specifier.slice(3)}${tail}`
    if (specifier.startsWith('./')) return `${head}./host/${specifier.slice(2)}${tail}`
    return `${head}${specifier}${tail}`
  })
}

/** Copy the host half; promote the entry to the dist root. */
async function buildHost() {
  for (const dir of ['host', 'shared']) {
    await mkdir(join(DIST, dir), { recursive: true })
    for (const name of await readdir(join(SRC, dir))) {
      if (!name.endsWith('.js')) continue
      if (dir === 'host' && name === 'index.js') continue
      const source = await readFile(join(SRC, dir, name), 'utf8')
      await writeFile(join(DIST, dir, name), source)
      progress(dir === 'host' ? 'host module' : 'shared module', `${display(join(DIST, dir, name))}`)
    }
  }
  const promoted = promoteRelativeSpecifiers(await readFile(HOST_ENTRY, 'utf8'))
  await writeFile(DIST_ENTRY, promoted)
  /* A missing target would only surface when the host loader imports the
   * plugin, i.e. at app start; resolve every relative specifier now instead. */
  for (const match of promoted.matchAll(/from\s*'(\.[^']*)'/gu)) {
    if (!existsSync(join(DIST, match[1]))) {
      throw new Error(`build: dist/index.js imports a missing file: ${match[1]}`)
    }
  }
  progress('host entry', `${display(DIST_ENTRY)} ${sizeOf(promoted)}`)
}

/** One inlined client module. */
const modules = new Map()

/** External (bare) specifier bindings: local name → specifier. */
const externals = new Map()

/**
 * Read one client module and its transitive relative imports into {@link modules}.
 * @param path - module absolute path.
 */
async function loadClientModule(path) {
  const absolute = resolve(path)
  if (modules.has(absolute)) return
  const source = await readFile(absolute, 'utf8')
  const dependencies = []

  const withoutImports = source.replace(
    /^import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;?[ \t]*$/gmu,
    (_match, names, specifier) => {
      const parsed = parseImportNames(names, absolute, specifier)
      if (specifier.startsWith('.')) {
        dependencies.push(resolve(dirname(absolute), specifier))
        return ''
      }
      for (const [local, imported] of parsed) {
        if (local !== imported) {
          throw new Error(`build: ${display(absolute)} renames the platform import "${imported}" — the client inliner binds by name only`)
        }
        const bound = externals.get(local)
        if (bound !== undefined && bound !== specifier) {
          throw new Error(`build: "${local}" is required from both "${bound}" and "${specifier}"`)
        }
        externals.set(local, specifier)
      }
      return ''
    },
  )

  assertNoUnhandledModuleSyntax(withoutImports, absolute)
  const names = new Set()
  const body = withoutImports.replace(
    /^export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gmu,
    (_match, kind, name) => {
      names.add(name)
      return `${kind} ${name}`
    },
  )
  if (/^export\s/mu.test(body)) {
    throw new Error(`build: ${display(absolute)} uses export syntax the client inliner does not handle (named declarations only)`)
  }

  /* Depth-first: a dependency's declarations must precede the code that reads
   * them at materialization time. */
  for (const dependency of dependencies) await loadClientModule(dependency)
  modules.set(absolute, { path: absolute, body, names })
}

/**
 * Parse one import clause into `[local, imported]` pairs.
 * @param names - the clause between the braces.
 * @param path - module doing the import, for diagnostics.
 * @param specifier - the module specifier.
 * @returns the pairs.
 */
function parseImportNames(names, path, specifier) {
  const pairs = []
  for (const entry of names.split(',')) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) continue
    const parts = trimmed.split(/\s+as\s+/u)
    pairs.push([parts.length > 1 ? parts[1] : trimmed, trimmed])
  }
  if (pairs.length === 0) {
    throw new Error(`build: ${display(path)} has an empty import clause for "${specifier}"`)
  }
  return pairs
}

/** Refuse module syntax this inliner would silently drop. */
function assertNoUnhandledModuleSyntax(source, path) {
  if (/^\s*import\s/mu.test(source)) {
    throw new Error(`build: ${display(path)} uses an import form the client inliner does not handle (named single-line imports only)`)
  }
  if (/^\s*export\s*\{/mu.test(source) || /^\s*export\s+default/mu.test(source) || /^\s*export\s+\*/mu.test(source)) {
    throw new Error(`build: ${display(path)} uses an export form the client inliner does not handle`)
  }
}

/** Inline the client module graph into one module-loader bundle. */
async function buildClient() {
  await loadClientModule(CLIENT_ENTRY)

  const declarations = new Map()
  const bodies = []
  for (const module of modules.values()) {
    for (const name of module.names) {
      const owner = declarations.get(name)
      if (owner !== undefined) {
        throw new Error(
          `build: duplicate top-level name "${name}" in ${display(owner)} and ${display(module.path)} — the inlined client bundle shares one scope`,
        )
      }
      declarations.set(name, module.path)
    }
    bodies.push(`/* ---- ${display(module.path)} ---- */\n${module.body.trim()}`)
  }

  const entry = modules.get(CLIENT_ENTRY)
  const required = [...new Set(externals.values())].sort()
  const bindings = [...externals.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  const exported = [...entry.names].sort()

  const code = [
    `window.__ModuleLoader__.load({`,
    `  id: ${JSON.stringify(CLIENT_BUNDLE_ID)},`,
    `  factory: (require) => {`,
    `    'use strict'`,
    `    var module = { exports: {} }`,
    `    var exports = module.exports`,
    `    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })`,
    ...bindings.map(([local, specifier]) => `    var ${local} = require(${JSON.stringify(specifier)}).${local}`),
    ``,
    indentBlock(bodies.join('\n\n')),
    ``,
    ...exported.map(name => `    exports.${name} = ${name}`),
    `    return module.exports`,
    `  },`,
    `})`,
    ``,
  ].join('\n')

  /* Compile before writing: a syntax error must fail the build, not the app. */
  try {
    new vm.Script(code, { filename: DIST_CLIENT })
  } catch (error) {
    throw new Error(`build: the generated client bundle does not compile: ${error.message}`)
  }
  await writeFile(DIST_CLIENT, code)
  progress('client bundle', `${display(DIST_CLIENT)} ${sizeOf(code)}`)
  progress('client requires', required.map(specifier => `require(${JSON.stringify(specifier)})`).join(', '))
  progress('client exports', exported.join(', '))
  progress('client modules', [...modules.keys()].map(display).join(', '))
}

/** Indent an inlined block into the factory body. */
function indentBlock(block) {
  return block.split('\n').map(line => (line.length === 0 ? line : `    ${line}`)).join('\n')
}

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })
await buildHost()
await buildClient()
progress('ok', `${modules.size} client modules inlined`)
