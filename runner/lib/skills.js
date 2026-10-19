// Managed project skills (docs/FOUNDATION.md "Managed skills", docs/JOURNEYS.md finding 21).
// `gfx init` copies the engine's .claude/skills into the project and records what it installed in
// `.gfx/skills.json`; `gfx init --refresh` (and gfx studio on open, when the engine's skills changed) syncs:
//   - project file == engine file                → in sync (record updated)
//   - project file == recorded installed hash    → untouched: replaced with the engine's version ("updated")
//   - project file missing                       → (re)added ("added")
//   - recorded, edited by the user               → kept; engine version written to .gfx/skills-new/<path> ("kept")
//   - no record (project from before skills.json) and the file equals a version the engine's git history ever had
//                                                → untouched: replaced ("updated")
//   - no record and unknown content              → backed up to .gfx/skills-backup/<stamp>/<path>, then replaced
//                                                  ("backedUp"); with keepUnknown (gfx init --existing) kept like an edit
//   - recorded file the engine no longer has     → removed if untouched, else kept ("removed" / "keptRemoved")
// Files the project has that were never recorded and the engine doesn't have are the user's own: never touched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENGINE, engineVersion, readJson } from './paths.js';

export const engineSkillsDir = (engine = ENGINE) => path.join(engine, '.claude', 'skills');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const blobSha1 = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

const validSkillPath = (root, rel) => {
  if (!rel || path.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes('..')) return false;
  const r = path.relative(root, path.resolve(root, rel));
  return !!r && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r);
};

/** Relative paths ('/'-separated, sorted) of every file under dir. */
export function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** Fingerprint of a skills dir: sha256 over "<rel>\n<sha256>\n" per file in sorted order. The studio (Rust,
 *  `skills_outdated`) computes the same value to decide whether a sync is due. */
export function skillsHash(dir = engineSkillsDir()) {
  const h = crypto.createHash('sha256');
  for (const rel of listFiles(dir)) if (validSkillPath(dir, rel)) h.update(`${rel}\n${sha256(fs.readFileSync(path.join(dir, rel)))}\n`);
  return h.digest('hex');
}

/** Short HEAD commit of the engine checkout, or null (installed engine / no git). */
export async function engineCommit() {
  if (!fs.existsSync(path.join(ENGINE, '.git'))) return null;
  try {
    const { run } = await import('./version.js');
    const r = run(['rev-parse', '--short', 'HEAD'], { cwd: ENGINE });
    return r.code === 0 ? String(r.out).trim() || null : null;
  } catch { return null; }
}

/** Map rel → Set of git blob ids the engine's history ever had for `.claude/skills/<rel>` (empty without git). */
async function knownBlobs() {
  const map = new Map();
  if (!fs.existsSync(path.join(ENGINE, '.git'))) return map;
  try {
    const { run } = await import('./version.js');
    const r = run(['log', '--format=', '--raw', '--no-abbrev', '--no-renames', '--relative', '--', '.claude/skills'], { cwd: ENGINE });
    if (r.code !== 0) return map;
    for (const line of String(r.out).split('\n')) {
      const m = /^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) \w+\t\.claude\/skills\/(.+)$/.exec(line);
      if (!m) continue;
      const set = map.get(m[3]) || new Set();
      for (const s of [m[1], m[2]]) if (!/^0+$/.test(s)) set.add(s);
      map.set(m[3], set);
    }
  } catch {}
  return map;
}

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

/**
 * Sync `<dest>/.claude/skills` with the engine's skills (rules at the top). Writes `.gfx/skills.json`
 * `{ version: 1, engine: { version, commit }, engineHash, updated, files: { <rel>: { sha256, engine } }, last }`.
 * -> the report `{ added, updated, unchanged, kept, removed, keptRemoved, backedUp, invalid, backup, skillsNew }`.
 */
