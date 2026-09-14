#!/usr/bin/env node
/**
 * Answer one question: **does the running DSH Desktop predate this profile's
 * current boot config?**
 *
 * Why this exists (2026-09-14, two wasted rounds):
 *
 * DSH Desktop is Electron with a single-instance lock. Clicking the launcher icon
 * while an instance is already running does NOT start a new process — it just
 * focuses the existing window. So a user who "restarted" by clicking the icon is
 * still on the boot-time client roster, and a freshly installed plugin stays
 * invisible with no error anywhere. The client bundle is read once, at startup.
 *
 * This script compares
 *   - the running instance's start time (`crash-evidence/active-run.json`, plus a
 *     liveness check on its pid), and the last `run <epoch>` line in `logs/`,
 * against
 *   - the mtime of every file whose change affects what the next boot composes
 *     (`package.json`, `cordis.patch.yml`, the plugin's `node_modules` entry).
 *
 * Usage:
 *   node scripts/check-desktop-restart.mjs
 *   node scripts/check-desktop-restart.mjs --user-data "C:/Users/me/AppData/Roaming/DSH Desktop"
 *   node scripts/check-desktop-restart.mjs --home "C:/Users/me/.dsh"
 *   node scripts/check-desktop-restart.mjs --require-boot-graph   # also run the roster check
 *
 * Exit codes: 0 = safe (or nothing running), 1 = a full restart is required,
 *             2 = could not determine.
 *
 * @module dsh-prompt-enhance/scripts/check-desktop-restart
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')
const PLUGIN_NAME = 'dsh-prompt-enhance'

/**
 * Files whose mtime decides whether a boot is stale.
 *
 * `cordis.yml` is deliberately NOT here: both `prepareProfile` (every boot) and
 * `dsh --dump-config` rewrite it, so its mtime measures the last *inspection*,
 * not the last *config change*. Counting it would make this script cry wolf right
 * after the user runs the roster check.
 */
const BOOT_RELEVANT = ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml']

/** Parse `--flag value` / `--flag` pairs. */
function parseArgs(argv) {
  const out = { flags: new Set(), values: new Map() }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out.flags.add(token.slice(2))
    else {
      out.values.set(token.slice(2), next)
      i += 1
    }
  }
  return out
}

/** Default Electron userData directory for DSH Desktop on this platform. */
function defaultUserData() {
  if (platform() === 'win32') {
    const appData = process.env.APPDATA
    return appData === undefined ? undefined : join(appData, 'DSH Desktop')
  }
  if (platform() === 'darwin') return join(homedir(), 'Library/Application Support/DSH Desktop')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'DSH Desktop')
}

/** Read a JSON file, or undefined when absent/unreadable. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** mtime in ms, or undefined. */
function mtime(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return undefined
  }
}

/** Whether a pid currently exists (signal 0 probe; EPERM still means alive). */
function isAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return cause?.code === 'EPERM'
  }
}

/**
 * Last boot epoch (ms) recorded by the desktop shell's own run header.
 *
 * The header is written once per shell start:
 *   `--- dsh-plugin-desktop DSH Desktop 2.0.5 win32 node v24.18.1 run 1789388825995 ---`
 * It is the most trustworthy "when did the GUI last boot" signal because it does
 * not depend on which profile booted.
 */
function lastRunFromLogs(logsDir) {
  let newest
  let source
  let names
  try {
    names = readdirSync(logsDir).filter((name) => name.endsWith('.log'))
  } catch {
    return {}
  }
  for (const name of names) {
    let text
    try {
      text = readFileSync(join(logsDir, name), 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/run\s+(\d{10,})\s*---/gu)) {
      const value = Number(match[1])
      if (Number.isFinite(value) && (newest === undefined || value > newest)) {
        newest = value
        source = name
      }
    }
  }
  return { at: newest, source }
}

/** Every profile dir that has a package.json, with its declared bundles. */
function readProfiles(home) {
  const root = join(home, 'profiles')
  let names
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  return names.map((name) => {
    const dir = join(root, name)
    const manifest = readJson(join(dir, 'package.json')) ?? {}
    return {
      name,
      dir,
      bundles: manifest.dsh?.profile?.bundles ?? [],
      dependencies: Object.keys(manifest.dependencies ?? {}),
    }
  })
}

/**
 * Latest mtime among the files that decide what the next boot composes, for one
 * profile — plus the profile's link entry for the plugin.
 */
function profileChangeTime(profile) {
  let newest = 0
  let which
  const consider = (path, label) => {
    const at = mtime(path)
    if (at !== undefined && at > newest) {
      newest = at
      which = label
    }
  }
  for (const name of BOOT_RELEVANT) consider(join(profile.dir, name), name)
  /* The plugin's link/junction entry: replacing a link is a boot-relevant change. */
  if (profile.bundles.includes(PLUGIN_NAME) || profile.dependencies.includes(PLUGIN_NAME)) {
    consider(join(profile.dir, 'node_modules', PLUGIN_NAME), `node_modules/${PLUGIN_NAME}`)
  }
  return { at: newest, which }
}

