// Self contained: serialized alongside the composer into T3's native renderer.
export function createComposerGlow() {
  const style = document.createElement('style')
  style.id = 'miaobi-t3-glow-style'
  style.textContent = `
    [data-miaobi-glow] {
      position:absolute;inset:0;z-index:30;border-radius:inherit;
      pointer-events:none!important;overflow:hidden;opacity:1;
      transition:opacity 160ms ease-out;contain:paint;
    }
    [data-miaobi-glow] * { pointer-events:none!important }
    [data-miaobi-glow] .miaobi-wash,
    [data-miaobi-glow] .miaobi-colors {
      position:absolute;inset:0 auto 0 0;width:200%;
      background:linear-gradient(90deg,#22d3ee 0%,#818cf8 12.5%,#e879f9 25%,#fbbf24 37.5%,#22d3ee 50%,#818cf8 62.5%,#e879f9 75%,#fbbf24 87.5%,#22d3ee 100%);
      animation:miaobi-composer-flow 3s linear infinite;
    }
    [data-miaobi-glow] .miaobi-wash { opacity:.075 }
    [data-miaobi-glow] .miaobi-rim {
      position:absolute;inset:0;border-radius:inherit;padding:1.5px;opacity:.8;
      mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
      mask-composite:exclude;
      -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
      -webkit-mask-composite:xor;
    }
    [data-miaobi-glow="leaving"] { opacity:0 }
    [data-miaobi-glow="leaving"] .miaobi-wash,
    [data-miaobi-glow="leaving"] .miaobi-colors { animation-play-state:paused }
    @keyframes miaobi-composer-flow { to { transform:translate3d(-50%,0,0) } }
    @media (prefers-color-scheme:dark) { [data-miaobi-glow] .miaobi-wash { opacity:.11 } }
    .dark [data-miaobi-glow] .miaobi-wash { opacity:.11 }
    .light [data-miaobi-glow] .miaobi-wash { opacity:.075 }
    @media (prefers-reduced-motion:reduce) {
      [data-miaobi-glow], [data-miaobi-glow] * { animation:none!important;transition:none!important }
    }
  `
  document.head.append(style)
  let layer, surface, timer, originalPosition, positioned = false, disposed = false
  const clear = () => {
    clearTimeout(timer); timer = undefined
    layer?.remove(); layer = undefined
    // Restore only the property we temporarily supplied, without undoing a host update.
    if (positioned && surface?.style.position === 'relative') {
      if (originalPosition.value) surface.style.setProperty('position', originalPosition.value, originalPosition.priority)
      else surface.style.removeProperty('position')
    }
    surface = undefined; positioned = false
  }
  const start = next => {
    if (disposed || !next?.isConnected) return
    if (surface === next && layer?.isConnected && layer.dataset.miaobiGlow === 'active') return
    clear()
    surface = next
    if (getComputedStyle(surface).position === 'static') {
      originalPosition = { value: surface.style.getPropertyValue('position'), priority: surface.style.getPropertyPriority('position') }
      surface.style.position = 'relative'; positioned = true
    }
    layer = document.createElement('div')
    layer.dataset.miaobiGlow = 'active'; layer.setAttribute('aria-hidden', 'true')
    const wash = document.createElement('div'); wash.className = 'miaobi-wash'
    const rim = document.createElement('div'); rim.className = 'miaobi-rim'
    const colors = document.createElement('div'); colors.className = 'miaobi-colors'
    rim.append(colors); layer.append(wash, rim); surface.append(layer)
  }
  const stop = ({ fade = false } = {}) => {
    if (!layer || layer.dataset.miaobiGlow === 'leaving') { if (!fade) clear(); return }
    if (!fade || matchMedia('(prefers-reduced-motion:reduce)').matches) { clear(); return }
    layer.dataset.miaobiGlow = 'leaving'
    timer = setTimeout(clear, 180)
  }
  return { start, stop, dispose() { disposed = true; clear(); style.remove() } }
}
