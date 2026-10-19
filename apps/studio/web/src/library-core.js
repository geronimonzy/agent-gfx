// The machine Library (docs/LOOKS.md §3): path guards (twin of src-tauri/src/library.rs, same rules, same tests) and pure
// helpers of the Library page (LOOK.md frontmatter, preset colours, palette entries, the "new look" brief).

export const MAX_TEXT = 1024 * 1024;
export const MAX_THUMB = 20 * 1024 * 1024;
export const MAX_REF = 200 * 1024 * 1024;
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'];
export const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'];
const TEXT_EXT = ['md', 'js', 'json', 'txt'];
/** Videos library_read_bytes serves from a look (preview.mp4, video refs) besides images (twin of library.rs BYTES_VIDEO_EXT). */
export const BYTES_VIDEO_EXT = ['mp4', 'webm'];

/** A look id / preset / palette name (runner/lib/looks.js SLUG). */
export const validId = (s) => typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(s);
export const validSegment = (s) => typeof s === 'string' && s.length > 0 && [...s].length <= 128 && !s.startsWith('.') && !/[. ]$/.test(s)
  // eslint-disable-next-line no-control-regex
  && !/[\u0000-\u001f\u007f/\\:*?"<>|]/.test(s);
export const extOf = (name) => { const m = /\.([^./\\]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; };
export const isImage = (name) => IMAGE_EXT.includes(extOf(name));
export const isMedia = (name) => isImage(name) || VIDEO_EXT.includes(extOf(name));

/** Twin of lib.rs normalize_rel: forward slashes, no absolute / drive / `..` / empty. */
export function normalizeRel(rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('invalid path');
  const s = rel.replace(/\\/g, '/');
  if (s.startsWith('/') || s.includes(':')) throw new Error(`absolute path not allowed: ${rel}`);
  const parts = [];
  for (const p of s.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') throw new Error(`path escapes root: ${rel}`);
    parts.push(p);
  }
  if (!parts.length) throw new Error('empty path');
  return parts;
}

/** -> { parts, kind: 'lookDir' | 'lookFile' | 'preset' | 'palette' } */
export function checkLibRel(rel) {
  const parts = normalizeRel(rel);
  const bad = () => new Error(`not a Library path (looks/<id>/…, presets/<name>.js, palettes/<name>.json): ${rel}`);
  if (parts[0] === 'looks' && parts.length >= 2 && validId(parts[1])) {
    if (parts.length === 2) return { parts, kind: 'lookDir' };
    if (parts.length > 6 || !parts.slice(2).every(validSegment)) throw bad();
    return { parts, kind: 'lookFile' };
  }
  if (parts[0] === 'presets' && parts.length === 2 && parts[1].endsWith('.js') && validId(parts[1].slice(0, -3))) return { parts, kind: 'preset' };
  if (parts[0] === 'palettes' && parts.length === 2 && parts[1].endsWith('.json') && validId(parts[1].slice(0, -5))) return { parts, kind: 'palette' };
  if (parts[0] === 'taste' && parts.length === 2 && parts[1] === 'sounds.json') return { parts, kind: 'taste' }; // docs/SOUND-TWEAK.md §4
  throw bad();
}
export function checkLibWritable(rel) {
  const { parts, kind } = checkLibRel(rel);
  if (kind === 'lookDir') throw new Error(`not a file: ${rel}`);
  if (kind === 'lookFile' && !TEXT_EXT.includes(extOf(parts[parts.length - 1]))) throw new Error(`only text files (.md .js .json .txt) can be written: ${rel}`);
  return parts;
}
/** Twin of library.rs check_lib_bytes: an image or an mp4 / webm clip inside a look (thumb.jpg, preview.mp4, refs). */
export function checkLibBytes(rel) {
  const { parts, kind } = checkLibRel(rel);
  const e = extOf(parts[parts.length - 1]);
  if (kind !== 'lookFile' || !(IMAGE_EXT.includes(e) || BYTES_VIDEO_EXT.includes(e))) throw new Error(`only images and mp4 / webm clips inside a look can be read as bytes: ${rel}`);
  return parts;
}
export function checkLibRef(rel) {
  const { parts, kind } = checkLibRel(rel);
  if (kind !== 'lookFile' || parts.length !== 4 || parts[2] !== 'refs' || !isMedia(parts[3])) throw new Error(`references go to looks/<id>/refs/<image or video>: ${rel}`);
  return parts;
}
export function checkRefDest(rel) {
  const parts = normalizeRel(rel);
  if (parts.length === 4 && parts[0] === 'scenes' && validSegment(parts[1]) && parts[2] === 'refs' && validSegment(parts[3]) && isMedia(parts[3])) return parts;
  throw new Error(`references go to scenes/<name>/refs/<image or video>: ${rel}`);
}
export function cleanFileName(name) {
  // eslint-disable-next-line no-control-regex
  let s = String(name).replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if ([...s].length > 120) { const e = extOf(s); s = [...s].slice(0, 110).join('') + (e ? `.${e}` : ''); }
  return s || 'ref';
}
/** name, or name-2.ext, name-3.ext… not in `taken` (a Set of names). */
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name), stem = m[1] || name, ext = m[2] || '';
  for (let i = 2; i < 10000; i++) if (!taken.has(`${stem}-${i}${ext}`)) return `${stem}-${i}${ext}`;
  return `${stem}-${Date.now()}${ext}`;
}

