// Pure parts of the New scene window (newscene.js, docs/LOOKS.md §4): formats, kinds, take profiles, the name check and the
// BRIEF.md format (write + read back). No DOM / backend: unit-tested by newscene-core.test.js.
import { workflowFields } from './settings-core.js';
export const FORMATS = [
  { id: '16:9', label: '16:9', sub: '1080p · 1920×1080', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16', sub: 'reel · 1080×1920', w: 1080, h: 1920 },
  { id: '1:1', label: '1:1', sub: '1080×1080', w: 1080, h: 1080 },
  { id: '4:5', label: '4:5', sub: '1080×1350', w: 1080, h: 1350 },
  { id: 'custom', label: 'Custom', sub: 'W×H' },
];
export const KINDS = [
  ['auto', 'Auto', 'Claude picks the kind (scaffolded as anime)'],
  ['anime', 'anime', 'UI mockups, typography, timelines (anime.js)'],
  ['svg', 'svg', 'line art, diagrams, path draws'],
  ['canvas', 'canvas', 'particles, generative, glow (2D canvas)'],
  ['three', 'three', '3D objects, camera moves (three.js)'],
];
export const BUILTIN_PRESETS = ['dark-grid', 'nightfall']; // the engine's style/presets (no backend op lists the engine folder)
export const TAKES = { quick: 'Quick', full: 'Full', custom: 'Custom' };
export const VERIFY = {
  sheet: '1 contact sheet; stills only where the sheet shows a problem',
  stills: 'contact sheet + stills at the key beats',
  full: 'contact sheet + stills at every beat, in 2 passes',
};
export const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export const slugify = (n) => String(n || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|-+$/g, '').slice(0, 64);
export const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || 'ref';
export const refFileName = (p) => { const b = baseName(p).replace(/[^\w.-]+/g, '-').replace(/^-+/, ''); return b && b !== '.' && b !== '..' ? b : 'ref'; };
export const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s).trim());
export const isAbsPath = (s) => /^([A-Za-z]:[\\/]|\\\\|\/)/.test(String(s).trim());

/** The take defaults from the `workflow` setting (docs/LOOKS.md §1): 'quick' | 'full' | { verify, render, sound } (custom). */
export function profileDefaults(w) {
  const f = typeof w === 'string' && !['quick', 'full'].includes(w) ? workflowFields(w === 'custom' ? {} : null) : workflowFields(w);
  const verify = VERIFY[f.verify] ? f.verify : 'sheet';
  return { take: TAKES[f.profile] ? f.profile : 'quick', verify, render: f.render === true, sound: f.sound === 'always' || f.sound === true };
}
/** Defaults when the user picks a take: for Custom, the setting's own custom fields (`w`), else Quick's. */
export function takeDefaults(take, w) {
  if (take !== 'custom') return profileDefaults(take);
  return profileDefaults(w && typeof w === 'object' ? w : {});
}

/** Name check: '' = fine. */
export function nameError(name, scenes = [], editing = false) {
  const n = String(name || '');
  if (!n) return 'Give the scene a name.';
  if (n.length > 64) return 'At most 64 characters.';
  if (!NAME_RE.test(n)) return `Use lower-case letters, digits, - . _ (e.g. "${slugify(n) || 'my-scene'}").`;
  if (!editing && (scenes || []).some((s) => s.name.toLowerCase() === n.toLowerCase())) return `A scene "${n}" exists already.`;
  return '';
}

// ---------- BRIEF.md ----------
/**
 * BRIEF.md (written here, read back by "Edit brief & send again" and by the motion-graphics Brief step):
 *   # Brief: <name>
 *   <!-- comment -->
 *   ## Prompt          the user's text, as typed
 *   ## Settings        "- Key: value (explanation)" lines: Format, Kind, Style, Look, Take, Verify, Sound, Render when done
 *   ## References      "- <scenes/<name>/refs/file | https://link>" + optional " — <note>"; "- none" when empty
 * Parsing takes the first word of each Settings value; the explanation in brackets is for Claude.
 */
