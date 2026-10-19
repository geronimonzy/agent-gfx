// gfx init | doctor | setup (docs/FOUNDATION.md §1-2).
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE, PROJECT_FILE, engineVersion, projectRoot, isEngineProject, projectConfig, libraryDir, samePath } from '../../paths.js';
import { findBrowser, pinnedPath, browserVersion, setupChrome, CHROME_VERSION, isWsl } from '../../browser.js';
import { ffmpegPath, ffprobePath, toolVersion, setupFfmpeg } from '../../ffmpeg.js';
import { die } from '../util.js';
import { gitInfo } from '../../version.js';
import { progress, isJson } from '../progress.js';
import { syncSkills, syncReport } from '../../skills.js';
import { effectiveWorkflow, parseWorkflow, rememberMachineWorkflow, workflowLine } from '../../workflow.js';
import { lookLine } from '../../looks.js';
import { resolveTemplate, listTemplates, copyTemplateFiles, setTemplateLibrary } from '../../templates.js';

const TEMPLATES = path.join(ENGINE, 'templates', 'projects');
/** Template refs `gfx init --template` takes: built-in ids, then `user/<id>` (docs/TEMPLATES.md §2). */
export const projectTemplates = () => listTemplates().map((t) => t.ref);

/** gfx init <dir> [--template <id>|user/<id>|<folder>] [--name "..."] */
export async function cmdInit(dir, o) {
  if (o.refresh) return refreshProject(dir, o);
  if (!dir) die('usage: gfx init <dir> [--template <id>|user/<id>|<folder>] [--name "My project"]   (templates: gfx template list)');
  const dest = path.resolve(dir);
  const tpl = o.template || 'blank';
  if (o.workflow !== undefined && !parseWorkflow(o.workflow)) machineWorkflow(dest, o.workflow); // dies with the usage
  setTemplateLibrary(o.library); // user templates: <library>/templates (docs/TEMPLATES.md §2)
  const T = resolveTemplate(tpl);
  if (!T) die(`unknown template "${tpl}" (available: ${projectTemplates().join(', ')})`);
  if (fs.existsSync(path.join(dest, PROJECT_FILE))) die(`${dest} is already a gfx project`);
  // --existing (studio: "Make it a project"): a folder that already has files; nothing that exists is overwritten
  const existing = !!o.existing && fs.existsSync(dest);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length && !existing) die(`${dest} is not empty (use --existing to add a project to it)`);
  const name = o.name || path.basename(dest);
  const ver = engineVersion().split('.');
  const keep = { recursive: true, force: !existing, errorOnExist: false };
  fs.mkdirSync(dest, { recursive: true });
  copyTemplateFiles(T.dir, dest, { force: keep.force }); // template.json / thumb / preview stay behind
  fs.mkdirSync(path.join(dest, 'scenes'), { recursive: true });
  // template.json "gfx": the look / settings a saved template carries (docs/TEMPLATES.md §1); name + engine are ours
  const carry = { ...(T.gfx?.look ? { look: T.gfx.look } : {}), ...(T.gfx?.settings ? { settings: T.gfx.settings } : {}) };
  fs.writeFileSync(path.join(dest, PROJECT_FILE), JSON.stringify({ version: 1, name, engine: `>=${ver[0]}.${ver[1]}`, ...carry }, null, 2) + '\n');
  const gi = path.join(dest, '.gitignore'), giText = fs.readFileSync(path.join(TEMPLATES, '_shared', 'gitignore'), 'utf8') + '\n.gfx/\n';
  if (existing && fs.existsSync(gi)) fs.appendFileSync(gi, '\n# gfx\n' + giText);
  else fs.writeFileSync(gi, giText);
  if (o.workflow !== undefined) machineWorkflow(dest, o.workflow);
  const md = path.join(dest, 'CLAUDE.md');
  if (!(existing && fs.existsSync(md))) fs.writeFileSync(md, claudeTemplate(dest));
  fs.mkdirSync(path.join(dest, 'out'), { recursive: true });
  writeEngineRecord(dest);
  // managed skill copies + .gfx/skills.json; --existing keeps skill files the folder already had (engine copy beside)
  const rep = await syncSkills(dest, { keepUnknown: existing });
  if (rep.kept.length) for (const l of syncReport(rep, dest)) console.log(l);
  const scenes = fs.readdirSync(path.join(dest, 'scenes')).filter((n) => fs.existsSync(path.join(dest, 'scenes', n, 'scene.json')));
  console.log(`created gfx project "${name}" in ${dest} (template ${T.source === 'folder' ? T.dir : T.ref}${scenes.length ? `, scenes: ${scenes.join(', ')}` : ''})`);
  console.log(`next: cd "${dest}" && gfx doctor   (gfx = ${path.join(ENGINE, 'bin', process.platform === 'win32' ? 'gfx.cmd' : 'gfx')}; add its folder to PATH)`);
  return [dest];
}

