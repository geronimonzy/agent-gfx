// CodeMirror 6 for the Code workspace and the Versions diff (docs/CODE-VERSIONS.md §3/§4). Bundled (no CDN), loaded lazily
// by code.js / versions.js. One EditorView; each tab keeps its own EditorState (own undo history), swapped with setState.
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection,
  crosshairCursor, highlightSpecialChars, Decoration } from '@codemirror/view';
import { EditorState, StateEffect, StateField, EditorSelection, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, foldGutter, foldKeymap, bracketMatching, indentOnInput, codeFolding, foldEffect, unfoldEffect, unfoldAll, foldedRanges } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics, lintKeymap } from '@codemirror/lint';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { MergeView } from '@codemirror/merge';
import { tags as t } from '@lezer/highlight';

// ---------- theme (app palette, styles.css :root) ----------
const theme = EditorView.theme({
  '&': { color: 'var(--foreground)', backgroundColor: 'var(--code-background)', height: '100%', fontSize: 'var(--text-xs)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: 'round(nearest, calc(var(--code-leading) * 1em), var(--space-1))' },
  '.cm-content': { caretColor: 'var(--primary-text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary-text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-gutters': { backgroundColor: 'var(--background)', color: 'var(--muted-foreground)', border: 'none', borderRight: 'var(--space-1) solid var(--border)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--card)', color: 'var(--foreground)' },
  '.cm-activeLine': { backgroundColor: 'var(--accent)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-raised)', border: 'var(--space-1) solid var(--border)', color: 'var(--muted-foreground)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--selection)', outline: 'var(--space-1) solid var(--primary-border)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--warning-surface)' },
  '.cm-searchMatch': { backgroundColor: 'var(--warning-surface)', outline: 'var(--space-1) solid var(--warning-border)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--warning-border)' },
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--foreground)', borderTop: 'var(--space-1) solid var(--border)' },
  '.cm-panels input, .cm-panels button': { fontSize: 'var(--text-2xs)' },
  '.cm-textfield': { backgroundColor: 'var(--code-background)', border: 'var(--space-1) solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--foreground)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--surface-raised)', border: 'var(--space-1) solid var(--border)', color: 'var(--foreground)', borderRadius: 'var(--radius-sm)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', border: 'var(--space-1) solid var(--input)', color: 'var(--foreground)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--primary-border)', color: 'var(--foreground)' },
  '.cm-completionDetail': { color: 'var(--muted-foreground)', fontStyle: 'normal', marginLeft: 'var(--space-8)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--error-foreground)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--error-foreground)', textUnderlineOffset: 'calc(var(--space-2) + var(--space-1))' },
  '.cm-flash': { backgroundColor: 'var(--warning-surface)', boxShadow: 'inset calc(var(--space-2) + var(--space-1)) 0 0 var(--warning-foreground)' },
  '.cm-objline': { backgroundColor: 'var(--warning-surface)', boxShadow: 'inset var(--space-2) 0 0 var(--warning-border)' },
  '.cm-objfold': { display: 'inline-block', margin: '0 var(--space-6)', padding: '0 calc(var(--space-6) + var(--space-1))', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-raised)', border: 'var(--space-1) solid var(--border)',
    color: 'var(--muted-foreground)', font: 'var(--text-2xs)/round(nearest, calc(var(--leading-normal) * 1em), var(--space-1)) var(--font-sans)', cursor: 'pointer' },
  '.cm-objfold:hover': { color: 'var(--foreground)', borderColor: 'var(--input)' },
}, { dark: true });
const hl = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-function)' },
  { tag: [t.propertyName], color: 'var(--code-property)' },
  { tag: [t.definition(t.variableName)], color: 'var(--foreground)' },
  { tag: [t.typeName, t.className, t.tagName], color: 'var(--code-type)' },
  { tag: [t.attributeName], color: 'var(--warning-foreground)' },
  { tag: [t.heading], color: 'var(--foreground)', fontWeight: '700' },
  { tag: [t.link, t.url], color: 'var(--primary)', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' }, { tag: [t.strong], fontWeight: '700' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--muted-foreground)' },
  { tag: t.invalid, color: 'var(--error-foreground)' },
]);

// ---------- languages ----------
export function langOf(path) {
  const ext = String(path).toLowerCase().split('.').pop();
  if (['js', 'mjs', 'cjs', 'jsx', 'ts'].includes(ext)) return 'js';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  if (['md', 'markdown'].includes(ext)) return 'md';
  if (['html', 'htm', 'svg'].includes(ext)) return 'html';
  return 'text';
}
const LANG = { js: () => javascript(), css: () => css(), json: () => json(), md: () => markdown(), html: () => html() };