export function briefText(v) {
  const fmt = FORMATS.find((f) => f.id === v.format && f.id !== 'custom');
  const scaffold = v.kind === 'auto' ? 'anime' : v.kind;
  const lines = [
    `# Brief: ${v.name}`, '',
    '<!-- Written by gfx studio (New scene window, docs/LOOKS.md §4). "Edit brief & send again" reads it back: keep the',
    '     "## Prompt / ## Settings / ## References" headings and the "- Key: value" lines. -->', '',
    '## Prompt', '', v.prompt.trim(), '',
    '## Settings', '',
    `- Format: ${v.w}x${v.h}, ${v.fps} fps, ${v.dur} s${fmt ? ` (${fmt.label} ${fmt.sub.split(' · ')[0]})` : ' (custom)'}`,
    v.kind === 'auto'
      ? `- Kind: auto (scaffolded as ${scaffold} as a placeholder: choose the kind that fits the prompt; if it is another one, re-scaffold from its template)`
      : `- Kind: ${v.kind}`,
    `- Style: ${v.style}`,
    v.lookId ? `- Look: ${v.lookId} (looks/${v.lookId}/LOOK.md: read it at the brief, style, build and sound steps; use its sound palette first)` : '- Look: none (style preset only)',
    `- Take: ${v.take} (${v.take === 'quick' ? 'first take, keep it light' : v.take === 'full' ? 'the full workflow' : 'custom settings below'})`,
    `- Verify: ${v.verify} (${VERIFY[v.verify]})`,
    `- Sound: ${v.sound ? 'yes (add sound effects: sound-design)' : 'no (skip sound unless the prompt asks for it)'}`,
    `- Render when done: ${v.render ? 'yes (gfx render when the scene is verified)' : 'no (the user renders from gfx studio)'}`,
    '',
    '## References', '',
  ];
  if (!v.refs.length) lines.push('- none');
  for (const r of v.refs) lines.push(`- ${r.kind === 'link' ? r.url : r.rel}${r.note.trim() ? ` — ${r.note.trim().replace(/\s*\n\s*/g, ' ')}` : ''}`);
  return lines.join('\n') + '\n';
}

export function parseBrief(text) {
  const t = '\n' + String(text || '').replace(/\r\n?/g, '\n');
  const iP = t.indexOf('\n## Prompt\n'), iS = t.lastIndexOf('\n## Settings\n'), iR = t.lastIndexOf('\n## References\n');
  const end = (a) => [iS, iR, t.length].filter((x) => x > a).sort((x, y) => x - y)[0];
  const prompt = iP >= 0 ? t.slice(iP + 11, end(iP)).trim() : '';
  const settings = {};
  if (iS >= 0) {
    for (const l of t.slice(iS + 13, end(iS)).split('\n')) {
      const m = l.match(/^\s*-\s*([A-Za-z][\w ]*?):\s*(.*)$/);
      if (m) settings[m[1].trim().toLowerCase()] = m[2].trim();
    }
  }
  const word = (k) => (settings[k] || '').split(/[\s(,]/)[0].toLowerCase();
  const out = { prompt, settings };
  const f = settings.format || '';
  const wh = f.match(/(\d+)\s*x\s*(\d+)/i), fps = f.match(/(\d+)\s*fps/i), dur = f.match(/fps,\s*([\d.]+)\s*s\b/i);
  if (wh) { out.w = +wh[1]; out.h = +wh[2]; }
  if (fps) out.fps = +fps[1];
  if (dur) out.dur = +dur[1];
  if (settings.kind) out.kind = word('kind');
  if (settings.style) out.style = (settings.style.split(/\s/)[0] || '');
  if (settings.look) { const l = settings.look.split(/\s/)[0]; out.look = l === 'none' ? '' : l; }
  if (settings.take) out.take = word('take');
  if (settings.verify) out.verify = word('verify');
  if (settings.sound) out.sound = word('sound') === 'yes';
  if (settings['render when done']) out.render = word('render when done') === 'yes';
  out.refs = [];
  if (iR >= 0) {
    for (const l of t.slice(iR + 15).split('\n')) {
      const m = l.match(/^\s*-\s+(.+)$/);
      if (!m || m[1].trim() === 'none') continue;
      const [what, ...rest] = m[1].split(' — ');
      const note = rest.join(' — ').trim(), w = what.trim();
      out.refs.push(isUrl(w) ? { kind: 'link', url: w, note } : { kind: 'existing', rel: w, note });
    }
  }
  return out;
}


/** Pending briefs stay in the Library, but cannot be selected for a new scene. */
export function usableLooks(looks) {
  return looks.filter((x) => !x?.pending).map((x) => typeof x === 'string' ? { id: x, name: x } : { id: x?.id, name: x?.name || x?.id, description: x?.description || '' })
    .filter((x) => typeof x.id === 'string' && /^[\w.-]+$/.test(x.id));
}
