// Element <-> code provenance (docs/CODE-VERSIONS.md §1). BRIDGE ONLY: the capture/render pages never import this file.
// While the bridge builds a scene it records call sites (from Error stacks; scenes are served untranspiled so lines are
// exact) of ctx.el / ctx.cue and of anime.js timeline .add/.set (prototype patch, active only during a build).
// `codeRefs` / `codeKeysAt` turn the recording + the scene's source files into the bridge `code` / `codeAt` replies.
import { createTimeline } from 'animejs';

const CONTROL = new Set(['duration', 'delay', 'ease', 'loop', 'loopDelay', 'alternate', 'reversed', 'autoplay', 'composition', 'modifier',
  'playbackEase', 'playbackRate', 'frameRate', 'id', 'keyframes', 'persist']);
const MAX_FRAMES = 8;
const WRAPPER = /^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/; // one-line arrow helper: A = (t, p) => tl.add(...)

let active = null;
let depth = 0;
let installed = false;

export function createTrace() {
  const trace = { anim: [], named: [], cues: [] };
  // buildScene calls these from ctx.el / ctx.cue (the stack then still contains the scene's call site)
  trace.el = (name, key) => { const frames = here(); if (frames.length) trace.named.push({ name, key, frames }); };
  trace.cue = (id, t) => { const frames = here(); if (frames.length) trace.cues.push({ id, t, frames }); };
  return trace;
}
/** Recording on (a trace) / off (null). Set around buildScene only. */
export const setActiveTrace = (t) => { active = t; };