// ---------- completions: ctx members, style colors, common anime.js params ----------
const CTX = [
  ['root', 'scene root element'], ['width', 'scene width px'], ['height', 'scene height px'], ['fps', 'frames per second'], ['duration', 'seconds'],
  ['style', 'style preset (colors, fonts, radius, ease)'], ['meta', 'scene.json'], ['cue', '(t, sound, opts) sound cue, setup only'],
  ['el', '(name, target) name an element, setup only'], ['tweak', '(name) effective tweak'],
];
const COLORS = ['bg', 'grid', 'gridStrong', 'stroke', 'text', 'muted', 'accent', 'accentSoft', 'surface', 'border'];
const ANIME = ['opacity', 'translateX', 'translateY', 'scale', 'scaleX', 'scaleY', 'rotate', 'duration', 'delay', 'ease', 'loop', 'alternate',
  'autoplay', 'onUpdate', 'onComplete', 'stagger', 'keyframes', 'width', 'height', 'color', 'backgroundColor', 'strokeDashoffset', 'd', 'x', 'y'];
function gfxCompletions(cx) {
  const m = cx.matchBefore(/[\w$.]*$/);
  if (!m) return null;
  const txt = m.text;
  const dot = txt.lastIndexOf('.');
  if (dot >= 0) {
    const obj = txt.slice(0, dot), from = m.from + dot + 1;
    if (/(^|\.)ctx$/.test(obj)) return { from, options: CTX.map(([label, detail]) => ({ label, detail, type: 'property' })), validFor: /^\w*$/ };
    if (/colors$/.test(obj)) return { from, options: COLORS.map((label) => ({ label, type: 'constant', detail: 'style color' })), validFor: /^\w*$/ };
    if (/style$/.test(obj)) return { from, options: ['colors', 'fonts', 'radius', 'ease', 'name'].map((label) => ({ label, type: 'property' })), validFor: /^\w*$/ };
    return null;
  }
  if (!cx.explicit && txt.length < 2) return null;
  return { from: m.from, options: ANIME.map((label) => ({ label, type: 'property', detail: 'anime.js' })), validFor: /^\w*$/ };
}

// ---------- flash highlight for "open at line" ----------
const flashEffect = StateEffect.define();
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(flashEffect)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------- object view (docs/INSPECTOR.md §1c): an object's regions marked in the gutter edge, everything else folded ----------
const objEffect = StateEffect.define(); // value: [{ from, to }] doc positions, or null
const objField = StateField.define({
  create: () => null,
  update(regions, tr) {
    if (regions && tr.docChanged) regions = regions.map((r) => ({ from: tr.changes.mapPos(r.from, -1), to: Math.max(tr.changes.mapPos(r.from, -1), tr.changes.mapPos(r.to, 1)) }));
    for (const e of tr.effects) if (e.is(objEffect)) regions = e.value;
    return regions;
  },
  provide: (f) => EditorView.decorations.compute([f], (state) => {
    const regions = state.field(f);
    if (!regions) return Decoration.none;
    const deco = [], seen = new Set();
    for (const r of regions) {
      for (let n = state.doc.lineAt(r.from).number, last = state.doc.lineAt(r.to).number; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        deco.push(Decoration.line({ class: 'cm-objline' }).range(state.doc.line(n).from));
      }
    }
    return Decoration.set(deco, true);
  }),
});
const objFolding = codeFolding({
  preparePlaceholder: (state, range) => state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number + (range.from === 0 ? 1 : 0),
  placeholderDOM: (view, onclick, n) => {
    const el = document.createElement('span');
    el.className = 'cm-objfold';
    el.textContent = n ? `⋯ ${n} line${n === 1 ? '' : 's'}` : '⋯';
    el.title = 'Folded: click to unfold';
    el.onclick = onclick;
    return el;
  },
});
/** Effects that set the object regions (1-based inclusive lines; null = leave the object view) and fold everything else when `fold`. */
function objectEffects(state, lines, fold) {
  const doc = state.doc, fx = [];
  const effects = []; // existing folds are dropped first, so re-applying never stacks
  foldedRanges(state).between(0, doc.length, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
  const regions = lines ? lines.map((r) => {
    const a = Math.max(1, Math.min(doc.lines, r.from | 0)), b = Math.max(a, Math.min(doc.lines, r.to | 0));
    return { from: doc.line(a).from, to: doc.line(b).to, a, b };
  }).sort((x, y) => x.a - y.a) : null;
  effects.push(objEffect.of(regions ? regions.map(({ from, to }) => ({ from, to })) : null));
  if (regions && fold) {
    let next = 1; // first line not yet covered
    for (const r of [...regions, { a: doc.lines + 1, b: doc.lines + 1 }]) {
      if (r.a > next) { // lines next .. r.a - 1 are outside every region
        const from = next === 1 ? 0 : doc.line(next - 1).to, to = doc.line(r.a - 1).to;
        if (to > from) fx.push(foldEffect.of({ from, to }));
      }
      next = Math.max(next, r.b + 1);
    }
  }
  return [...effects, ...fx];
}
/** Object view on the active view: regions [{ from, to }] (1-based lines) or null; fold = hide everything outside them. */
export function setObject(view, lines, { fold = true } = {}) {
  view.dispatch({ effects: objectEffects(view.state, lines, fold) });
}
/** Same for a stored (inactive tab) state: returns the new state. */
export function setObjectState(state, lines, { fold = true } = {}) {
  return state.update({ effects: objectEffects(state, lines, fold) }).state;
}
/** Unfold everything (Show whole file); the regions stay marked. */
export const unfoldEverything = (view) => unfoldAll(view);
export const foldCount = (state) => foldedRanges(state).size;
/** Current object regions as 1-based line ranges ([] when the view is not an object view). */
export function objectLines(state) {
  const regions = state.field(objField, false);
  return regions ? regions.map((r) => ({ from: state.doc.lineAt(r.from).number, to: state.doc.lineAt(r.to).number })) : [];
}
/** Alt+↓ / Alt+↑: cursor to the next / previous region start (wraps). false when there are no regions (keeps move-line). */
export function jumpRegion(view, dir) {
  const regions = objectLines(view.state);
  if (!regions.length) return false;
  const cur = view.state.doc.lineAt(view.state.selection.main.head).number;
  const starts = regions.map((r) => r.from);
  const target = dir > 0 ? (starts.find((s) => s > cur) ?? starts[0]) : ([...starts].reverse().find((s) => s < cur) ?? starts[starts.length - 1]);
  gotoLine(view, target);
  return true;
}
const objKeys = Prec.high(keymap.of([{ key: 'Alt-ArrowDown', run: (v) => jumpRegion(v, 1) }, { key: 'Alt-ArrowUp', run: (v) => jumpRegion(v, -1) }]));

/** Extensions for one file. `hooks.onUpdate(update)` gets every view update (doc / selection changes). */
export function extensions(path, { readOnly = false, onUpdate } = {}) {
  const lang = langOf(path);
  return [
    objFolding, objField, objKeys,
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), dropCursor(),
    EditorState.allowMultipleSelections.of(true), indentOnInput(), syntaxHighlighting(hl, { fallback: true }), bracketMatching(),
    closeBrackets(), autocompletion({ activateOnTyping: true }), rectangularSelection(), crosshairCursor(), highlightActiveLine(),
    highlightSelectionMatches(), search({ top: true }), lintGutter(), flashField, theme, EditorView.lineWrapping,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    ...(LANG[lang] ? [LANG[lang]()] : []),
    ...(lang === 'js' ? [javascriptLanguage.data.of({ autocomplete: gfxCompletions })] : []),
    EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
    EditorState.tabSize.of(2),
    EditorView.updateListener.of((u) => onUpdate?.(u)),
  ];
}
export const makeState = (path, doc, opts) => EditorState.create({ doc, extensions: extensions(path, opts) });
export function createView(parent, state) { return new EditorView({ state, parent }); }