/**
 * `.gfx/engine.json` (machine-local, gitignored): this engine as seen from the project's shell, so Claude in any
 * terminal (T3 threads have no `gfx` on PATH) runs the right engine without searching the disk. `wsl`: the engine runs
 * in WSL and the project is on a Windows drive (Windows shells: `wsl.exe -d <wsl> -- <bin>`). gfx studio writes the
 * same file when it opens a project. Also makes sure .gitignore ignores `.gfx/` (appends the line; nothing is rewritten).
 */
export function writeEngineRecord(dest) {
  const rec = { engine: ENGINE, bin: path.join(ENGINE, 'bin', process.platform === 'win32' ? 'gfx.cmd' : 'gfx'), node: process.execPath };
  const distro = process.env.WSL_DISTRO_NAME;
  if (distro && /^\/mnt\/[a-z](\/|$)/i.test(path.resolve(dest))) rec.wsl = distro;
  rec.updated = new Date().toISOString();
  fs.mkdirSync(path.join(dest, '.gfx'), { recursive: true });
  const file = path.join(dest, '.gfx', 'engine.json');
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
  const gi = path.join(dest, '.gitignore');
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!cur.split(/\r?\n/).some((l) => ['.gfx/', '.gfx', '/.gfx/', '/.gfx'].includes(l.trim()))) fs.writeFileSync(gi, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '.gfx/\n');
  return file;
}

const BEGIN = '<!-- gfx:begin -->', END = '<!-- gfx:end -->';

/** `--workflow quick|full|<json>`: the machine default (gfx studio passes its setting), kept in .gfx/workflow.json. */
function machineWorkflow(dest, raw) {
  try { return rememberMachineWorkflow(dest, raw); } catch (e) { die(e.message); }
}

/** The project CLAUDE.md template with the name, workflow line (docs/LOOKS.md §1) and look line (§2) filled in. */
export function claudeTemplate(dest) {
  const cfg = projectConfig(dest);
  const w = effectiveWorkflow(dest, cfg);
  if (w.invalid !== undefined) console.error(`gfx: gfx.json settings.workflow ${JSON.stringify(w.invalid)} is not valid (quick, full or { verify, render, sound }); using ${w.profile}`);
  const look = lookLine(dest, cfg);
  return fs.readFileSync(path.join(TEMPLATES, '_shared', 'CLAUDE.md'), 'utf8')
    .replaceAll('{{name}}', cfg.name || path.basename(dest))
    .replaceAll('{{workflow}}', workflowLine(w))
    .replaceAll('{{look}}', look ? `- ${look}\n` : '');
}

/** Rewrite CLAUDE.md's managed block (user text outside it is kept; appended when the file has no block). */
export function writeManagedBlock(dest) {
  const tpl = claudeTemplate(dest);
  const block = tpl.slice(tpl.indexOf(BEGIN), tpl.indexOf(END) + END.length);
  const file = path.join(dest, 'CLAUDE.md');
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  let next;
  if (cur === null) next = tpl;
  else {
    const a = cur.indexOf(BEGIN), b = cur.indexOf(END);
    if (a >= 0 && b > a) next = cur.slice(0, a) + block + cur.slice(b + END.length);
    else next = cur.replace(/\s*$/, '\n\n') + block + '\n'; // old file without a block: keep it all, add the block
  }
  fs.writeFileSync(file, next);
  return { file, created: cur === null };
}

/** gfx init --refresh [<dir>] [--no-skills] [--workflow ..]: rewrite CLAUDE.md's managed block (user text outside it is
 *  kept), sync the managed skill copies (runner/lib/skills.js; not with --no-skills) and rewrite .gfx/engine.json. gfx
 *  studio runs it on open when the block or the engine's skills changed, and when the workflow setting changes. */
