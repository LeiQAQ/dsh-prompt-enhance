#!/usr/bin/env node
/**
 * Profile-roster verification: will this package actually be mounted?
 *
 * `verify-install.mjs` proves the profile *names* the package and that the link
 * exists. It cannot prove the package reaches the browser roster, and that is
 * the step between "installed" and "the icon is on screen". Two independent
 * things have to line up, and getting either wrong produces the same silent
 * symptom — no button, no error:
 *
 *   1. the profile's composed loader tree must contain a row whose `name`
 *      resolves to this package (`dsh --profile <name> --dump-config`);
 *   2. this package's manifest must declare `dsh.client.platform === "web"`
 *      AND publish `exports["./client"]`, because the roster is built by
 *      walking the loader rows and keeping only the web-client halves.
 *
 * A mismatch is invisible to every other check in this repository, including
 * `verify-install.mjs`, because both failure modes leave a perfectly valid
 * install that simply never loads.
 *
 * Note on `dsh.client.inject`: it is NOT the activation gate. Its entries are
 * package names used for module-arrival ordering in the browser, and an entry
 * that is not a boot row is silently skipped. The gate is the `inject` list the
 * client module itself exports, whose entries are *service* names (`slots`,
 * `remote.commands`, `locale`, …). A package name that no longer exists under
 * that field is therefore harmless and must not be reported as a failure.
 *
 * Usage:
 *   node scripts/verify-profile-roster.mjs --profile <dir> [--dump <file>] [--expect <pkg>]
 *
 * `--dump` reuses a saved `dsh --profile <name> --dump-config` output instead of
 * spawning the CLI. Without it the script looks for a `dsh` command in this
 * order: `$DSH_BIN`, `dsh` on PATH, then the DSH Desktop host shim under
 * `%APPDATA%/DSH Desktop/host-commands/<profile>/bin/dsh.cmd`.
 *
 * @module dsh-prompt-enhance/scripts/verify-profile-roster
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const PACKAGE_NAME = 'dsh-prompt-enhance'
const DEFAULT_PROFILE = join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'profiles', 'web')

/* ---------------------------------------------------------------- *
 * arguments
 * ---------------------------------------------------------------- */

/** Read `--flag value`, returning `undefined` when the flag is absent. */
function arg(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

const profileDir = resolve(arg('profile') ?? DEFAULT_PROFILE)
const profileName = basename(profileDir)
const expected = arg('expect') ?? PACKAGE_NAME
const dumpArg = arg('dump')

let failures = 0
const findings = []
const ok = (label, detail) => findings.push(`  ok   ${label}${detail === undefined ? '' : ` — ${detail}`}`)
const bad = (label, detail) => { findings.push(`  FAIL ${label} — ${detail}`); failures += 1 }

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`verify-profile-roster: no profile at ${profileDir}`)
  process.exit(2)
}

/* ---------------------------------------------------------------- *
 * 1. obtain the composed loader tree
 * ---------------------------------------------------------------- */

/**
 * Locate a runnable `dsh` for this profile.
 *
 * The Desktop host shim is preferred over `dsh` on PATH because a packaged
 * Desktop install ships no global `dsh`. Only the *active* profile gets its own
 * `host-commands/<name>/bin/dsh.cmd`, so any sibling shim is accepted: the one
 * it bakes in is only a default, and an explicit `--profile` wins over it.
 * @returns the command plus its leading arguments, or `undefined`.
 */
function locateDsh() {
  if (process.env.DSH_BIN !== undefined && process.env.DSH_BIN !== '') return [process.env.DSH_BIN, []]
  const root = process.env.APPDATA
  if (root !== undefined && root !== '') {
    const hostCommands = join(root, 'DSH Desktop', 'host-commands')
    const own = join(hostCommands, profileName, 'bin', 'dsh.cmd')
    if (existsSync(own)) return [own, []]
    try {
      for (const entry of readdirSync(hostCommands)) {
        const shim = join(hostCommands, entry, 'bin', 'dsh.cmd')
        if (existsSync(shim)) return [shim, []]
      }
    } catch {
      /* No host-commands directory: fall through to PATH. */
    }
  }
  return ['dsh', []]
}

