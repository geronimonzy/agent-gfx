// Only floating outer boxes are rounded. Descendants keep their CSS layout, including while scrolling.
const surfaces = '.modal-back > .modal, #note-pop, #toast, #live-err';
export function roundSurfaceOrigin(surface) {
  const boxes = surface ? [surface.matches(surfaces) ? surface : surface.querySelector('.modal')] : document.querySelectorAll(surfaces);
  for (const box of boxes) {
    if (!box?.isConnected || box.closest('[hidden]')) continue;
    box.style.removeProperty('translate');
    const { left, top, width, height } = box.getBoundingClientRect();
    if (!width || !height) continue;
    box.style.translate = `${Math.round(left) - left}px ${Math.round(top) - top}px`;
  }
}
window.addEventListener('resize', () => roundSurfaceOrigin());