async function refreshProject(dir, o = {}) {
  const dest = path.resolve(dir || projectRoot());
  if (!fs.existsSync(path.join(dest, PROJECT_FILE))) die(`${dest} is not a gfx project (no ${PROJECT_FILE})`);
  if (samePath(dest, ENGINE)) die('refusing to refresh the engine itself (the engine repo is its own project)');
  if (o.workflow !== undefined) machineWorkflow(dest, o.workflow);
  const { file, created } = writeManagedBlock(dest);
  const rec = writeEngineRecord(dest);
  const sync = !o['no-skills'];
  const rep = sync ? await syncSkills(dest) : null;
  if (o.json) console.log(JSON.stringify({ project: dest, claudeMd: created ? 'created' : 'refreshed', engineJson: rec, workflow: effectiveWorkflow(dest, projectConfig(dest)), skills: rep }));
  else {
    console.log(`refreshed ${dest}: CLAUDE.md managed block${created ? ' (created)' : ''}, ${sync ? 'skills (.gfx/skills.json), ' : ''}.gfx/engine.json`);
    if (rep) for (const l of syncReport(rep, dest)) console.log('  ' + l);
  }
  return [file, rec];
}

/** `>=0.2` style range check (only >= is used for now). */
export function engineSatisfies(range, version = engineVersion()) {
  const m = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(range || '').trim());
  if (!m) return true;
  const a = version.split('.').map(Number), b = [m[1], m[2] || 0, m[3] || 0].map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  return true;
}

export async function doctorReport() {
  const project = projectRoot();
  const cfg = projectConfig(project);
  const browser = findBrowser();
  const ff = ffmpegPath(), fp = ffprobePath();
  const lib = libraryDir();
  let clap = false, sources = null;
  try {
    const C = await import('../../library/config.js');
    sources = C.loadSources().sources.map((s) => s.id);
    const { modelsPresent } = await import('../../library/indexer.js');
    clap = modelsPresent();
  } catch {}
  let vite = null;
  try { vite = (await import('vite')).version; } catch (e) { vite = { error: e.message.split('\n')[0] }; }
  const r = {
    engine: { path: ENGINE, version: engineVersion() },
    project: { path: project, gfxJson: fs.existsSync(path.join(project, PROJECT_FILE)), engineIsProject: isEngineProject(project), name: cfg.name || null, engineRange: cfg.engine || null, engineOk: engineSatisfies(cfg.engine) },
    node: { path: process.execPath, version: process.version, platform: `${process.platform}-${process.arch}` },
    vite,
    browser: browser ? { path: browser.path, kind: browser.kind, source: browser.source, exists: browser.exists, pinned: browser.source === 'pinned', version: browser.exists ? (browser.source === 'pinned' ? `chrome-headless-shell ${CHROME_VERSION}` : browserVersion(browser.path)) : null } : null,
    pinnedBrowser: (() => { const p = pinnedPath(); return { path: p, version: CHROME_VERSION, installed: !!p && fs.existsSync(p), supported: !!p, fastPrefersSystem: isWsl() }; })(),
    ffmpeg: { path: ff, version: toolVersion(ff), ffprobe: fp },
    git: gitInfo(),
    library: { path: lib, exists: fs.existsSync(lib), sources, clapModel: clap },
  };
  r.missing = [
    !(browser && browser.exists) && 'browser',
    !(ff && r.ffmpeg.version) && 'ffmpeg',
    typeof vite !== 'string' && 'vite',
    !r.project.engineOk && 'engine-version',
  ].filter(Boolean);
  r.ok = r.missing.length === 0;
  return r;
}