let dump
if (dumpArg !== undefined) {
  if (!existsSync(dumpArg)) {
    console.error(`verify-profile-roster: --dump ${dumpArg} does not exist`)
    process.exit(2)
  }
  dump = readFileSync(dumpArg, 'utf8')
  ok('composed tree', `read from ${dumpArg}`)
} else {
  const [command, prefix] = locateDsh()
  const throughShell = process.platform === 'win32'
  /* Windows `.cmd` shims must go through the shell, and a packaged Desktop
   * install lives under a path containing a space ("DSH Desktop"), so the
   * executable has to be quoted once the shell re-parses the command line. */
  const executable = throughShell && command.includes(' ') ? `"${command}"` : command
  const result = spawnSync(executable, [...prefix, '--profile', profileName, '--dump-config'], {
    encoding: 'utf8',
    shell: throughShell,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error !== undefined || result.status !== 0) {
    const detail = result.error === undefined
      ? `exited ${String(result.status)}: ${(result.stderr ?? '').trim().split('\n').slice(-3).join(' / ')}`
      : result.error.message
    bad('composed tree', `${command} --profile ${profileName} --dump-config ${detail}`)
    console.log(findings.join('\n'))
    console.log(`\nverify-profile-roster: ${failures} failure(s)`)
    process.exit(1)
  }
  dump = result.stdout
  ok('composed tree', `${command} --profile ${profileName} --dump-config`)
}

/* ---------------------------------------------------------------- *
 * 2. every row `name` that resolves to a package, deduplicated
 * ---------------------------------------------------------------- */

const rowNames = [...dump.matchAll(/^\s*name:\s*(.+?)\s*$/gmu)]
  .map((match) => match[1].replace(/^['"]|['"]$/gu, ''))
  .filter((name) => !name.startsWith('>-') && !name.startsWith('|'))
const uniqueNames = [...new Set(rowNames)]
ok('rows in the composed tree', String(uniqueNames.length))

/* ---------------------------------------------------------------- *
 * 3. replicate the roster rule and find the expected package
 * ---------------------------------------------------------------- */

const profileRequire = createRequire(join(profileDir, 'package.json'))
const roster = []
let expectedRow

const isWebClient = (manifest) => manifest?.dsh?.client?.platform === 'web'

/**
 * Resolve the roster's bundle path the way the host reads it: a plain string
 * or a condition map whose `default` is the path.
 * @param exportsField - the package's `exports` object.
 * @returns the client bundle's relative path, or `undefined`.
 */
function clientPathOf(exportsField) {
  const client = exportsField?.['./client']
  if (typeof client === 'string') return client
  if (client !== null && typeof client === 'object' && typeof client.default === 'string') return client.default
  return undefined
}

for (const name of uniqueNames) {
  let manifestPath
  try {
    manifestPath = profileRequire.resolve(`${name}/package.json`)
  } catch {
    /* Subpath rows (`pkg/subpath`) and path-like rows are not packages. */
    continue
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    continue
  }
  if (!isWebClient(manifest)) continue
  const relative = clientPathOf(manifest.exports)
  if (relative === undefined) continue
  const clientPath = join(dirname(manifestPath), relative)
  const present = existsSync(clientPath)
  roster.push({ name: manifest.name ?? name, clientPath, present })
  if ((manifest.name ?? name) === expected) expectedRow = { name: manifest.name, clientPath, present }
}

ok('client roster entries', String(roster.length))

/* ---------------------------------------------------------------- *
 * 4. the verdict
 * ---------------------------------------------------------------- */

if (expectedRow === undefined) {
  bad(
    `${expected} reaches the roster`,
    'the composed tree has no row resolving to it — the profile does not list it in dsh.profile.bundles, or the link is missing',
  )
} else {
  ok(`${expected} reaches the roster`, expectedRow.clientPath)
  if (expectedRow.present && statSync(expectedRow.clientPath).size > 0) {
    ok(`${expected} client bundle`, `${statSync(expectedRow.clientPath).size} bytes`)
  } else {
    bad(`${expected} client bundle`, `${expectedRow.clientPath} is missing or empty — run npm run build`)
  }
}

const broken = roster.filter((entry) => !entry.present)
if (broken.length === 0) ok('every roster entry resolves a bundle')
else for (const entry of broken) bad(`roster entry ${entry.name}`, `${entry.clientPath} is missing`)

/* ---------------------------------------------------------------- *
 * report
 * ---------------------------------------------------------------- */

console.log(`profile: ${profileDir}`)
console.log(findings.join('\n'))
console.log(failures === 0 ? '\nverify-profile-roster: OK' : `\nverify-profile-roster: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