/** Select line `line` (1-based; through `endLine`), scroll it to the centre and flash it. */
export function gotoLine(view, line, col = 0, endLine = line) {
  const doc = view.state.doc;
  const l1 = doc.line(Math.max(1, Math.min(doc.lines, line | 0 || 1)));
  const l2 = doc.line(Math.max(l1.number, Math.min(doc.lines, endLine | 0 || l1.number)));
  const anchor = Math.min(l1.to, l1.from + Math.max(0, (col | 0) - 1));
  view.dispatch({
    selection: EditorSelection.single(anchor),
    effects: [EditorView.scrollIntoView(anchor, { y: 'center' }), flashEffect.of(Decoration.set([Decoration.line({ class: 'cm-flash' }).range(l1.from), ...(l2.number > l1.number ? [Decoration.line({ class: 'cm-flash' }).range(l2.from)] : [])]))],
  });
  view.focus();
  setTimeout(() => { try { view.dispatch({ effects: flashEffect.of(Decoration.none) }); } catch { /* view gone */ } }, 1600);
}

/** Error markers: [{ line, col?, message }] (1-based lines; out-of-range lines are clamped). */
export function setErrors(view, errs) {
  const doc = view.state.doc;
  const diags = (errs || []).map((e) => {
    const l = doc.line(Math.max(1, Math.min(doc.lines, e.line | 0 || 1)));
    const from = Math.min(l.to, l.from + Math.max(0, (e.col | 0) - 1));
    return { from, to: from < l.to ? l.to : from, severity: 'error', message: e.message || 'error', source: 'live scene' };
  });
  view.dispatch(setDiagnostics(view.state, diags));
}

/** Replace the whole document, keeping the cursor line roughly where it was. */
export function replaceDoc(view, text) {
  const head = view.state.selection.main.head, line = view.state.doc.lineAt(head).number;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  const d = view.state.doc, l = d.line(Math.min(d.lines, line));
  view.dispatch({ selection: EditorSelection.single(l.from) });
}

/** Side-by-side read-only merge view of `a` (left, older) and `b` (right, newer) in `parent`. Returns { destroy }. */
export function mergeView(parent, a, b, path) {
  const ext = [lineNumbers(), syntaxHighlighting(hl, { fallback: true }), theme, EditorState.readOnly.of(true), EditorView.editable.of(false),
    EditorView.lineWrapping, ...(LANG[langOf(path)] ? [LANG[langOf(path)]()] : [])];
  const mv = new MergeView({ a: { doc: a ?? '', extensions: ext }, b: { doc: b ?? '', extensions: ext }, parent, collapseUnchanged: { margin: 3, minSize: 6 }, gutter: true, highlightChanges: true });
  return mv;
}
