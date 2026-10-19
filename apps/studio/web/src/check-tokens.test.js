import assert from 'node:assert/strict';
import { scanText, scanTree, tokenInventory, sourceFiles } from '../scripts/check-tokens.mjs';

// Construct fixture literals so the gate also scans its own tests without exemptions.
const hex = '#' + '123abc';
const px = (n) => `${n}px`;
const fixtureRadius = 4, fixtureZ = 5;
const badCss = `.fixture { color: ${hex}; font-size: ${px(13)}; border-radius: ${px(fixtureRadius)}; z-index: ${fixtureZ}; }`;
assert.deepEqual(scanText('fixture.css', badCss).map((h) => h.kind), ['colour literal', 'font size', 'radius', 'z-index']);
assert.equal(scanText('fixture.css', `.fixture { color: ${'r' + 'ed'}; }`)[0].kind, 'named colour');
assert.equal(scanText('fixture.css', `.fixture { color: ${'rgb' + '(1 2 3)'}; }`)[0].line, 1);
for (const code of [
  `ctx.fillStyle = '${hex}'`, `el.style.color = '${hex}'`,
  `el.innerHTML = \`<div style="color:${hex}">\``, `const theme = { backgroundColor: '${hex}' }`,
  `el.style.color = '${'rebecca' + 'purple'}'`, `el.innerHTML = '<div style="color:${'r' + 'ed'}">'`,
]) assert.ok(scanText('fixture.js', code).length, code);
assert.equal(scanText('fixture.js', `// ${hex}\nconst x = '#not-a-colour'; const icon = '&#1234;';`).length, 0);
assert.ok(scanText('fixture.css', `.x { color: var(--missing, ${'r' + 'ed'}); }`).length);
assert.equal(scanText('fixture.css', `/* ${hex} */\n.fixture { color: var(--foreground); border-radius: var(--radius); z-index: var(${'--' + 'z-dialog'}); }`).length, 0);
const content = `const content = '${hex}';`;
const allow = [{ file: 'fixture.js', match: content, reason: 'Stored scene colour fixture' }];
assert.equal(scanText('fixture.js', content, allow).length, 0);
assert.ok(scanText('other.js', content, allow).length);
assert.equal(scanText('fixture.js', content + ` ctx.fillStyle = '${hex}'`, allow).length, 1);
assert.ok(scanText('fixture.js', content, [{ ...allow[0], reason: '' }]).length);
assert.ok(scanText('fixture.css', '.x { color: var(--' + 'p-palette); }').some((h) => h.kind.includes('primitive')));
// Unknown references are checked across files, including theme aliases and inline HTML/JS.
const custom = (name, fallback = '') => `var(${'--' + name}${fallback})`;
const inventory = tokenInventory([
  { file: 'theme/scale.css', text: `:root { ${'--' + 'fixture-used'}: 1px; ${'--' + 'fixture-dead'}: 2px; }` },
  { file: 'feature.css', text: `.x { width: ${custom('fixture-used')}; height: ${custom('fixture-missing')}; }` },
  { file: 'window.html', text: `<div style="width:${custom('html-missing')}"></div>` },
  { file: 'feature.js', text: `el.innerHTML = '<i style="width:${custom('js-missing')}">';` },
]);
assert.deepEqual(inventory.hits.map((h) => h.literal), ['--fixture-missing', '--html-missing', '--js-missing']);
assert.deepEqual(inventory.unused, ['--fixture-dead']);
assert.equal(tokenInventory([{ file: 'x.css', text: `.x { width: ${custom('optional', ', ' + px(1))}; color: ${custom('outer', ', ' + custom('inner', ', currentColor'))}; }` }]).hits.length, 0);
assert.equal(tokenInventory([{ file: 'x.css', text: `.x { width: ${custom('runtime')}; }` }], { '--runtime': 'Assigned by the fixture controller.' }).hits.length, 0);
assert.equal(tokenInventory([{ file: 'x.css', text: `.x { width: ${custom('runtime')}; }` }], { '--runtime': '' }).hits.length, 1);
assert.deepEqual(tokenInventory([{ file: 'x.js', text: "tok('--fixture-used');" }, { file: 'x.css', text: `:root { ${'--' + 'fixture-used'}: 1px; }` }]).unused, []);
assert.deepEqual(tokenInventory([{ file: 'x.js', text: 'tok(`--palette-${index}`);' }, { file: 'x.css', text: `:root { ${'--' + 'palette-one'}: red; ${'--' + 'palette-two'}: blue; }` }]).unused, []);
for (const code of [
  'ctx.font = ' + '`bold ' + '$' + '{Math.round(22*k)}px sans-serif`',
  `el.style.width = '${px(90)}'`,
  `el.style.cssText = 'min-height:${px(24)};'`,
  `el.innerHTML = '<div style="max-width:${px(120)}"></div>'`,
  `const styles = { maxWidth: '${px(80)}' }`,
  `const styles = { 'max-width': '${px(80)}' }`,
  `el.style.setProperty('height', '${px(24)}')`,
  `el.style.height = ${24} + 'px'`,
  'el.innerHTML = ' + '`<i style="width:' + '$' + '{24}px">`',
]) assert.ok(scanText('fixture.js', code).length, code);
assert.ok(scanText('window.html', `<input style="height:${px(24)};font-size:${px(12)}">`).length);
assert.ok(scanText('window.html', `<style>.x { font-size:${px(12)}; }</style>`).length);
assert.equal(scanText('fixture.js', "ctx.font = `bold ${Math.round(parseFloat(tok('--annotation-label-size')) * k)}px ${tok('--font-sans')}`;").length, 0);
assert.equal(scanText('fixture.js', "el.style.height = total + 'px';").length, 0, 'Runtime scene/layout dimensions remain data');
assert.ok(sourceFiles().some((f) => f.file === '../index.html'));
assert.ok(sourceFiles().some((f) => f.file === '../welcome.html'));
assert.ok(sourceFiles().some((f) => f.file === '../styleguide.html'));
assert.deepEqual(scanTree(), [], 'the real studio source must pass');
console.log('check-tokens tests: PASS');