// ---------- page helpers ----------
/** LOOK.md frontmatter: { name, description, tags } (same reader as runner/lib/looks.js lookMeta). */
export function lookMeta(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const kv = /^(\w+):\s*(.*)$/.exec(line); if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, ''); }
  const tags = meta.tags ? meta.tags.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
  return { name: meta.name || null, description: meta.description || null, tags };
}
/** Colour swatches of a preset.js text: [{ key, hex }] from its `colors: { … }` block (first 8). */
export function presetSwatches(text, max = 8) {
  const m = /colou?rs\s*:\s*\{([\s\S]*?)\}/.exec(text || '');
  if (!m) return [];
  const all = [...m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/g)].map((x) => ({ key: x[1], hex: x[2] }));
  // the key colours first (bg text accent surface), then the look's own extra keys (a candy set, sky/hills), then the
  // other standard keys (grid, muted, border, ...); a hex already shown is skipped. Max `max`.
  const KEY = ['bg', 'text', 'accent', 'surface'], STD = new Set([...KEY, 'grid', 'gridStrong', 'stroke', 'muted', 'accentSoft', 'border']);
  const order = [...KEY.map((k) => all.find((c) => c.key === k)), ...all.filter((c) => !STD.has(c.key)), ...all.filter((c) => STD.has(c.key) && !KEY.includes(c.key))].filter(Boolean);
  const seen = new Set(), out = [];
  for (const c of order) { const h = c.hex.toLowerCase(); if (seen.has(h)) continue; seen.add(h); out.push(c); if (out.length >= max) break; }
  return out;
}
/** A preset.js text with its `name:` replaced. */
export const renamePreset = (text, name) => (/name\s*:\s*['"][^'"]*['"]/.test(text) ? text.replace(/name\s*:\s*['"][^'"]*['"]/, `name: '${name}'`) : text);

/** Palette entries (sounds.json): a synth sound (`sound`, `variant`, `params`) or a library sample (`src` = a sound-library id). */
export function parsePalette(text) {
  let v;
  try { v = JSON.parse(text || '[]'); } catch (e) { throw new Error(`sounds.json is not valid JSON (${e.message})`); }
  if (!Array.isArray(v)) throw new Error('sounds.json must be a list of entries');
  return v.filter((e) => e && typeof e === 'object').map((e) => ({ ...e, role: typeof e.role === 'string' ? e.role : '', tags: Array.isArray(e.tags) ? e.tags.map(String) : [], note: typeof e.note === 'string' ? e.note : '' }));
}
/** Canonical text: one entry per line (diff-friendly, like the starter palettes); empty fields dropped. */
export function paletteText(entries) {
  const clean = entries.map((e) => {
    const o = { role: String(e.role || '').trim() };
    if (e.src) o.src = e.src; else { o.sound = e.sound; if (e.variant) o.variant = e.variant; }
    if (e.params && Object.keys(e.params).length) o.params = e.params;
    const tags = (e.tags || []).map((t) => String(t).trim()).filter(Boolean);
    if (tags.length) o.tags = tags;
    if (e.note && String(e.note).trim()) o.note = String(e.note).trim();
    for (const [k, v] of Object.entries(e)) if (!(k in o) && !['role', 'src', 'sound', 'variant', 'params', 'tags', 'note'].includes(k)) o[k] = v; // keep unknown fields
    return o;
  });
  return clean.length ? `[\n${clean.map((o) => '  ' + inline(o)).join(',\n')}\n]\n` : '[]\n';
}
/** JSON on one line with spaces after `:` and `,` (outside strings). */
function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') { const e = Object.entries(v); return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}'; }
  return JSON.stringify(v);
}

