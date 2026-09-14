/**
 * Browser half: put the "enhance prompt" seat in the composer toolbar.
 *
 * The registration is deliberately thin. Everything decidable is a pure
 * function in `state.js`/`transport.js`; everything visual is in
 * `component.js`; this file only wires the three platform services the seat
 * needs and states the one fact worth stating — the seat communicates with the
 * host through `remote.commands`, the only front-end-reachable channel
 * available to a third-party plugin (the client's remote faces are fixed at
 * build time, so a bespoke namespace is not an option).
 *
 * @module dsh-prompt-enhance/client
 */

import { LOCALE_NS } from '../shared/protocol.js'
import { PromptEnhanceSeat } from './component.js'
import { en, zh } from './locales.js'
import { installStyles } from './styles.js'

/** Cordis plugin name. */
export const name = 'prompt-enhance'

/**
 * Required services: the slot registry, the Remote gateway, the mounted
 * `commands` namespace, and the locale registry.
 *
 * `remote` and `remote.commands` are both required, and that is not a
 * formality: cordis resolves the parent property first, and a property the
 * declaration does not name throws `cannot get property "remote" without
 * inject`. The throw happens on the *call*, never on the mount, so a
 * declaration one name short still renders a healthy seat and only fails the
 * moment a user clicks it — reporting an unreachable host while the host was
 * never asked.
 */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/** The toolbar seat this plugin occupies — a `list` slot, session-scoped. */
const SLOT = 'conversation.input.right'

/** Cell identity inside that slot: one registration per plugin, so the plugin name is the natural id. */
const SEAT_ID = 'prompt-enhance'

/**
 * Row order within the seat. Occupied neighbours in a real profile rule this
 * number: `dsh-codex-connect` holds 10 (fast-mode toggle) and 20 (quota
 * indicator). 40 sits to their right — nearest the send button, which is where
 * an action performed *on the draft* belongs — and, unlike the PRD's original
 * 10, it cannot tie with an installed occupant, so the two never swap places
 * across boot order.
 */
const SEAT_ORDER = 40

/**
 * Install the seat.
 * @param ctx - the client root context.
 */
export function apply(ctx) {
  installStyles()
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'prompt-enhance: dictionaries')

  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: SEAT_ID,
    order: SEAT_ORDER,
    locale: LOCALE_NS,
    /* The seat's business face: one bound call. The binding is per session, so
     * a result can never be addressed to the wrong composer (AC8's other half)
     * — `execute` takes the images array (always empty: the draft is text) and
     * the caller's abort signal, which the host forwards to the provider. */
    inject: sessionId => ({
      startRewrite: (line, signal) => ctx.remote.commands.execute(sessionId, line, [], signal),
    }),
  }, PromptEnhanceSeat))
}
