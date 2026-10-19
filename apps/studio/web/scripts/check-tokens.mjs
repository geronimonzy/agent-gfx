#!/usr/bin/env node
// Dependency-free design token gate. Import scanText/scanTree for fixtures or run this file from any cwd.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const colors = /(?<![\w&#])#[\da-f]{3,8}(?![\w-])|\b(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch|color)\s*\([^)]*\)/gi;
const named = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
const blank = (s) => s.replace(/[^\n]/g, ' ');
// Preserve offsets/line numbers. JS line comments are removed only when outside strings/templates.
function uncomment(text, css) {
  let out = '', i = 0, quote = '';
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (quote) {
      out += c; i++;
      if (c === '\\' && i < text.length) out += text[i++];
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || (!css && c === '`')) { quote = c; out += c; i++; }
    else if (c === '/' && n === '*') { const end = text.indexOf('*/', i + 2); const j = end < 0 ? text.length : end + 2; out += blank(text.slice(i, j)); i = j; }
    else if (!css && c === '/' && n === '/') { const end = text.indexOf('\n', i + 2); const j = end < 0 ? text.length : end; out += blank(text.slice(i, j)); i = j; }
    else { out += c; i++; }
  }
  return out;
}

export function scanText(file, text, allowlist = []) {
  if (/^theme\//.test(file)) return [];
  const css = file.endsWith('.css'), clean = uncomment(text, css), hits = [];
  const add = (index, literal, kind) => {
    const allowed = allowlist.some((a) => {
      if (a.file !== file || !a.reason || !a.match) return false;
      for (let at = text.indexOf(a.match); at >= 0; at = text.indexOf(a.match, at + 1)) {
        if (index >= at && index + literal.length <= at + a.match.length) return true;
      }
      return false;
    });
    if (!allowed && !hits.some((h) => h.index === index && h.kind === kind)) hits.push({ file, line: text.slice(0, index).split('\n').length, index, kind, literal });
  };
  const inspect = (value, at, property = '') => {
    for (const m of value.matchAll(colors)) add(at + m.index, m[0], 'colour literal');
    // Do not interpret token identifiers, quoted prose, or variable fallbacks as named colours.
    const plain = value;
    if (css || /color|background|border|shadow|fill|stroke|outline|decoration/i.test(property)) {
      for (const m of plain.matchAll(/(?<![\w-])[a-z]+(?![\w-])/gi)) if (named.has(m[0].toLowerCase())) add(at + m.index, m[0], 'named colour');
    }
    if (/^(?:font|font-size|fontSize)$/.test(property)) {
      for (const m of value.matchAll(/(?<![\w-])\d*\.?\d+(?:px|rem)\b/g)) add(at + m.index, m[0], 'font size');
      for (const m of value.matchAll(/\$\{([^}]+)\}(?:px|rem)\b/g)) if (!/\btok\(/.test(m[1])) add(at + m.index, m[0], 'canvas font size');
    }
    if (!css && /^(?:(?:min|max)-?(?:width|height)|width|height|minWidth|maxWidth|minHeight|maxHeight)$/.test(property)) {
      for (const m of value.matchAll(/(?<![\w-])\d*\.?\d+px\b|\$\{\s*\d+(?:\.\d+)?\s*\}px/g)) add(at + m.index, m[0], 'inline dimension');
    }
    if (/^(?:border(?:-[\w]+)?-radius|borderRadius)$/.test(property) && !/^\s*(?:inherit|initial|unset|revert)\s*$/.test(value)) {
      const unvar = value.replace(/var\([^)]*\)/g, blank);
      for (const m of unvar.matchAll(/(?<![\w-])-?\d*\.?\d+(?:px|rem|em|%)?\b/g)) add(at + m.index, m[0], 'radius');
    }
    if (/^(?:z-index|zIndex)$/.test(property)) for (const m of value.matchAll(/(?<![\w-])-?\d+\b/g)) add(at + m.index, m[0], 'z-index');
  };
  if (css) {
    for (const m of clean.matchAll(/([\w-]+)\s*:\s*([^{};]+)(?=[;}])/g)) inspect(m[2], m.index + m[0].indexOf(m[2]), m[1]);
  } else {
    // All explicit colour literals in JS, including palettes, inline HTML, styles, and canvas values.
    for (const m of clean.matchAll(colors)) add(m.index, m[0], 'colour literal');
    // CSS declaration strings in templates and object-based styles (CodeMirror), plus .style assignments.
    const declarations = /\b(color|background(?:-color|Color)?|border(?:-[\w]+)?|borderRadius|boxShadow|fill|stroke|outline|fillStyle|strokeStyle|font(?:-size|Size)?|z-index|zIndex|(?:min-|max-)?width|(?:min-|max-)?height|minWidth|maxWidth|minHeight|maxHeight)\s*[:=]\s*(?:`([^`\n]+)`|['"]([^'"\n]+)['"]|((?:\$\{[^}]*\}|[^;"'{}\n])+))/g;
    for (const m of clean.matchAll(declarations)) {
      const v = m[2] ?? m[3] ?? m[4];
      inspect(v, m.index + m[0].indexOf(v), m[1]);
    }
  }
  if (!css) {
    for (const m of clean.matchAll(/\.style\.setProperty\(\s*['"]([\w-]+)['"]\s*,\s*['"]([^'"]+)['"]/g)) inspect(m[2], m.index + m[0].lastIndexOf(m[2]), m[1]);
    for (const m of clean.matchAll(/\.style\.(?:width|height|minWidth|maxWidth|minHeight|maxHeight)\s*=\s*(\d+(?:\.\d+)?)\s*\+\s*['"]px['"]/g)) add(m.index, m[0], 'inline dimension');
    // Object styles may quote their CSS property names.
    for (const m of clean.matchAll(/['"]((?:min-|max-)?(?:width|height)|minWidth|maxWidth|minHeight|maxHeight|fontSize)['"]\s*:\s*['"]([^'"]+)['"]/g)) inspect(m[2], m.index + m[0].lastIndexOf(m[2]), m[1]);
  }
  // Only semantic tokens may cross the feature/theme boundary.
  for (const m of clean.matchAll(/var\(--p-[\w-]+\)/g)) add(m.index, m[0], 'primitive token in feature');
  return hits.sort((a, b) => a.index - b.index);
}

// Runtime custom properties intentionally supplied by JS rather than theme styles.
// Kept separate from literal exceptions so a missing design token can never be silently excused.
export const runtimeVariables = {
  '--c': 'Per-stem / element colour, assigned by timeline.js, layers.js and elements.js.',
};

export const externalConsumers = { '--dv-': 'Dockview reads these public theme properties in its bundled CSS.' };

export function tokenInventory(files, runtime = runtimeVariables) {
  const defined = new Set(), referenced = new Set(), hits = [];
  const cleanFiles = files.map(({ file, text }) => ({ file, text: uncomment(text, /\.(css|html)$/.test(file)).replace(/<!--[\s\S]*?-->/g, blank) }));
  for (const { text } of cleanFiles) for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  for (const { file, text } of cleanFiles) {
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      referenced.add(m[1]);
      if (!defined.has(m[1]) && m[2] !== ',' && !runtime[m[1]]) hits.push({ file, line: text.slice(0, m.index).split('\n').length, index: m.index, kind: 'undefined token', literal: m[1] });
    }
    // tok/getPropertyValue/setProperty and literal token inventories (including JS consumers).
    for (const m of text.matchAll(/(['"`])(--[\w-]+)\1/g)) referenced.add(m[2]);
    // Dynamic palette reads, e.g. tok(`--terminal-${name}`). Match the prefix to definitions.
    for (const m of text.matchAll(/`(--[\w-]+)\$\{/g)) for (const name of defined) if (name.startsWith(m[1])) referenced.add(name);
  }
  const external = [...defined].filter((n) => Object.keys(externalConsumers).some((prefix) => n.startsWith(prefix)));
  return { defined: [...defined].sort(), external: external.sort(), unused: [...defined].filter((n) => !referenced.has(n) && !external.includes(n)).sort(), hits };
}

export function sourceFiles(root = sourceRoot) {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name), file = relative(root, path).replaceAll('\\', '/');
      if (e.isDirectory()) walk(path);
      else if (/\.(css|js|html)$/.test(e.name)) files.push({ file, text: readFileSync(path, 'utf8') });
    }
  };
  walk(root);
  // All Vite window entrypoints, including welcome, guide and any future pop-out shell.
  for (const e of readdirSync(dirname(root), { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.html')) files.push({ file: '../' + e.name, text: readFileSync(join(dirname(root), e.name), 'utf8') });
  return files;
}
export function scanTree(root = sourceRoot, allowlist = JSON.parse(readFileSync(join(root, 'theme/allowlist.json'), 'utf8'))) {
  const files = sourceFiles(root);
  return [...files.flatMap(({ file, text }) => scanText(file, text, allowlist)), ...tokenInventory(files).hits];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = scanTree();
  for (const h of hits) console.error(`${relative(process.cwd(), sourceRoot)}/${h.file}:${h.line}: ${h.kind}: ${h.literal}`);
  if (process.argv.includes('--unused')) {
    const inventory = tokenInventory(sourceFiles());
    console.log(`Tokens: ${inventory.defined.length} defined; ${inventory.external.length} externally consumed (Dockview); ${inventory.unused.length} unused`);
    for (const name of inventory.unused) console.log(`unused: ${name}`);
  }
  console.log(`check-tokens: ${hits.length ? 'FAIL' : 'PASS'} (${hits.length} violations)`);
  process.exitCode = hits.length ? 1 : 0;
}