/** A blank LOOK.md (the sections of docs/LOOKS.md §2). */
export function blankLook(name, { description = '', tags = [] } = {}) {
  return `---\nname: ${name}\ndescription: ${description || 'One line: what this look feels like.'}\ntags: [${tags.join(', ')}]\n---\n\n# ${name}\n\n## Motion\n- Easing, pacing, beat length, transitions, camera.\n\n## Typography\n- Fonts, sizes, case, tracking.\n\n## Colour & style\n- Palette roles (preset.js colours), textures, shapes.\n\n## Sound\n- Character of the sound; the palette is sounds.json.\n\n## Do / Don't\n- Do: …\n- Don't: …\n\n## References\n- refs/<file>: what to take from it.\n`;
}

/** Windows / UNC paths as a WSL shell sees them (for a brief that a Claude in WSL reads). */
export function wslPath(p) {
  const s = String(p).replace(/\\/g, '/');
  let m = /^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+(\/.*)?$/i.exec(s);
  if (m) return m[1] || '/';
  m = /^([A-Za-z]):(\/.*)?$/.exec(s);
  if (m) return `/mnt/${m[1].toLowerCase()}${m[2] || ''}`;
  return p;
}

// ---------- New look with Claude (docs/LOOK-PIPELINE.md §5): looks/<id>/BRIEF.md, read by the look-design skill ----------
export const START_FROM = { prompt: 'Prompt only', references: 'References', project: 'This project', both: 'Both' };
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** BRIEF.md of a look: a small frontmatter (name, startFrom, sample) + Prompt / Notes / References / Start from sections.
 *  refs: [{ rel: 'refs/<file>' | url: 'https://…', note }]. */
