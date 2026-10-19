// Small popup menus (docs/LAYOUT.md §3: Panels, ⋯, tab right-click; the welcome window's row menus). One open at a time;
// Esc, a click elsewhere or window blur closes it. Styles: menu.css.
import { allDocs } from './dom.js';
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let menuEl = null, menuOff = null;
export function closeMenu() {
  menuOff?.(); menuOff = null;
  if (menuEl) { menuEl.remove(); menuEl = null; }
  for (const d of allDocs()) for (const g of d.querySelectorAll('.gfx-menu-open')) g.classList.remove('gfx-menu-open');
}
export const menuOpen = () => !!menuEl;
/** items: { label, hint?, checked?, disabled?, run } | { sep: true } | { chips: [{ label, on, run }], label }; content: a read-only popover node. */
export function openMenu(anchor, items, { onClose, content } = {}) {
  closeMenu();
  const doc = anchor?.ownerDocument || anchor?.target?.ownerDocument || document;
  const m = doc.createElement('div');
  m.className = 'gfx-menu';
  m.setAttribute('role', content ? 'dialog' : 'menu');
  if (content) { m.appendChild(content); m.tabIndex = -1; m.setAttribute('aria-label', anchor.getAttribute('aria-label') || 'Value inheritance'); }
  for (const it of items) {
    if (it.sep) { m.insertAdjacentHTML('beforeend', '<div class="gfx-menu-sep" role="separator"></div>'); continue; }
    if (it.chips) {
      const row = doc.createElement('div'); row.className = 'gfx-menu-chips';
      row.innerHTML = `<span>${esc(it.label)}</span>`;
      for (const c of it.chips) {
        const b = doc.createElement('button'); b.type = 'button'; b.textContent = c.label; b.className = c.on ? 'on' : '';
        if (c.title) b.title = c.title;
        b.dataset.v = c.value ?? c.label;
        b.onclick = (e) => { e.stopPropagation(); c.run(); if (!it.keep) closeMenu(); else for (const x of row.querySelectorAll('button')) x.classList.toggle('on', x === b); };
        row.appendChild(b);
      }
      m.appendChild(row);
      continue;
    }
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'gfx-menu-item'; b.setAttribute('role', it.checked != null ? 'menuitemcheckbox' : 'menuitem');
    if (it.id) b.dataset.id = it.id;
    if (it.checked != null) b.setAttribute('aria-checked', String(!!it.checked));
    b.disabled = !!it.disabled;
    b.innerHTML = `<i class="gfx-check">${it.checked ? '&#10003;' : ''}</i><span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}`;
    b.onclick = (e) => { e.stopPropagation(); closeMenu(); it.run?.(); };
    m.appendChild(b);
  }
  doc.body.appendChild(m);
  const atPoint = anchor instanceof doc.defaultView.MouseEvent || anchor?.clientX != null && !anchor.getBoundingClientRect;
  if (!atPoint) anchor.closest?.('.dv-groupview')?.classList.add('gfx-menu-open');
  // right-aligned under the anchor; re-placed on resize (the UI scale chips change the viewport while the menu is open)
  const place = () => {
    const vw = doc.defaultView.innerWidth, vh = doc.defaultView.innerHeight;
    let x, y;
    if (atPoint) { x = anchor.clientX; y = anchor.clientY; }
    else { const r = anchor.getBoundingClientRect(); x = r.right - m.offsetWidth; y = r.bottom + 2; }
    m.style.left = Math.round(Math.max(4, Math.min(vw - m.offsetWidth - 4, x))) + 'px';
    m.style.top = Math.round(Math.max(4, Math.min(vh - m.offsetHeight - 4, y))) + 'px';
  };
  place();
  menuEl = m;
  const away = (e) => { if (!m.contains(e.target) && !anchor.contains?.(e.target)) closeMenu(); };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); if (!atPoint) anchor.focus?.({ preventScroll: true }); return; }
    // Space/Enter activate the focused row here, before the global shortcuts (Space = play) can take the key.
    if ((e.key === ' ' || e.key === 'Enter') && m.contains(doc.activeElement) && doc.activeElement.matches('button:not(:disabled)')) {
      e.preventDefault(); e.stopImmediatePropagation(); doc.activeElement.click(); return;
    }
    if (content && [' ', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key)) { e.stopImmediatePropagation(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const buttons = [...m.querySelectorAll('button:not(:disabled)')], i = buttons.indexOf(doc.activeElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[n]?.focus({ preventScroll: true });
    buttons[n]?.scrollIntoView({ block: 'nearest' });
  };
  const w = doc.defaultView;
  const replace = () => requestAnimationFrame(place);
  w.addEventListener('resize', replace);
  // Keys work at once (a quick Esc right after opening); only the click-away listener waits, so the opening click
  // does not close the menu again.
  w.addEventListener('keydown', key, true);
  setTimeout(() => { if (menuEl === m) { doc.addEventListener('pointerdown', away, true); w.addEventListener('blur', closeMenu); } }, 0);
  menuOff = () => { doc.removeEventListener('pointerdown', away, true); w.removeEventListener('keydown', key, true); w.removeEventListener('blur', closeMenu); w.removeEventListener('resize', replace); onClose?.(); };
  (m.querySelector('button:not(:disabled)') || (content ? m : null))?.focus({ preventScroll: true });
}
