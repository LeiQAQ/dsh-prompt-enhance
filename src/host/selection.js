/**
 * Session model resolution — the plugin's half of goal G3.
 *
 * WorkBuddy reads the composer's model selector value and forwards it. The host
 * has no selector, but the session log carries the same fact: the loop logs the
 * effective call configuration as `request/header`, and `session.requestHeader()`
 * returns the latest one. This is the exact chain
 * `dsh-compaction-basic` uses for its auxiliary call
 * (`summarizer.ts`: `agent.session.requestHeader()?.config`), so an auxiliary
 * call rides the same route the conversation does.
 *
 * Fallback order, each step strictly weaker:
 *   1. the session's latest `request/header` config — what the user's selector last produced;
 *   2. the receiving agent's own `options` — the deployment/agent-default route;
 *   3. `undefined`, which the handler reports as `no_model`.
 *
 * @module dsh-prompt-enhance/selection
 */

/**
 * One resolved provider route.
 * @typedef {{ provider: string, model: string, reasoningEffort?: string, source: 'session' | 'agent' }} ResolvedSelection
 */

/** Whether a candidate carries a usable provider/model pair. */
function isUsable(candidate) {
  return candidate !== undefined
    && candidate !== null
    && typeof candidate.provider === 'string'
    && candidate.provider.length > 0
    && typeof candidate.model === 'string'
    && candidate.model.length > 0
}

/**
 * Read the session's latest logged request config, tolerating a host whose
 * session face does not expose `requestHeader` (the plugin must not fail to
 * mount over a host-version difference).
 * @param agent - the receiving agent.
 * @returns the logged config, or `undefined`.
 */
function sessionConfig(agent) {
  const session = agent !== undefined && agent !== null ? agent.session : undefined
  if (session === undefined || session === null) return undefined
  if (typeof session.requestHeader !== 'function') return undefined
  try {
    const header = session.requestHeader()
    return header === undefined || header === null ? undefined : header.config
  } catch {
    /* A session whose log cannot be read is treated as "no logged route". */
    return undefined
  }
}

/**
 * Resolve the route one auxiliary call should use.
 * @param agent - the receiving agent from the command invocation.
 * @returns the resolved route, or `undefined` when neither source offers one.
 */
export function resolveSelection(agent) {
  const logged = sessionConfig(agent)
  if (isUsable(logged)) {
    return {
      provider: logged.provider,
      model: logged.model,
      ...(logged.reasoningEffort === undefined ? {} : { reasoningEffort: logged.reasoningEffort }),
      source: 'session',
    }
  }

  const options = agent !== undefined && agent !== null ? agent.options : undefined
  if (isUsable(options)) {
    return {
      provider: options.provider,
      model: options.model,
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
      source: 'agent',
    }
  }

  return undefined
}

/**
 * Read the session id an auxiliary call should be stamped with.
 * @param agent - the receiving agent.
 * @returns the session id, or `undefined` when unavailable.
 */
export function sessionIdOf(agent) {
  const session = agent !== undefined && agent !== null ? agent.session : undefined
  const id = session !== undefined && session !== null ? session.id : undefined
  return typeof id === 'string' && id.length > 0 ? id : undefined
}