/** Scene-file frames (innermost first) of an Error stack: [{ file: 'scenes/x/scene.js', line, col }]. */
export function sceneFrames(stack) {
  const out = [];
  for (const ln of String(stack || '').split('\n')) {
    const m = /(https?:\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(ln);
    if (!m) continue;
    let p;
    try { p = decodeURIComponent(new URL(m[1]).pathname); } catch { continue; }
    if (!/^\/(scenes|style)\//.test(p)) continue;
    out.push({ file: p.slice(1), line: +m[2], col: +m[3] });
    if (out.length >= MAX_FRAMES) break;
  }
  return out;
}
const here = () => sceneFrames(new Error().stack);

function children(tl) {
  const s = new Set();
  for (let c = tl._head; c; c = c._next) s.add(c);
  return s;
}

/** Patch the Timeline prototype once (add/set; call has no targets). Recording happens only while a trace is active. */
export function installAnimeTrace() {
  if (installed) return;
  installed = true;
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit || 10, 40);
  const proto = Object.getPrototypeOf(createTimeline({ autoplay: false }));
  for (const fn of ['add', 'set']) {
    const orig = proto[fn];
    proto[fn] = function (...args) {
      if (!active || depth) return orig.apply(this, args);
      const trace = active;
      depth++;
      const before = children(this);
      const frames = here();
      try { return orig.apply(this, args); }
      finally {
        depth--;
        try {
          const params = args[1];
          const els = new Set();
          let t0 = Infinity, t1 = -Infinity;
          for (let c = this._head; c; c = c._next) {
            if (before.has(c)) continue;
            for (const e of c.targets || []) if (e instanceof Element) els.add(e);
            const s = (c._offset || 0) + (c._delay || 0);
            t0 = Math.min(t0, s); t1 = Math.max(t1, s + (c.duration || 0));
          }
          if (els.size && frames.length && params && typeof params === 'object') {
            const props = Object.keys(params).filter((k) => !CONTROL.has(k) && !/^on[A-Z]/.test(k));
            trace.anim.push({ frames, els: [...els], t0: t0 / 1000, t1: t1 / 1000, props });
          }
        } catch (e) { console.warn('[gfx] provenance:', e); }
      }
    };
  }
}

// ---------------------------------------------------------------- reply building
const clip = (s) => { s = s.trim(); return s.length > 160 ? s.slice(0, 157) + '...' : s; };
const lineOf = (files, file, n) => { const f = files.get(file); return f ? f[n - 1] : undefined; };

/** First frame that is not a one-line arrow-function helper (so A(el, ...) points at the A(...) call, not its body). */
function effective(frames, files) {
  for (let i = 0; i < frames.length; i++) {
    const text = lineOf(files, frames[i].file, frames[i].line);
    if (i < frames.length - 1 && text !== undefined && WRAPPER.test(text)) continue;
    return frames[i];
  }
  return frames[0];
}
const mk = (kind, f, files, extra) => ({ kind, file: f.file, line: f.line, col: f.col || 1, snippet: clip(lineOf(files, f.file, f.line) || ''), ...extra });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RANK = { named: 0, defined: 1, styled: 2, animated: 3, sound: 4, ref: 5 };

/** files: Map(path -> string[] lines). node: the named element (null for bounds objects). */
export function codeRefs({ trace, files, key, node }) {
  const refs = [];
  const seen = new Set();
  const add = (r) => { const id = `${r.kind}|${r.file}|${r.line}`; if (seen.has(id)) return; seen.add(id); refs.push(r); };

  // ---- runtime
  const runtimeNamed = [];
  for (const n of trace.named) if (n.key === key || n.name === key) runtimeNamed.push(mk('named', effective(n.frames, files), files));

  const byLine = new Map();
  for (const a of trace.anim) {
    const direct = a.els.includes(node);
    if (!node || !(direct || a.els.some((e) => e.contains(node)))) continue;
    const f = effective(a.frames, files);
    const id = `${f.file}:${f.line}`;
    const cur = byLine.get(id);
    if (!cur) byLine.set(id, { f, t0: a.t0, t1: a.t1, props: new Set(a.props), direct, count: 1 });
    else { cur.t0 = Math.min(cur.t0, a.t0); cur.t1 = Math.max(cur.t1, a.t1); a.props.forEach((p) => cur.props.add(p)); cur.direct = cur.direct || direct; cur.count++; }
  }
  const animated = [...byLine.values()].sort((a, b) => a.t0 - b.t0)
    .map((v) => mk('animated', v.f, files, { t0: +v.t0.toFixed(4), t1: +v.t1.toFixed(4), props: [...v.props], ...(v.direct ? {} : { inherited: true }), ...(v.count > 1 ? { count: v.count } : {}) }));

  const sound = new Map();
  for (const c of trace.cues) {
    if (!(c.id === key || c.id.startsWith(key + '-'))) continue;
    const f = effective(c.frames, files);
    const id = `${f.file}:${f.line}`;
    const cur = sound.get(id);
    if (!cur) sound.set(id, { f, cue: c.id, cues: [c.id], t: c.t });
    else { cur.cues.push(c.id); cur.t = Math.min(cur.t, c.t); }
  }
  const sounds = [...sound.values()].map((v) => mk('sound', v.f, files, { cue: v.cue, ...(v.cues.length > 1 ? { cues: v.cues.slice(0, 40) } : {}), t0: +v.t.toFixed(4) }));

  // ---- static (class / id / data-gfx / ctx.el text search over the scene folder)
  const classes = node && typeof node.getAttribute === 'function' ? (node.getAttribute('class') || '').split(/\s+/).filter(Boolean) : [];
  const id = node && node.getAttribute ? node.getAttribute('id') : null;
  const k = esc(key);
  const namedRes = [new RegExp(`(?<!\\[)data-gfx\\s*=\\s*["']${k}["']`), new RegExp(`\\bel\\(\\s*['"\`]${k}['"\`]`)];
  const selKey = new RegExp(`\\[data-gfx\\s*=\\s*["']${k}["']`);
  const quoted = new RegExp(`['"\`]${k}['"\`]`);
  const lineCount = (re) => { let n = 0; for (const ls of files.values()) for (const l of ls) if (re.test(l)) n++; return n; };
  const clsRes = classes.map((c) => ({
    def: new RegExp(`(?:class(?:Name)?\\s*=\\s*["'\`][^"'\`]*|classList\\.add\\([^)]*['"])(?<![\\w-])${esc(c)}(?![\\w-])`),
    sel: new RegExp(`(?<![\\w-])\\.${esc(c)}(?![\\w-])`, 'g'),
  })).filter((r) => lineCount(r.def) <= 12); // very common classes would only add noise
  const idDef = id ? new RegExp(`\\bid\\s*=\\s*["']${esc(id)}["']`) : null;
  const idSel = id ? new RegExp(`#${esc(id)}(?![\\w-])`) : null;
  const stat = { named: [], defined: [], styled: [], ref: [] };
  for (const [file, lines] of files) {
    const isCss = /\.css$/i.test(file);
    lines.forEach((text, i) => {
      const f = { file, line: i + 1, col: 1 };
      for (const re of namedRes) { const m = re.exec(text); if (m) { f.col = m.index + 1; stat.named.push(f); return; } }
      for (const r of clsRes) { const m = r.def.exec(text); if (m) { f.col = m.index + 1; stat.defined.push(f); return; } }
      if (idDef) { const m = idDef.exec(text); if (m) { f.col = m.index + 1; stat.defined.push(f); return; } }
      for (const r of clsRes) {
        r.sel.lastIndex = 0;
        for (let m; (m = r.sel.exec(text));) {
          if (isCss || /^[^'"`;{}]*(\{|,\s*$)/.test(text.slice(m.index + m[0].length))) { f.col = m.index + 1; stat.styled.push(f); return; }
        }
      }
      if (idSel && isCss) { const m = idSel.exec(text); if (m) { f.col = m.index + 1; stat.styled.push(f); return; } }
      let m = quoted.exec(text) || selKey.exec(text);
      if (!m) for (const r of clsRes) { r.sel.lastIndex = 0; m = r.sel.exec(text); if (m) break; }
      if (m) { f.col = m.index + 1; stat.ref.push(f); }
    });
  }
  for (const r of runtimeNamed) add(r);
  for (const f of stat.named) add(mk('named', f, files));
  for (const f of stat.defined) add(mk('defined', f, files));
  for (const f of stat.styled) add(mk('styled', f, files));
  for (const r of animated) add(r);
  for (const r of sounds) add(r);
  const used = new Set(refs.map((r) => `${r.file}|${r.line}`));
  for (const f of stat.ref) if (!used.has(`${f.file}|${f.line}`)) add(mk('ref', f, files));
  return refs.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.t0 ?? 0) - (b.t0 ?? 0) || a.file.localeCompare(b.file) || a.line - b.line);
}

/** Keys of the elements created/animated/named by a source line (any recorded frame, helper frames included). */
export function codeKeysAt({ trace, file, line, keysIn }) {
  const hit = (frames) => frames.some((f) => f.file === file && f.line === line);
  const out = [];
  const push = (k) => { if (k && !out.includes(k)) out.push(k); };
  for (const n of trace.named) if (hit(n.frames)) push(n.key);
  for (const a of trace.anim) if (hit(a.frames)) for (const e of a.els) keysIn(e).forEach(push);
  return out;
}

// ---------------------------------------------------------------- object regions (docs/INSPECTOR.md §1)
// `codeRegions` answers the bridge `code` next to `refs`: the blocks of scene code that make up one named object.
//   marked:  `// @gfx key [key2…]` … `// @end` (also `/* @gfx key */ … /* @end */`, `<!-- @gfx key --> … <!-- @end -->`)
//   ref:     each ref line expanded to its enclosing statement (balanced brackets, <= 30 lines)
//   traced:  identifiers of the `ctx.el('key', …)` call -> their declaration / assignment / use lines (virtual elements)
// Lines are 1-based and inclusive. Pure functions of the files (no DOM), so tests and the CLI can share them.
const MAX_STMT = 30, MAX_REGIONS = 40, MAX_USES = 15;
const SRC = /\.(m?js|css|html?)$/i;
const ALL_PROPS = ['x', 'y', 'scale', 'rotate', 'opacity'];
const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends finally for function if import in '
  + 'instanceof let new return super switch this throw try typeof var void while with yield async await of static get set null true false undefined '
  + 'NaN Infinity ctx Math Number Object Array JSON String Boolean Date Promise Map Set window document console globalThis').split(' '));