/** Format an epoch ms in local time. */
function stamp(ms) {
  return ms === undefined ? '(unknown)' : new Date(ms).toLocaleString()
}

/** Whole minutes between two epochs. */
function minutes(from, to) {
  return Math.round((to - from) / 60000)
}

const args = parseArgs(process.argv.slice(2))
const userData = resolve(args.values.get('user-data') ?? defaultUserData() ?? '.')
const home = resolve(args.values.get('home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const failures = []
const ok = (label, detail) => console.log(`  ok   ${label}${detail === undefined ? '' : ` — ${detail}`}`)
const bad = (label, detail) => {
  failures.push(label)
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}
const info = (label, detail) => console.log(`  --   ${label}${detail === undefined ? '' : ` — ${detail}`}`)

console.log(`check-desktop-restart: ${PLUGIN_NAME}`)
console.log(`  user data : ${userData}`)
console.log(`  dsh home  : ${home}`)
console.log('')

const active = readJson(join(userData, 'profile-selection', 'state.json'))
const activeName = typeof active?.active === 'string' ? active.active : undefined
const profiles = readProfiles(home)
const activeProfile = profiles.find((profile) => profile.name === activeName)

if (activeName === undefined) bad('active profile is readable', `no profile-selection/state.json under ${userData}`)
else ok('active profile', activeName)

const run = readJson(join(userData, 'crash-evidence', 'active-run.json'))
const logRun = lastRunFromLogs(join(userData, 'logs'))
const runAt = typeof run?.startedAt === 'string' ? Date.parse(run.startedAt) : undefined
const alive = isAlive(run?.pid)
const bootAt = logRun.at ?? (Number.isFinite(runAt) ? runAt : undefined)

if (run === undefined && logRun.at === undefined) {
  info('running instance', 'no run record found — the shell has never started on this account')
} else {
  info('last recorded run', `${stamp(bootAt)}${logRun.source === undefined ? '' : ` (logs/${logRun.source})`}`)
  info('run pid', `${run?.pid ?? '(none)'} → ${alive ? 'ALIVE' : 'not running'}`)
}

const changes = []
for (const profile of profiles) {
  const change = profileChangeTime(profile)
  if (change.at === 0) continue
  changes.push({ profile, ...change })
}
const newestChange = changes.reduce((acc, item) => (acc === undefined || item.at > acc.at ? item : acc), undefined)

if (newestChange !== undefined) {
  const relevant = newestChange.profile.name === activeName
  const line = `${newestChange.profile.name} (${newestChange.which})`
  if (relevant) info('newest boot-relevant change', `${stamp(newestChange.at)} — ${line}`)
  else info('newest boot-relevant change', `${stamp(newestChange.at)} — ${line} — NOT the active profile`)
}

if (!alive) {
  // Nothing running: the trap cannot bite — launching the app IS a fresh boot.
  console.log('')
  ok('no DSH Desktop instance is running', 'just launch it — that boot will compose the current config')
  process.exit(0)
}

if (bootAt === undefined || newestChange === undefined) {
  console.log('')
  bad('cannot decide', 'missing either the boot time or any profile change time')
  process.exit(2)
}

console.log('')
if (newestChange.at > bootAt) {
  bad(
    'FULL RESTART REQUIRED',
    `the running instance booted at ${stamp(bootAt)}, but ${newestChange.profile.name} last changed at ${stamp(newestChange.at)} (+${minutes(bootAt, newestChange.at)} min)`,
  )
  console.log('')
  console.log('  Clicking the launcher icon will NOT help: DSH Desktop holds a single-instance')
  console.log('  lock, so it just focuses the existing window and the boot-time client roster')
  console.log('  stays as it was. Quit the process completely, then start it again:')
  console.log('')
  console.log('    PowerShell:  Stop-Process -Name "DSH Desktop" -Force')
  console.log('    or:          tray icon → Quit   (the window × may only hide it)')
  console.log('')
  process.exit(1)
}

ok('the running instance is newer than every boot-relevant change', `no restart needed (booted ${stamp(bootAt)})`)

if (args.flags.has('require-boot-graph')) {
  console.log('')
  console.log(`  --   re-running the roster check for ${activeName ?? '(none)'}`)
  const roster = spawnSync(
    process.execPath,
    [join(HERE, 'verify-profile-roster.mjs'), '--profile', join(home, 'profiles', activeName ?? '')],
    { shell: platform() === 'win32', maxBuffer: 32 * 1024 * 1024 },
  )
  const text = `${roster.stdout ?? ''}${roster.stderr ?? ''}`
  if (roster.status === 0) ok('boot graph contains the plugin', 'see verify-profile-roster output above')
  else {
    bad('boot graph check failed', `exit ${roster.status}`)
    console.log(text.trimEnd())
  }
}

console.log('')
console.log(`check-desktop-restart: ${failures.length === 0 ? 'OK' : `FAILED (${failures.join('; ')})`}`)
process.exit(failures.length === 0 ? 0 : 1)
