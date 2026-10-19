// Centring at whole-pixel positions: clone each control into a fixed container at an integer y (keeping its density
// and theme context), screenshot at 4x, write /tmp/real-index.json for ink-glyph.py. Optional y fraction as argv[4].
// usage: node apps/studio/web/scripts/ink-int.mjs <styleguide-url> '<json [[name, selector], ...]>' [fraction]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url, json, frac = '0'] = process.argv.slice(2);
const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/opt/google/chrome/chrome'].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 4 });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const res = [];
for (const [name, sel] of JSON.parse(json)) {
  const ok = await page.evaluate((sel, frac) => {
    document.getElementById('ink-int')?.remove();
    const src = document.querySelector(sel); if (!src) return false;
    const box = document.createElement('div'); box.id = 'ink-int';
    const dens = src.closest('[data-density]')?.dataset.density || 'comfortable';
    box.dataset.density = dens;
    box.style.cssText = `position:fixed;left:40px;top:${100 + Number(frac)}px;z-index:99999;background:var(--background);padding:0;display:flex;align-items:flex-start`;
    // keep the nearest wrapping context classes (e.g. .seg, .tabs) so descendant selectors still match
    src.setAttribute('data-ink', '1'); let node = src.cloneNode(true); src.removeAttribute('data-ink'); let p = src.parentElement;
    for (let i = 0; i < 3 && p && !p.hasAttribute('data-density'); i++, p = p.parentElement) {
      const w = p.cloneNode(false); w.removeAttribute('id'); w.removeAttribute('hidden'); w.style.cssText += ';position:static;display:flex;visibility:visible;opacity:1;transform:none;margin:0;inset:auto'; w.append(node); node = w;
    }
    box.append(node); document.body.append(box);
    return true;
  }, sel, frac);
  if (!ok) { res.push({ name, err: 'not found' }); continue; }
  const h = await page.$('#ink-int [data-ink]') || await page.$('#ink-int > *');
  const file = `/tmp/real-${res.length}.png`;
  try { await h.screenshot({ path: file }); } catch (e) { res.push({ name, err: e.message.slice(0, 60) }); continue; }
  const st = await h.evaluate((e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { bt: parseFloat(cs.borderTopWidth), bb: parseFloat(cs.borderBottomWidth), h: r.height, y: r.top }; });
  res.push({ name, file, ...st });
}
fs.writeFileSync('/tmp/real-index.json', JSON.stringify(res));
for (const r of res) if (r.y !== undefined) console.error(r.name, 'y=', r.y);
await browser.close();