/** Comments and string contents blanked to spaces (newlines kept, so offsets and lines stay exact). `css`: no // comments, templates or regexes. */
export function maskSource(src, css = false) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  const tpl = []; // brace depth at each open `${`
  let brace = 0, prev = '', i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (!css && c === '/' && d === '/') { let e = src.indexOf('\n', i); if (e < 0) e = n; blank(i, e); i = e; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j); i = j + 1; prev = c; continue;
    }
    if (!css && (c === '`' || (c === '}' && tpl.length && tpl[tpl.length - 1] === brace))) {
      if (c === '}') tpl.pop();
      let j = i + 1;
      while (j < n && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      if (src[j] === '$') { tpl.push(brace); i = j + 2; prev = '{'; } else { i = j + 1; prev = '`'; }
      continue;
    }
    if (!css && c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) { // regex literal
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
        j++;
      }
      blank(i + 1, j); i = j + 1; prev = '/'; continue;
    }
    if (c === '{') brace++; else if (c === '}') brace--;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/** Per-file analysis: masked text, line starts, bracket pairs and the open-bracket stack at each line start. */
function analyze(path, lines) {
  const text = lines.join('\n');
  const css = /\.css$/i.test(path), html = /\.html?$/i.test(path);
  const masked = html ? text : maskSource(text, css);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const close = new Map(), open = new Map(), stacks = [], stack = [];
  let li = 0;
  for (let i = 0; i <= masked.length; i++) {
    while (li < starts.length && starts[li] === i) { stacks.push(stack.slice()); li++; }
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') stack.push(i);
    else if (c === ')' || c === ']' || c === '}') { const o = stack.pop(); if (o !== undefined) { close.set(o, i); open.set(i, o); } }
  }
  return { path, lines, text, masked, mlines: masked.split('\n'), starts, close, open, stacks, css, html };
}
const lineAtPos = (fx, p) => { let lo = 0, hi = fx.starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (fx.starts[m] <= p) lo = m; else hi = m - 1; } return lo + 1; };
const prevSig = (s, p) => { let j = p - 1; while (j >= 0 && /\s/.test(s[j])) j--; return j; };
const nextSig = (s, p) => { let j = p + 1; while (j < s.length && /\s/.test(s[j])) j++; return j; };
/** `{` at o opens a block (not an object literal or a template interpolation). */
function isBlock(fx, o) {
  if (o === undefined || fx.masked[o] !== '{') return false;
  if (fx.css) return true;
  const j = prevSig(fx.masked, o);
  if (j < 0) return true;
  const c = fx.masked[j];
  if (c === ')' || c === ';' || c === '{' || c === '}') return true;
  if (c === '>' && fx.masked[j - 1] === '=') return true;
  if (/[\w$]/.test(c)) return ['else', 'try', 'finally', 'do'].includes(/[\w$]+$/.exec(fx.masked.slice(Math.max(0, j - 12), j + 1))[0]);
  return false;
}
const CONT = /^(?:else|catch|finally)\b|^[.,)\]?:]/; // what may follow a block `}` inside one statement
/** Lines of the statement around line L (1-based): { from, to }; just L when longer than MAX_STMT lines or not code. */
function statementAt(fx, L) {
  const one = { from: L, to: L };
  if (L < 1 || L > fx.lines.length) return one;
  if (fx.html) return htmlElement(fx, L) || one;
  const off = fx.lines[L - 1].search(/\S/);
  if (off < 0) return one;
  // inside a string / template literal (markup, CSS) or a comment: the first character is masked
  const stack = fx.stacks[L - 1] || [];
  if (fx.masked[fx.starts[L - 1] + off] !== fx.lines[L - 1][off] || fx.lines[L - 1].startsWith('${', off) || stack.some((o) => fx.masked[o] === '{' && fx.masked[o - 1] === '$')) return htmlElement(fx, L) || cssRule(fx, L);
  if (fx.css) return cssRule(fx, L);
  const p = fx.starts[L - 1] + off, s = fx.masked;
  let B = -1;
  for (let k = stack.length - 1; k >= 0; k--) if (isBlock(fx, stack[k])) { B = stack[k]; break; }
  // backwards to the previous statement boundary at this block level
  let start = B + 1;
  for (let j = p - 1; j > B; j--) {
    const c = s[j];
    if (c === ';') { start = j + 1; break; }
    if (c === ')' || c === ']' || c === '}') {
      const o = fx.open.get(j);
      if (o === undefined) continue;
      if (c === '}' && isBlock(fx, o) && !CONT.test(s.slice(nextSig(s, j), nextSig(s, j) + 8))) { start = j + 1; break; }
      j = o; // skip the whole group
    }
  }
  start = Math.min(nextSig(s, start - 1), p);
  // forwards to the end of the statement
  let end = -1, depth = 0;
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth < 0) { end = prevSig(s, j); break; }
      if (depth === 0 && c === '}' && isBlock(fx, fx.open.get(j))) {
        const k = nextSig(s, j);
        if (s[k] === ';') { end = k; break; }
        if (!CONT.test(s.slice(k, k + 8))) { end = j; break; }
      }
    } else if (c === ';' && depth === 0) { end = j; break; }
    if (c === '\n' && lineAtPos(fx, j) - L > MAX_STMT) break;
  }
  if (end < 0) return one;
  const from = lineAtPos(fx, start), to = Math.max(L, lineAtPos(fx, Math.max(start, end)));
  if (from > L || to - from + 1 > MAX_STMT) return one;
  return { from, to };
}
/** A markup line opening an element (`<div …>`) -> through its closing tag (raw text, <= MAX_STMT lines); null otherwise. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function htmlElement(fx, L) {
  const m = /^\s*<([a-zA-Z][\w-]*)\b/.exec(fx.lines[L - 1]);
  if (!m || VOID.has(m[1].toLowerCase())) return null;
  const open = new RegExp(`<${m[1]}\\b[^>]*?(/?)>|<${m[1]}\\b[^>]*$`, 'g'), close = new RegExp(`</${m[1]}\\s*>`, 'g');
  let depth = 0;
  for (let k = L; k <= Math.min(fx.lines.length, L + MAX_STMT - 1); k++) {
    const t = fx.lines[k - 1];
    for (const o of t.matchAll(open)) if (o[1] !== '/') depth++;
    depth -= (t.match(close) || []).length;
    if (depth <= 0) return { from: L, to: k };
  }
  return null;
}
/** A CSS rule around line L (raw text: .css files and CSS inside template literals), else just the line. */
function cssRule(fx, L) {
  const ls = fx.lines, one = { from: L, to: L };
  const opens = (t) => (t.match(/\{/g) || []).length, closes = (t) => (t.match(/\}/g) || []).length;
  const t = ls[L - 1];
  if (opens(t) === closes(t) && opens(t)) return one; // a one-line rule
  let from = L;
  if (opens(t) <= closes(t)) { // inside a rule: find its selector line above
    from = 0;
    for (let k = L - 1; k >= Math.max(1, L - 10); k--) {
      const u = ls[k - 1];
      if (opens(u) > closes(u)) { from = k; break; }
      if (closes(u)) break;
    }
    if (!from) return one;
    if (closes(t) > opens(t)) return { from, to: L };
  }
  for (let k = L + 1; k <= Math.min(ls.length, from + MAX_STMT - 1); k++) {
    const u = ls[k - 1];
    if (closes(u) > opens(u)) return { from, to: k };
    if (opens(u) > closes(u)) return from === L ? one : { from, to: k - 1 };
  }
  return one;
}