export async function syncSkills(dest, { keepUnknown = false } = {}) {
  const src = engineSkillsDir();
  const projDir = path.join(dest, '.claude', 'skills');
  const recFile = path.join(dest, '.gfx', 'skills.json');
  const newDir = path.join(dest, '.gfx', 'skills-new');
  const rec = readJson(recFile, null);
  const old = rec && rec.files && typeof rec.files === 'object' ? rec.files : null;
  const ver = { version: engineVersion(), commit: await engineCommit() };
  const tag = ver.commit ? `${ver.version}+${ver.commit}` : ver.version;
  const files = {};
  const rep = { added: [], updated: [], unchanged: [], kept: [], removed: [], keptRemoved: [], backedUp: [], invalid: [], backup: null, skillsNew: null };
  const valid = (rel) => {
    if (validSkillPath(projDir, rel)) return true;
    if (!rep.invalid.includes(rel)) rep.invalid.push(rel);
    return false;
  };
  fs.rmSync(newDir, { recursive: true, force: true });
  let blobs = null, backupDir = null;
  const write = (rel, buf) => { const f = path.join(projDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };
  const keepBeside = (rel, buf) => { const f = path.join(newDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); rep.skillsNew = newDir; };
  const engineFiles = fs.existsSync(src) ? listFiles(src).filter(valid) : [];
  for (const rel of engineFiles) {
    const buf = fs.readFileSync(path.join(src, rel)), h = sha256(buf);
    const pf = path.join(projDir, rel);
    const cur = fs.existsSync(pf) ? fs.readFileSync(pf) : null;
    const entry = old && old[rel];
    if (cur === null) { write(rel, buf); files[rel] = { sha256: h, engine: tag }; rep.added.push(rel); continue; }
    const ch = sha256(cur);
    if (ch === h) { files[rel] = entry && entry.sha256 === h ? entry : { sha256: h, engine: tag }; rep.unchanged.push(rel); continue; }
    if (keepUnknown) { files[rel] = entry || { sha256: h, engine: tag }; keepBeside(rel, buf); rep.kept.push(rel); continue; }
    if (entry) {
      if (entry.sha256 === ch) { write(rel, buf); files[rel] = { sha256: h, engine: tag }; rep.updated.push(rel); }
      else { files[rel] = entry; keepBeside(rel, buf); rep.kept.push(rel); }
      continue;
    }
    // no record for this file (project from before skills.json, or a file copied in by hand)
    if (!blobs) blobs = await knownBlobs();
    if (blobs.get(rel)?.has(blobSha1(cur))) { write(rel, buf); files[rel] = { sha256: h, engine: tag }; rep.updated.push(rel); continue; }
    backupDir = backupDir || path.join(dest, '.gfx', 'skills-backup', stamp());
    const bf = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(bf), { recursive: true });
    fs.writeFileSync(bf, cur);
    write(rel, buf);
    files[rel] = { sha256: h, engine: tag };
    rep.backedUp.push(rel);
    rep.backup = backupDir;
  }
  const inEngine = new Set(engineFiles);
  for (const [rel, entry] of Object.entries(old || {})) {
    if (!valid(rel)) continue;
    if (inEngine.has(rel)) continue;
    const pf = path.join(projDir, rel);
    if (!fs.existsSync(pf)) continue;
    if (sha256(fs.readFileSync(pf)) === entry.sha256) {
      fs.rmSync(pf);
      // drop now-empty folders up to .claude/skills
      for (let d = path.dirname(pf); d.startsWith(projDir) && d !== projDir; d = path.dirname(d)) {
        try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); } catch { break; }
      }
      rep.removed.push(rel);
    } else { files[rel] = entry; rep.keptRemoved.push(rel); }
  }
  const out = {
    version: 1, engine: ver, engineHash: skillsHash(src), updated: new Date().toISOString(), files,
    last: Object.fromEntries(Object.entries(rep).filter(([k, v]) => k !== 'unchanged' && (Array.isArray(v) ? v.length : v))),
  };
  fs.mkdirSync(path.dirname(recFile), { recursive: true });
  fs.writeFileSync(recFile, JSON.stringify(out, null, 2) + '\n');
  return rep;
}

/** One-line-per-item human report for the CLI. */
export function syncReport(rep, dest) {
  const rel = (p) => path.relative(dest, p).split(path.sep).join('/');
  const lines = [];
  const list = (a) => a.join(', ');
  if (rep.added.length) lines.push(`skills added: ${list(rep.added)}`);
  if (rep.updated.length) lines.push(`skills updated: ${list(rep.updated)}`);
  if (rep.removed.length) lines.push(`skills removed (gone from the engine): ${list(rep.removed)}`);
  if (rep.invalid.length) lines.push(`skills skipped (invalid paths): ${list(rep.invalid)}`);
  if (rep.kept.length) lines.push(`kept your edits: ${list(rep.kept)}; engine version at ${rel(rep.skillsNew)}/<path> (merge by hand)`);
  if (rep.keptRemoved.length) lines.push(`kept your edits (gone from the engine): ${list(rep.keptRemoved)}`);
  if (rep.backedUp.length) lines.push(`replaced (no install record, content unknown): ${list(rep.backedUp)}; previous copies in ${rel(rep.backup)}/`);
  if (!lines.length) lines.push('skills up to date');
  return lines;
}
