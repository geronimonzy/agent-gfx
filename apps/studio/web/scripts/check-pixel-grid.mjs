#!/usr/bin/env node
// Read-only dev diagnostic, 100% UI / panel scale. No screenshots, settings writes, scene creation or renders.
// <dev-url> [--settings] [--dialogs] [--open-dialogs] [--library] [--welcome] [--overlays]
// [--width=1280] [--height=1000]. Default widths: 1280 and 1680. Try --height=999 for centring parity.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:5177/';
const executablePath = process.env.GFX_CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/opt/google/chrome/chrome'].find(existsSync);
const numberOption = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  const value = arg ? Number(arg.split('=')[1]) : fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
};
const widths = args.some((a) => a.startsWith('--width=')) ? [numberOption('width', 1280)] : [1280, 1680];
const height = numberOption('height', 1000);
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
let failures = 0;
try {
  const page = await browser.newPage();
  // Wait for fonts and two layout frames before reading final CSS geometry.
  const settle = async (p = page) => p.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const audit = async (label, regions, { p = page, optional = false } = {}) => {
    await settle(p);
    const report = await p.evaluate((regions) => {
      const controls = 'button, input, select, .chip, kbd, [role=tab]';
      const text = 'label, p, li, td, th, h1, h2, h3, h4, h5, h6, small, .hint';
      const surfaces = '.modal, #note-pop, #toast, #live-err, .gfx-menu';
      const fractional = (v) => Math.abs(v - Math.round(v)) > 0.001;
      const path = (el) => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (!el.parentElement) return el.tagName.toLowerCase();
        const siblings = [...el.parentElement.children].filter((e) => e.tagName === el.tagName);
        return `${path(el.parentElement)} > ${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`;
      };
      const bad = [], badText = [], seen = new Set(); let count = 0, lines = 0, boxes = 0;
      for (const selector of regions) for (const region of document.querySelectorAll(selector)) for (const el of [region, ...region.querySelectorAll('*')]) {
        if (seen.has(el)) continue; seen.add(el);
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility !== 'visible' || cs.display === 'none') continue;
        if (el.matches(controls) || el.matches(surfaces)) {
          if (el.matches(controls)) count++; else boxes++;
          // Origin x matters for percentage-centred surfaces. Fluid horizontal tracks may deliberately divide widths.
          if (fractional(r.top) || fractional(r.height) || el.matches(surfaces) && fractional(r.left))
            bad.push({ selector: path(el), top: r.top, height: r.height, ...(el.matches(surfaces) ? { left: r.left } : {}) });
        }
        const directText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
        if ((el.matches(text) && el.textContent.trim()) || directText) {
          lines++;
          const leading = Number.parseFloat(cs.lineHeight);
          if (!Number.isFinite(leading) || fractional(leading)) badText.push({ selector: path(el), lineHeight: cs.lineHeight });
          // Inline glyph bounds follow font metrics; block and flex/grid item boxes expose layout origins.
          // Dialog descendants receive exactly the same checks as text elsewhere.
          // Labels inside a control are covered by the control's own box check and the ink tools (ink-int.mjs).
          const item = /flex|grid/.test(getComputedStyle(el.parentElement || el).display);
          if (!el.matches(controls) && !el.matches(surfaces) && !el.parentElement?.closest(controls) && (cs.display !== 'inline' || item) && fractional(r.top))
            bad.push({ selector: path(el), top: r.top, height: r.height });
        }
      }
      return { count, boxes, lines, bad, badText };
    }, regions);
    console.log(`${label}: ${report.count} controls, ${report.bad.length} fractional; ${report.boxes} surfaces; ${report.lines} text lines, ${report.badText.length} fractional`);
    for (const b of report.bad) console.log(`  ${b.selector}: top=${b.top}, height=${b.height}${b.left == null ? '' : `, left=${b.left}`}`);
    for (const b of report.badText) console.log(`  ${b.selector}: line-height=${b.lineHeight}`);
    if (!report.count && !report.boxes && !optional) { console.error(`  No visible controls in ${regions.join(', ')}`); failures++; }
    failures += report.bad.length + report.badText.length;
  };
  const openSettings = async (category) => {
    await page.evaluate((id) => window.__studio.openSettings(id), category);
    await page.waitForSelector('#settings-page:not([hidden])');
    await settle();
  };
  const visit = async (width) => {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.__studio && !!document.querySelector('#stage.gfx-dock'));
    await audit(`${width}px workspace`, ['#topbar', '#transport']);
    if (args.includes('--open-dialogs')) await audit(`${width}px open dialogs`, ['.modal-back:not([hidden])'], { optional: true });
    if (args.includes('--overlays')) await audit(`${width}px open overlays`, ['#note-pop', '#toast', '#live-err', '.gfx-menu'], { optional: true });
    if (args.includes('--settings')) {
      await openSettings('general');
      const pages = await page.$$eval('.sp-cats [data-page]', (els) => els.map((el) => el.dataset.page));
      for (const id of pages) {
        await page.click(`.sp-cats [data-page="${id}"]`);
        await audit(`${width}px Settings / ${id}`, ['#settings-page']);
      }
      await page.evaluate(() => window.__studio.closeSettings());
    }
    if (args.includes('--dialogs')) {
      await page.keyboard.press('Escape');
      await page.keyboard.type('?');
      await page.waitForSelector('#help-dlg:not([hidden])');
      await audit(`${width}px keys help`, ['#help-dlg']);
      await page.click('#help-dlg .kh-x');
      // The licence viewer is reached through its real Settings → About entry point.
      await openSettings('about');
      await page.click('#settings-page [data-a="licence"][data-file="LICENSE-gfx.txt"]');
      await page.waitForSelector('#licence-dlg:not([hidden])');
      await page.waitForFunction(() => document.querySelector('.lic-text')?.textContent !== 'Loading…');
      await audit(`${width}px MIT licence`, ['#licence-dlg']);
      await page.click('#licence-dlg .lic-x');
      await page.evaluate(() => window.__studio.closeSettings());
      const sceneOpen = await page.evaluate(() => !!window.__studio.S.name && !!window.__studio.S.meta);
      if (sceneOpen) {
        await page.evaluate(async () => (await import('/src/ask.js')).openAsk());
        await page.waitForSelector('#ask-dlg:not([hidden])');
        await audit(`${width}px Ask Claude`, ['#ask-dlg']);
        await page.evaluate(async () => (await import('/src/ask.js')).closeAsk());
      } else console.log(`${width}px Ask Claude: SKIP (requires an open scene)`);
      const projectOpen = await page.evaluate(() => !!window.__studio.S.projectName && !!window.__studio.S.root);
      if (projectOpen) {
        await page.evaluate(() => window.__studio.mods.newscene.openNewScene());
        await page.waitForSelector('#ns-dlg');
        await audit(`${width}px New scene`, ['#ns-dlg']);
        await page.evaluate(() => window.__studio.mods.newscene.closeNewScene());
        if (await page.evaluate(() => !!window.__studio.S.name)) {
          await page.evaluate(() => window.__studio.mods.render.openRender('setup'));
          await audit(`${width}px Render drawer`, ['#render']);
          await page.evaluate(() => window.__studio.mods.render.closeRender());
        } else console.log(`${width}px Render drawer: SKIP (requires an open scene)`);
      } else console.log(`${width}px New scene / Render: SKIP (requires an open project)`);
      // No version restore/save: just the production diff dialog with an in-memory sample.
      await page.evaluate(async () => (await import('/src/diff.js')).showDiff({ files: [{ path: 'scene.js', a: '// before\n', b: '// after\n' }] }));
      await audit(`${width}px diff`, ['#diff-dlg']);
      await page.evaluate(async () => (await import('/src/diff.js')).closeDiff());
    }
    if (args.includes('--library')) {
      await page.click('#app-menu-btn');
      await page.click('.gfx-menu [data-id="library"]');
      await page.waitForSelector('#library-page:not([hidden])');
      for (const id of await page.$$eval('.lb-nav [data-tab]', (els) => els.map((el) => el.dataset.tab))) {
        await page.click(`.lb-nav [data-tab="${id}"]`);
        await audit(`${width}px Library / ${id}`, ['#library-page']);
      }
      await page.click('#library-page [data-a="back"]');
    }
  };
  if (!args.includes('--welcome-only')) for (const width of widths) await visit(width);
  if (args.includes('--welcome') || args.includes('--welcome-only')) {
    const welcome = await browser.newPage();
    for (const width of widths) {
      await welcome.setViewport({ width, height, deviceScaleFactor: 1 });
      await welcome.goto(new URL('welcome.html', url).href, { waitUntil: 'networkidle0' });
      await welcome.waitForSelector('#wl .wl-pane');
      await audit(`${width}px welcome / home`, ['#wl'], { p: welcome });
      await welcome.click('.wl-actions [data-a="new"]');
      await audit(`${width}px welcome / templates`, ['#wl'], { p: welcome });
      const template = await welcome.$('.wl-main .wl-tpl');
      if (template) {
        await template.click();
        await welcome.waitForSelector('#nw-name');
        await audit(`${width}px welcome / name`, ['#wl'], { p: welcome });
      } else console.log(`${width}px welcome / name: SKIP (no templates available)`);
    }
    await welcome.close();
  }
} finally { await browser.close(); }
console.log(`check-pixel-grid: ${failures ? `FAIL (${failures})` : 'PASS'}`);
process.exitCode = failures ? 1 : 0;