export async function cmdDoctor(_n, o) {
  const r = await doctorReport();
  if (o.json) console.log(JSON.stringify(r, null, 2));
  else {
    const y = (b) => (b ? 'ok     ' : 'MISSING');
    console.log(`engine   ${r.engine.path} (v${r.engine.version})`);
    console.log(`project  ${r.project.path}${r.project.engineIsProject ? ' (= engine)' : ''}${r.project.gfxJson ? '' : ' (no gfx.json)'}${r.project.engineRange ? `  engine ${r.project.engineRange}${r.project.engineOk ? '' : ' NOT SATISFIED'}` : ''}`);
    console.log(`node     ${r.node.version} ${r.node.platform}  ${r.node.path}`);
    console.log(`${y(typeof r.vite === 'string')}  vite ${typeof r.vite === 'string' ? r.vite : r.vite.error}`);
    console.log(`${y(r.browser?.exists)}  browser ${r.browser ? `${r.browser.kind} ${r.browser.path}${r.browser.version ? `  ${r.browser.version}` : ''}  [${r.browser.pinned ? 'pinned' : r.browser.source}]` : '(no Chrome/Edge found; set GFX_CHROME or run `gfx setup chrome`)'}`);
    console.log(`         pinned headless shell ${r.pinnedBrowser.installed ? `${CHROME_VERSION} at ${r.pinnedBrowser.path}` : r.pinnedBrowser.supported ? `not installed (\`gfx setup chrome\` pins ${CHROME_VERSION})` : 'not available for this platform'}${r.pinnedBrowser.fastPrefersSystem ? '; fast mode on WSL prefers system Chrome (the shell has no GPU there)' : ''}`);
    console.log(`${y(r.ffmpeg.version)}  ffmpeg ${r.ffmpeg.path ? `${r.ffmpeg.path}  ${r.ffmpeg.version || '(does not run)'}` : '(not found; run `gfx setup ffmpeg` or set GFX_FFMPEG)'}`);
    console.log(`         ffprobe ${r.ffmpeg.ffprobe || '-'}`);
    console.log(r.git ? `ok       git ${r.git.version || '(does not run)'}  ${r.git.path}` : 'optional  git not found (project versions disabled; install git or set GFX_GIT)');
    console.log(`library  ${r.library.path}${r.library.exists ? '' : ' (not created yet)'}  sources: ${(r.library.sources || []).join(', ') || '-'}  CLAP model: ${r.library.clapModel ? 'present' : 'not downloaded (first `gfx lib index` fetches it)'}`);
    console.log(r.ok ? 'all required pieces present' : `missing: ${r.missing.join(', ')}`);
  }
  if (!r.ok) process.exitCode = 1;
}

function downloadHuman() {
  const human = isJson() || !process.stderr.isTTY ? null : { last: -1 };
  return (phase, done, total) => {
    progress(phase, done, total);
    if (human && phase === 'download' && total) {
      const pct = Math.floor((done / total) * 100);
      if (pct !== human.last) { human.last = pct; process.stderr.write(`\rdownload ${pct}%  ${(done / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB`); }
      if (done >= total) process.stderr.write('\n');
    }
  };
}

/** gfx setup chrome [--force]: pinned chrome-headless-shell into <library-parent>/browsers. */
async function setupChromeCmd(o) {
  let exe;
  try { exe = await setupChrome({ log: (m) => console.log(m), progress: downloadHuman(), force: !!o.force }); } catch (e) { die(e.message); }
  console.log(`chrome-headless-shell ready: ${exe} (${CHROME_VERSION}; used by default unless GFX_CHROME is set${isWsl() ? '; fast mode on WSL still prefers system Chrome' : ''})`);
  return [exe];
}

/** gfx setup ffmpeg|chrome [--force] */
export async function cmdSetup(what, o) {
  if (what === 'chrome') return setupChromeCmd(o);
  if (what !== 'ffmpeg') die('usage: gfx setup ffmpeg|chrome [--force]');
  const have = ffmpegPath();
  if (have && toolVersion(have) && !o.force) {
    console.log(`ffmpeg already available: ${have} (${toolVersion(have)}); --force downloads anyway`);
    return [have];
  }
  const human = isJson() || !process.stderr.isTTY ? null : { last: -1 };
  const files = await setupFfmpeg({
    log: (m) => console.log(m),
    progress: (phase, done, total) => {
      progress(phase, done, total);
      if (human && phase === 'download' && total) {
        const pct = Math.floor((done / total) * 100);
        if (pct !== human.last) { human.last = pct; process.stderr.write(`\rdownload ${pct}%  ${(done / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB`); }
        if (done >= total) process.stderr.write('\n');
      }
    },
  });
  for (const f of files) console.log(f);
  const v = toolVersion(ffmpegPath());
  if (!v) die('ffmpeg was installed but does not run (another ffmpeg on PATH or GFX_FFMPEG takes precedence?)');
  console.log(`ffmpeg ready: ${ffmpegPath()} (${v})`);
  return files;
}
