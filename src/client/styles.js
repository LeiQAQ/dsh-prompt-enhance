/**
 * The seat's own stylesheet, injected once as a plain `<style>` tag.
 *
 * The composer toolbar is a flex row of `display:contents` slot anchors, so the
 * seat contributes exactly one inline-flex box. Everything coloured reads a
 * platform alias token (`--dsw-alias-*`), which is what keeps the button
 * visually identical to its neighbours across themes; no hardcoded palette.
 *
 * Injecting through a `<style>` tag rather than a CSS-module import is the
 * convention for a third-party bundle here (the platform's own bundles do the
 * same), and it costs no extra dependency.
 *
 * @module dsh-prompt-enhance/client/styles
 */

/** Class names, namespaced so they cannot collide with platform or other plugin styles. */
export const CLASS = Object.freeze({
  seat: 'dpe-seat',
  button: 'dpe-button',
  spinning: 'dpe-spinning',
  failed: 'dpe-failed',
  error: 'dpe-error',
  diagnostic: 'dpe-diagnostic',
})

/** Identity of the injected tag; also the idempotence key. */
export const STYLE_TAG_ID = 'dsh-prompt-enhance/seat.css'

const CSS = [
  '.dpe-seat{display:inline-flex;align-items:center;gap:2px;min-width:0}',
  '.dpe-button{display:inline-flex;align-items:center;justify-content:center;',
  'width:28px;height:28px;padding:0;border:none;border-radius:8px;cursor:pointer;',
  'background:transparent;color:var(--dsw-alias-label-secondary);',
  'transition:background .15s ease,color .15s ease}',
  '.dpe-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);',
  'color:var(--dsw-alias-label-primary)}',
  '.dpe-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
  '.dpe-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
  '.dpe-button:disabled{opacity:.4;cursor:default}',
  '.dpe-button.dpe-failed{color:var(--dsw-alias-state-error-primary)}',
  '.dpe-spinning{animation:dpe-spin 1s linear infinite}',
  '@keyframes dpe-spin{to{transform:rotate(360deg)}}',
  '.dpe-error{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  'font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
  /* The diagnostic chip is deliberately quiet — secondary label colour, the
   * composer's own type scale, a monospace face because its content is a code
   * and not prose — and clipped, so a chatty host message cannot push the send
   * button around. The full text stays reachable through its `title`. */
  '.dpe-diagnostic{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:18px;',
  'color:var(--dsw-alias-label-secondary)}',
].join('')

/**
 * Install the seat's stylesheet, at most once per document.
 * @returns a disposer removing the tag this call created, or a no-op when the tag was already present.
 */
export function installStyles() {
  if (typeof document === 'undefined' || document.head === null) return () => {}
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-prompt-enhance'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
