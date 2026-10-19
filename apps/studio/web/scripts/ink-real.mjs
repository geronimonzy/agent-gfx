// Text-centring check, step 1: screenshot real elements at 4x (no clones: Chromium snaps baselines per element).
// usage: node apps/studio/web/scripts/ink-real.mjs <url> '[["name","css selector"], ...]'
// then:  python3 apps/studio/web/scripts/ink-glyph.py   (reads /tmp/real-index.json; see docs/DESIGN.md §6)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:5260/styleguide.html';
const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/opt/google/chrome/chrome'].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 4 });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const T = JSON.parse(process.argv[3] || '[]');
const res = [];
for (const [name, sel] of T) {
  const h = await page.$(sel);
  if (!h) { res.push({ name, err: 'not found' }); continue; }
  await h.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const file = `/tmp/real-${res.length}.png`;
  await h.screenshot({ path: file });
  const st = await h.evaluate((e) => { const cs = getComputedStyle(e); return { bt: parseFloat(cs.borderTopWidth), bb: parseFloat(cs.borderBottomWidth), h: e.getBoundingClientRect().height }; });
  res.push({ name, file, ...st });
}
fs.writeFileSync('/tmp/real-index.json', JSON.stringify(res));
await browser.close();