/** Marker blocks of one file: [{ file, from, to, keys, unterminated }]. A new @gfx while one is open ends it (no nesting). */
const MARK_START = /(?:\/\/|\/\*|<!--)\s*@gfx\s+(.*?)\s*(?:\*\/|-->|$)/;
const MARK_END = /(?:\/\/|\/\*|<!--)\s*@end\b/;
export function markerBlocks(file, lines) {
  const out = [];
  let cur = null;
  lines.forEach((text, i) => {
    const n = i + 1;
    const ms = MARK_START.exec(text);
    if (ms) {
      if (cur) { cur.to = n - 1; cur.unterminated = true; out.push(cur); }
      cur = { file, from: n, to: n, keys: ms[1].split(/\s+/).filter(Boolean), unterminated: false };
      if (MARK_END.test(text.slice(ms.index + ms[0].length))) { out.push(cur); cur = null; } // one-line block
      return;
    }
    if (cur && MARK_END.test(text)) { cur.to = n; out.push(cur); cur = null; }
  });
  if (cur) { cur.to = lines.length; cur.unterminated = true; out.push(cur); }
  return out;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Lines where identifier `id` is declared / assigned / used in a file (masked lines, word boundary, `.id` property access excluded). */
function idLines(fx, id) {
  const e = escRe(id);
  const word = new RegExp(`(?<![.\\w$])${e}(?![\\w$])`);
  const fnDecl = new RegExp(`\\bfunction\\s*\\*?\\s*${e}\\s*\\(|\\bclass\\s+${e}\\b|\\b(?:const|let|var)\\s+${e}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>)`);
  const inDecl = new RegExp(`(?<![.\\w$])${e}(?![\\w$])(?!\\s*:)`);
  const multi = new RegExp(`,\\s*${e}\\s*=(?![=>])`); // const A = 1, B = 2
  const assign = new RegExp(`(?<![.\\w$])${e}\\s*(?:[-+*/%]|\\*\\*|\\|\\||&&|\\?\\?)?=(?![=>])`);
  const r = { decl: [], assign: [], use: [], fn: false, imported: false };
  fx.mlines.forEach((ml, i) => {
    if (!word.test(ml)) return;
    const n = i + 1;
    if (/^\s*import\b/.test(ml)) { r.imported = true; return; }
    if (fnDecl.test(ml)) { r.decl.push(n); r.fn = true; return; }
    const vd = /\b(?:const|let|var)\s+([^=;]*)/.exec(ml);
    if ((vd && inDecl.test(vd[1])) || (vd && multi.test(ml))) { r.decl.push(n); return; }
    if (assign.test(ml)) { r.assign.push(n); return; }
    r.use.push(n);
  });
  return r;
}
/** Identifiers in masked code `s` (property names, object keys and keywords dropped). */
function identifiers(s) {
  const out = new Set();
  for (const m of s.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const id = m[0], b = s.slice(0, m.index).trimEnd(), a = s.slice(m.index + id.length).trimStart();
    if (KEYWORDS.has(id) || b.endsWith('.') || /\d$/.test(b)) continue;
    if (a.startsWith(':') && /(^|[{,])$/.test(b)) continue; // object key
    out.add(id);
  }
  return out;
}

/** Regions of one named object: { regions: [{ file, from, to, kind: 'marked'|'traced'|'ref', label }], marked, tweakable: { props, read } }.
 *  files: Map(path -> lines); refs: codeRefs() output; node: the element (null for virtual { bounds } objects). */
export function codeRegions({ files, key, refs = [], node = null }) {
  const fxs = new Map();
  const fx = (file) => { if (!fxs.has(file)) fxs.set(file, analyze(file, files.get(file) || [])); return fxs.get(file); };
  const srcFiles = [...files.keys()].filter((f) => SRC.test(f));
  const tweakable = tweakableOf(files, key, fx);

  // markers (B)
  const marks = [];
  for (const f of srcFiles) for (const b of markerBlocks(f, files.get(f))) if (b.keys.includes(key)) marks.push(b);
  if (marks.length) {
    return { regions: marks.map((b) => ({ file: b.file, from: b.from, to: b.to, kind: 'marked',
      label: `@gfx ${b.keys.join(' ')}${b.unterminated ? ' (unterminated: no @end)' : ''}` })), marked: true, tweakable };
  }

  // fallback (A): refs expanded to their statements ...
  const raw = [];
  for (const r of refs) {
    if (!files.has(r.file) || !SRC.test(r.file)) continue;
    const tt = r.t0 != null && r.t1 != null ? ` ${(+r.t0).toFixed(2)}–${(+r.t1).toFixed(2)}s` : r.cue ? ` ${r.cue}` : '';
    raw.push({ file: r.file, ...statementAt(fx(r.file), r.line), kind: 'ref', label: r.kind + tt });
  }
  // ... plus the identifiers of the ctx.el call (virtual elements; DOM elements only when the refs show no definition/style/animation)
  const dom = !!node && typeof node.getAttribute === 'function';
  if (!dom || !refs.some((r) => ['defined', 'styled', 'animated'].includes(r.kind))) raw.push(...traceRegions(key, fx, srcFiles));

  // merge overlapping / touching regions per file (a ref region stays 'ref'), cap
  const order = new Map(srcFiles.map((f, i) => [f, i]));
  raw.sort((a, b) => (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9) || a.from - b.from || b.to - a.to);
  const regions = [];
  for (const r of raw) {
    const last = regions[regions.length - 1];
    if (last && last.file === r.file && r.from <= last.to + 1) {
      last.to = Math.max(last.to, r.to);
      if (r.kind === 'ref') last.kind = 'ref';
      if (!last.label.split(' · ').includes(r.label)) last.label += ` · ${r.label}`;
    } else regions.push({ ...r });
  }
  for (const r of regions) if (r.label.length > 90) r.label = r.label.slice(0, 87) + '...';
  return { regions: regions.slice(0, MAX_REGIONS), marked: false, tweakable };
}

/** `ctx.el('key', …)` calls -> identifiers -> their declaration / assignment / use statements (kind 'traced'). Identifiers named like
 *  the key (moon, MOON_R, moonTexture) are traced fully, also one level further; others contribute their declaration only. */
function traceRegions(key, fx, srcFiles) {
  const nk = norm(key);
  const call = new RegExp(`\\bel\\(\\s*(['"\`])${escRe(key)}\\1`);
  const jsFiles = srcFiles.filter((f) => /\.m?js$/i.test(f));
  const ids = [], out = [], lines = []; // ids: [{ f, id }] (an identifier is resolved in the file that uses it)
  for (const f of jsFiles) {
    const x = fx(f);
    x.lines.forEach((text, i) => {
      const m = call.exec(text);
      if (!m || x.masked[x.starts[i] + m.index] !== 'e') return; // commented out
      const o = x.starts[i] + m.index + 2, c = x.close.get(o);
      for (const id of identifiers(x.masked.slice(o + 1, c ?? o + 1 + text.length))) ids.push({ f, id });
      lines.push({ f, n: i + 1, label: `ctx.el('${key}')` });
    });
  }
  const sim = (id) => { const n = norm(id); return !!n && (n.includes(nk) || (n.length >= 3 && nk.includes(n))); };
  const info = new Map();
  const infoOf = ({ f, id }) => {
    const k = `${f}|${id}`;
    if (!info.has(k)) {
      const own = idLines(fx(f), id);
      // imported here -> the scene files that declare it
      const per = !own.imported ? [{ f, r: own }] : jsFiles.filter((g) => g !== f).map((g) => ({ f: g, r: idLines(fx(g), id) })).filter((p) => !p.r.imported && p.r.decl.length);
      info.set(k, { per, declared: per.some((p) => p.r.decl.length), fn: per.some((p) => p.r.fn), uses: per.reduce((s, p) => s + p.r.use.length + p.r.assign.length, 0) });
    }
    return info.get(k);
  };
  // identifiers named like the key; none -> the other (non-function) identifiers of the call
  let primary = ids.filter((d) => sim(d.id) && infoOf(d).declared);
  if (!primary.length) primary = ids.filter((d) => infoOf(d).declared && !infoOf(d).fn);
  const add = (f, n, label) => { if (out.length < MAX_REGIONS * 2) out.push({ file: f, ...statementAt(fx(f), n), kind: 'traced', label }); };
  const seen = new Set();
  const full = (d) => {
    const i = infoOf(d);
    if (seen.has(i)) return;
    seen.add(i);
    for (const { f, r } of i.per) {
      r.decl.forEach((n) => add(f, n, d.id));
      if (i.uses <= MAX_USES) [...r.assign, ...r.use].forEach((n) => add(f, n, d.id));
    }
  };
  lines.forEach((l) => add(l.f, l.n, l.label));
  primary.forEach(full);
  // one level further: identifiers named like the key inside the statements found so far (moonTexture in `moon = new Mesh(…)`)
  const more = [];
  for (const r of out) {
    const ml = fx(r.file).mlines.slice(r.from - 1, r.to).join('\n');
    for (const id of identifiers(ml)) if (sim(id) && infoOf({ f: r.file, id }).declared) more.push({ f: r.file, id });
  }
  more.forEach(full);
  return out;
}

/** Static check of the scene's `ctx.tweak('key')` reads -> { props, read }. Reads: `.scale`, `?.x`, `['y']`, destructuring, a variable's
 *  property reads; the whole tweak object passed on (or used otherwise) counts as all of x, y, scale, rotate, opacity. */
function tweakableOf(files, key, fx) {
  const re = new RegExp(`(?:\\.|(?<![\\w$]))tweak\\(\\s*(['"\`])${escRe(key)}\\1\\s*\\)`, 'g');
  const props = new Set();
  let read = false;
  const addAll = () => ALL_PROPS.forEach((p) => props.add(p));
  const prop = (s) => { const m = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)|^\s*(?:\?\.)?\[\s*['"`]([\w$]+)['"`]\s*\]/.exec(s); return m && (m[1] || m[2]); };
  for (const f of files.keys()) {
    if (!/\.m?js$/i.test(f)) continue;
    const x = fx(f);
    for (const m of x.text.matchAll(re)) {
      const at = m.index + (m[0][0] === '.' ? 1 : 0);
      if (x.masked[at] !== 't') continue; // commented out / inside a string
      read = true;
      const end = m.index + m[0].length;
      const p = prop(x.text.slice(end, end + 80));
      if (p) { props.add(p); continue; }
      const head = x.masked.slice(Math.max(0, m.index - 300), m.index).replace(/[\w$.\s]*$/, '');
      const ds = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=$/.exec(head);
      if (ds) { // const { x, y: ty, scale = 1 } = ctx.tweak('k')
        for (const part of ds[1].split(',')) { const n = part.trim().split(/\s*[:=]\s*/)[0]; if (n.startsWith('...')) addAll(); else if (n) props.add(n); }
        continue;
      }
      const vd = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=$/.exec(head);
      if (vd) { // const tw = ctx.tweak('k'); … tw.scale …
        let any = false;
        for (const u of x.masked.slice(end).matchAll(new RegExp(`(?<![.\\w$])${escRe(vd[1])}(?![\\w$])`, 'g'))) {
          any = true;
          const q = end + u.index + u[0].length, pp = prop(x.text.slice(q, q + 80));
          if (pp) props.add(pp); else addAll();
        }
        if (!any) addAll();
        continue;
      }
      addAll(); // passed on as a whole
    }
  }
  return { props: [...ALL_PROPS.filter((p) => props.has(p)), ...[...props].filter((p) => !ALL_PROPS.includes(p))], read };
}
