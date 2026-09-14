/**
 * Assert the shipped prompt assets are the untouched WorkBuddy originals.
 *
 * The unit suite asserts the same digests; this script exists as a standalone
 * pre-build/CI gate so a copy that silently lost a line cannot reach a release.
 *
 * Usage: node scripts/verify-prompts.mjs
 * @module dsh-prompt-enhance/scripts/verify-prompts
 */

import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_URL = pathToFileURL(resolve(PLUGIN_ROOT, 'src/host/prompts.js')).href

/** sha256 (lowercase hex, first 16) of one asset. */
function digest(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').slice(0, 16)
}

/** Expected anchors — PRD §6.5. */
const EXPECTED = { system: '14227948d6914a07', user: 'ceb5a2e042ad9bb5' }

const { SYSTEM_PROMPT, USER_TEMPLATE, PROMPT_DIGESTS, USER_TEMPLATE_PLACEHOLDER } =
  await import(MODULE_URL)

const failures = []

const checks = [
  ['system digest', digest(SYSTEM_PROMPT), EXPECTED.system],
  ['system digest anchor', PROMPT_DIGESTS.system, EXPECTED.system],
  ['user digest', digest(USER_TEMPLATE), EXPECTED.user],
  ['user digest anchor', PROMPT_DIGESTS.user, EXPECTED.user],
  ['system line count', String(SYSTEM_PROMPT.split('\n').length), '46'],
  ['user line count', String(USER_TEMPLATE.split('\n').length), '42'],
]
for (const [label, actual, expected] of checks) {
  if (actual !== expected) failures.push(`${label}: got ${actual}, expected ${expected}`)
}

const placeholderCount = USER_TEMPLATE.split(USER_TEMPLATE_PLACEHOLDER).length - 1
if (placeholderCount !== 1) failures.push(`user template placeholder count: got ${placeholderCount}, expected 1`)
if (/\r/u.test(SYSTEM_PROMPT) || /\r/u.test(USER_TEMPLATE)) failures.push('assets must be LF-normalised')

if (failures.length > 0) {
  console.error('verify-prompts: FAILED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('verify-prompts: OK')
console.log(`  system ${SYSTEM_PROMPT.split('\n').length} lines / ${SYSTEM_PROMPT.length} chars / ${EXPECTED.system}`)
console.log(`  user   ${USER_TEMPLATE.split('\n').length} lines / ${USER_TEMPLATE.length} chars / ${EXPECTED.user}`)
console.log(`  placeholder "${USER_TEMPLATE_PLACEHOLDER}" appears exactly once`)