export function lookBriefText({ name, prompt = '', notes = '', refs = [], startFrom = 'references', sample = true, project = '' }) {
  const sf = START_FROM[startFrom] ? startFrom : 'references';
  const proj = (sf === 'project' || sf === 'both') && oneLine(project) ? [`project: ${oneLine(project)}`] : []; // as Claude sees it (WSL path for WSL projects)
  const refLines = refs.map((r) => `- ${r.url || r.rel}${oneLine(r.note) ? ` — ${oneLine(r.note)}` : ''}`);
  const how = {
    prompt: 'the prompt only: no references, nothing to measure (skip gfx look analyze; mark every rule as your judgement)',
    references: 'the references and the prompt (gfx look analyze --refs …)',
    project: 'this project: its presets, scene code, timings and sounds (gfx look analyze --from-project); references, if any, as extra input',
    both: 'the references and this project together (gfx look analyze --refs … --from-project)',
  }[sf];
  return [
    '---', `name: ${oneLine(name)}`, `startFrom: ${sf}`, `sample: ${sample ? 'yes' : 'no'}`, ...proj, '---',
    `# Look brief: ${oneLine(name)}`,
    '<!-- Written by gfx studio (Library → New look → With Claude). The look-design skill reads it; keep the frontmatter and the headings. -->',
    '', '## Prompt', String(prompt).trim() || '(none)',
    '', '## Notes', String(notes).trim() || '(none)',
    '', '## References', ...(refLines.length ? refLines : ['- none']),
    '', '## Start from', `- ${sf}: ${how}`,
    `- Sample scene: ${sample ? 'yes (build sample/ from the test card, then gfx look preview)' : 'no (skip sample/ and the preview)'}`,
    '',
  ].join('\n');
}
/** BRIEF.md -> { name, startFrom, sample, prompt, notes, refs: [{ rel | url, note }] } (the inverse of lookBriefText). */
export function parseLookBrief(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---/.exec(t), meta = {};
  if (fm) for (const l of fm[1].split('\n')) { const kv = /^(\w+):\s*(.*)$/.exec(l); if (kv) meta[kv[1]] = kv[2].trim(); }
  const section = (h) => { const m = new RegExp(`^## ${h}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(t); return m ? m[1].trim() : ''; };
  const none = (s) => (s === '(none)' ? '' : s);
  const refs = section('References').split('\n').map((l) => /^- (\S+)(?: — (.*))?$/.exec(l.trim())).filter((m) => m && m[1] !== 'none')
    .map((m) => ({ ...(/^https?:\/\//i.test(m[1]) ? { url: m[1] } : { rel: m[1] }), note: m[2] || '' }));
  return { name: meta.name || '', startFrom: START_FROM[meta.startFrom] ? meta.startFrom : 'references', sample: meta.sample !== 'no', project: meta.project || '', prompt: none(section('Prompt')), notes: none(section('Notes')), refs };
}
/** Does the project's Claude see the Library through WSL paths? (a \\wsl.localhost project, or a Linux root with a Windows Library) */
export const wslProject = (root, libDir) => /^\\\\wsl(\.localhost|\$)\\/i.test(root || '') || (/^\//.test(root || '') && /^[A-Za-z]:/.test(libDir || ''));
/** The Library folder (or the project root) as that Claude sees it. */
export const claudeLibPath = (dir, wsl) => String(wsl ? wslPath(dir) : dir).replace(/[\\/]+$/, '');
export const makeLookMessage = (id, lib) => `Make the look ${id} from its BRIEF.md (look-design skill). Library: ${lib}`;
export const rebuildSampleMessage = (id, lib) => `Rebuild the sample scene of look ${id} (look-design skill). Library: ${lib}`;

/** What a look folder holds, from the Library listing ([{ path, size, mtime }]): media for the card and the Preview tab. */
export function lookFiles(files, id) {
  const pre = `looks/${id}/`, at = (name) => files.find((f) => f.path === pre + name) || null;
  return {
    look: !!at('LOOK.md'), brief: !!at('BRIEF.md'), thumb: at('thumb.jpg') || at('thumb.png'), preview: at('preview.mp4'),
    sample: files.some((f) => f.path.startsWith(`${pre}sample/`)), analysis: !!at('analysis.json'),
  };
}
/** A cache key that changes with the file (thumb / clip blob URLs are cached by it). */
export const fileKey = (f) => (f ? `${f.path}|${f.size}|${f.mtime}` : '');
/** The read-only fallback line under a sample row of the palette editor: "↳ synth: whoosh air" (docs/LOOK-PIPELINE.md §3). */
export function altLine(e) {
  const a = e && e.src && e.alt && typeof e.alt === 'object' ? e.alt : null;
  if (!a || typeof a.sound !== 'string' || !a.sound) return '';
  return `↳ synth: ${a.sound}${typeof a.variant === 'string' && a.variant ? ` ${a.variant}` : ''}`;
}
/** `gfx look preview --progress json` phases -> the status line. */
export const PREVIEW_PHASES = { copy: 'Copying the look into a temp project…', thumbnail: 'Rendering the thumbnail…', preview: 'Rendering the preview clip…' };
export function previewStatus(ev) {
  const base = PREVIEW_PHASES[ev?.phase];
  if (!base) return '';
  const pct = ev.total > 0 && ev.done > 0 ? Math.max(0, Math.min(100, Math.round(((ev.done || 0) / ev.total) * 100))) : null;
  return pct == null ? base : `${base.replace(/…$/, '')} ${pct}%`;
}

// ---------- Sound sources tab (docs/SOUND-LIBRARY.md §4): the engine's sound library (`gfx lib …`) ----------
export const SOUND_LICENSES = ['CC0', 'CC-BY 4.0', 'own', 'royalty-free'];
/** A source id of the engine (`gfx lib add` accepts /^[\w.-]+$/): the slug of a folder name, unique among `taken`. */
export function soundSourceId(folder, taken = []) {
  const name = String(folder || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  const base = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'sounds';
  const t = new Set(taken);
  if (!t.has(base)) return base;
  for (let i = 2; ; i++) if (!t.has(`${base}-${i}`)) return `${base}-${i}`;
}
export const validSourceId = (s) => typeof s === 'string' && /^[\w.-]{1,64}$/.test(s) && !/^\.+$/.test(s);
/** Does the project's engine run in WSL? A \\wsl.localhost project uses its distro's engine; else the app's engine. */
export const wslEngine = (root, engineInfo) => /^\\\\wsl(\.localhost|\$)\\/i.test(String(root || '')) || !!engineInfo?.wsl;
/** A picked folder as the engine sees it: a Windows engine takes it as is; a WSL engine gets `C:/x` (it maps /mnt/c
 *  itself) and the Linux path of a `\\wsl.localhost\<distro>\…` folder. */
export function engineFolder(p, { wsl = false } = {}) {
  const s = String(p || '').trim();
  if (!wsl) return s;
  if (/^\\\\wsl(\.localhost|\$)\\/i.test(s) || /^\/\/wsl(\.localhost|\$)\//i.test(s)) return wslPath(s);
  if (/^[A-Za-z]:([\\/]|$)/.test(s)) return s.replace(/\\/g, '/');
  return s;
}
/** The JSON a `--json` command printed: the whole stdout, else the last line that parses (arrays and objects). */
export function parseJsonOut(lines) {
  const all = (lines || []).join('\n').trim();
  try { if (all) return JSON.parse(all); } catch { /* log lines around it */ }
  for (const l of [...(lines || [])].reverse()) { const t = l.trim(); if (/^[[{]/.test(t)) { try { return JSON.parse(t); } catch { /* not JSON */ } } }
  return null;
}
/** `gfx lib list --json` -> { dir, sources } (an array, or { library|dir, sources }); sources normalised. */
export function soundList(json) {
  const arr = Array.isArray(json) ? json : Array.isArray(json?.sources) ? json.sources : null;
  if (!arr) return null;
  const dir = Array.isArray(json) ? '' : String(json.library?.path || (typeof json.library === 'string' ? json.library : '') || json.dir || '');
  const num = (v) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : null);
  return {
    dir,
    sources: arr.filter((s) => s && s.id).map((s) => ({
      id: String(s.id), kind: String(s.kind || 'folder'), path: s.path ? String(s.path) : '', dir: s.dir ? String(s.dir) : '', license: s.license ? String(s.license) : '',
      enabled: s.enabled !== false, files: s.files === 'missing' || s.missing ? 'missing' : num(s.files),
      indexed: num(s.indexed) ?? 0, version: num(s.version), project: s.project ? String(s.project) : '',
    })),
  };
}
/** What one Sound sources row shows: the entries text, what it allows, and its reserved status line. */
export function soundRowState(src, job = null, err = '') {
  const files = src.kind === 'synth' ? null : src.files;
  const entries = src.kind === 'synth' ? `${src.indexed} recipes` : files === 'missing' ? `${src.indexed} / missing` : `${src.indexed} / ${files ?? '?'}`;
  const readOnly = !!src.project;
  let status = { kind: 'none', text: '' };
  if (job && !job.finished) {
    const pct = job.total > 0 ? Math.max(0, Math.min(100, Math.round((job.done / job.total) * 100))) : null;
    status = { kind: 'progress', pct, text: job.total > 0 ? `Indexing ${job.done} / ${job.total}${job.rate ? ` · ${job.rate.toFixed(1)} files/s` : ''}` : 'Indexing: starting…' };
  } else if (err) status = { kind: 'error', text: err };
  else if (readOnly) status = { kind: 'note', text: 'from gfx.json (read-only here; edit library.sources there)' };
  else if (files === 'missing') status = { kind: 'warn', text: 'The folder is missing.' };
  else if (src.kind !== 'synth' && typeof files === 'number' && files > 0 && src.indexed === 0) status = { kind: 'warn', text: 'Not indexed yet: ⋯ → Re-index.' };
  else if (src.indexed > 0 && src.version != null && src.version < 2) status = { kind: 'note', text: `Index v${src.version}: re-index for tags and a better "Similar".` };
  return { entries, readOnly, canRemove: !readOnly && src.kind !== 'synth', canToggle: !readOnly, status };
}
/** Files per second of an index job, null until there is something to measure. */
export const filesPerSec = (done, t0, now) => (done > 0 && now > t0 ? done / ((now - t0) / 1000) : null);

/** Capture each palette's target and text before navigation; serialize writes and flush before leaving. */
export function paletteSaver(write, delay = 400) {
  let timer = 0, pending = null, running = Promise.resolve();
  function flush() {
    clearTimeout(timer); timer = 0;
    if (pending) {
      const { target, rel, text } = pending;
      pending = null;
      running = running.then(() => write(target, rel, text));
    }
    return running;
  }
  function capture(target) { return { target, rel: target.rel, text: paletteText(target.entries) }; }
  return {
    schedule(target) { pending = capture(target); clearTimeout(timer); timer = setTimeout(flush, delay); },
    save(target) { pending = capture(target); return flush(); },
    flush,
  };
}
