/**
 * Session model resolution — the plugin's half of goal G3, and uncertainty U1
 * (PRD §5.3, §7.3).
 *
 * The chain is `agent.session.requestHeader()?.config` (what the user's model
 * selector last produced) falling back to the receiving agent's own `options`
 * (the deployment default). It must be total: a host whose session face cannot
 * be read is "no logged route", never a mount failure — a plugin must not be
 * able to break the app it is installed into.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveSelection, sessionIdOf } from '../dist/host/selection.js'
import { createAgent } from './helpers/fakes.mjs'

describe('resolveSelection', () => {
  it('prefers the session log, exactly like dsh-compaction-basic', () => {
    const { agent } = createAgent({
      header: { provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
      options: { provider: 'other', model: 'other-model' },
    })
    assert.deepEqual(resolveSelection(agent), {
      provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', source: 'session',
    })
  })

  it('falls back to the agent options when the session has no logged request', () => {
    const { agent } = createAgent({ options: { provider: 'deployed', model: 'default-model' } })
    assert.deepEqual(resolveSelection(agent), {
      provider: 'deployed', model: 'default-model', source: 'agent',
    })
  })

  it('reports no route when neither source offers one', () => {
    assert.equal(resolveSelection(createAgent({}).agent), undefined)
  })

  it('rejects an incomplete route instead of forwarding it', () => {
    for (const header of [{ provider: 'x' }, { model: 'y' }, { provider: '', model: 'y' }, { provider: 'x', model: '' }, { provider: 1, model: 'y' }]) {
      assert.equal(resolveSelection(createAgent({ header }).agent), undefined, JSON.stringify(header))
    }
  })

  it('tolerates a host whose session face is absent or unreadable (U1 fallback)', () => {
    assert.equal(resolveSelection(createAgent({ hasRequestHeader: false, options: { provider: 'p', model: 'm' } }).agent).source, 'agent')
    assert.equal(resolveSelection(createAgent({ requestHeaderThrows: true, options: { provider: 'p', model: 'm' } }).agent).source, 'agent')
  })

  it('tolerates a missing or malformed agent', () => {
    assert.equal(resolveSelection(undefined), undefined)
    assert.equal(resolveSelection(null), undefined)
    assert.equal(resolveSelection({}), undefined)
    assert.equal(resolveSelection({ session: null }), undefined)
    assert.equal(resolveSelection({ session: {} }), undefined)
  })

  it('does not invent a reasoning effort when the source omits one', () => {
    const selection = resolveSelection(createAgent({ header: { provider: 'p', model: 'm' } }).agent)
    assert.equal('reasoningEffort' in selection, false)
  })
})

describe('sessionIdOf', () => {
  it('reads the session id when one is available', () => {
    assert.equal(sessionIdOf(createAgent({ sessionId: 's-7' }).agent), 's-7')
  })

  it('reports undefined rather than a wrong id', () => {
    assert.equal(sessionIdOf(undefined), undefined)
    assert.equal(sessionIdOf({ session: { id: '' } }), undefined)
    assert.equal(sessionIdOf({ session: {} }), undefined)
  })
})
