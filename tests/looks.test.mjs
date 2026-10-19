// Look pipeline (docs/LOOK-PIPELINE.md §1-3, §8): gfx look analyze on generated media (ffmpeg lavfi) and on a temp
// project, gfx look preview of a sample scene in a temp Library, Library-side files (hash / use / save), palette `alt`,
// inkContrast, --help, look check (starters + a broken look), preview --sheet, look audition, font CSS variables.
// Run: node tests/looks.test.mjs   (needs ffmpeg + ffprobe; the preview part needs Chrome/Edge or GFX_CHROME)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'runner', 'cli.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 600) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-looks-test-'));
const cli = (args, { cwd = tmp, env = {} } = {}) => {
  const e = { ...process.env, ...env };
  delete e.GFX_PROJECT;
  if (env.GFX_PROJECT) e.GFX_PROJECT = env.GFX_PROJECT;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: e, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const ff = (...args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { cwd: tmp, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
const lastJson = (s) => { try { return JSON.parse(s.trim().split('\n').at(-1)); } catch { return null; } };
const analyze = (files, extra = [], o) => { const r = cli(['look', 'analyze', ...files.flatMap((f) => ['--refs', f]), '--json', ...extra], o); return { ...r, j: lastJson(r.out) }; };
const byName = (j, n) => j?.refs.find((r) => r.name === n);

const A = await import('../runner/lib/look-analyze.js');
const LK = await import('../runner/lib/looks.js');
const dE = (h1, h2) => { const a = A.hexToLab(h1), b = A.hexToLab(h2); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };

try {
  console.log('colour maths');
  {
    ok(['#d97757', '#111111', '#2fb7a4', '#ffffff', '#000000'].every((h) => A.labToHex(A.hexToLab(h)) === h), 'Lab round trip keeps hex colours');
    const px = new Float64Array(3 * 200);
    for (let i = 0; i < 200; i++) { const l = A.rgbToLab(...(i < 150 ? [17, 17, 17] : [217, 119, 87])); px.set(l, i * 3); }
    const p1 = A.kmeansPalette(px), p2 = A.kmeansPalette(px);
    ok(JSON.stringify(p1) === JSON.stringify(p2) && p1.length === 2 && p1[0].hex === '#111111' && p1[0].share === 0.75 && p1[1].share === 0.25, 'k-means is seeded (same input, same palette), identical clusters merge, shares sum to 1', p1);
    ok(A.motionLabel(0.01) === 'calm' && A.motionLabel(0.05) === 'medium' && A.motionLabel(0.2) === 'kinetic', 'motion labels: calm < 0.03 < medium < 0.08 < kinetic');
    const sc = A.scanCode("tl.add('.a', { ease: 'outExpo', duration: 600 }).add('.b', { ease: \"outBack(1.4)\", duration: 300 }); const c = 'transition: opacity 0.5s cubic-bezier(.2, 0, 0, 1)'; createSpring({ stiffness: 90 }); x = { ease: outCubic };");
    ok(sc.eases.outExpo === 1 && sc.eases['outBack(1.4)'] === 1 && sc.eases['cubic-bezier(.2,0,0,1)'] === 1 && sc.eases['spring()'] === 1 && sc.eases.outCubic === 1 && sc.durations.sort((a, b) => a - b).join() === '300,500,600', 'scanCode: quoted eases, cubic-bezier, springs, bare anime names; duration literals + css seconds', sc);
  }

  console.log('analyze: images');
  ff('-f', 'lavfi', '-i', 'color=c=0xd97757:s=320x180', '-frames:v', '1', 'orange.png');
  ff('-f', 'lavfi', '-i', 'color=c=0x1030a0:s=320x180', '-frames:v', '1', 'blue.jpg');
  ff('-f', 'lavfi', '-i', 'color=c=0x808080:s=200x200', '-frames:v', '1', 'grey.webp');
  ff('-f', 'lavfi', '-i', 'color=black:s=100x100', '-f', 'lavfi', '-i', 'color=white:s=100x100', '-filter_complex', '[0][1]hstack', '-frames:v', '1', 'split.png');
  fs.writeFileSync(path.join(tmp, 'broken.png'), 'not an image');
  {
    const { code, j } = analyze(['orange.png', 'blue.jpg', 'grey.webp', 'split.png', 'broken.png', 'missing.jpg']);
    const o = byName(j, 'orange.png'), b = byName(j, 'blue.jpg'), g = byName(j, 'grey.webp'), s = byName(j, 'split.png');
    ok(code === 0 && j.version === 1 && j.refs.length === 4 && j.refs.every((r) => r.type === 'image'), 'png / jpg / webp read as images', j?.refs?.map((r) => r.name));
    ok(o && o.palette.length === 1 && o.palette[0].share === 1 && dE(o.palette[0].hex, '#d97757') < 3 && o.temperature === 'warm' && o.saturation > 0.3, 'solid orange: one colour (ΔE < 3), share 1, warm, saturated', o);
    ok(b && b.temperature === 'cool' && b.light < 0.35 && dE(b.palette[0].hex, '#1030a0') < 3, 'dark blue: cool and dark', b);
    ok(g && g.temperature === 'neutral' && g.saturation < 0.02 && g.contrast === 0 && Math.abs(g.light - 0.54) < 0.03, 'grey: neutral, unsaturated, no contrast, mid light', g);
    ok(s && s.palette.length === 2 && s.palette.every((c) => Math.abs(c.share - 0.5) < 0.02) && s.palette.some((c) => c.hex === '#000000') && s.palette.some((c) => c.hex === '#ffffff') && s.contrast > 0.95 && Math.abs(s.light - 0.5) < 0.02, 'black | white: two colours at ~50 %, full contrast, light 0.5', s);
    ok(j.skipped.length === 2 && j.skipped.find((k) => k.file === 'missing.jpg')?.reason === 'file not found' && /codec|invalid|could not/i.test(j.skipped.find((k) => k.file === 'broken.png')?.reason || ''), 'unreadable files are listed in skipped with a reason', j?.skipped);
    ok(j.summary.palette.length >= 4 && j.summary.palette.length <= 8 && Math.abs(j.summary.palette.reduce((a, c) => a + c.share, 0) - 1) < 0.02 && j.summary.pacing === null && j.summary.sound === null && j.summary.source === 'refs' && j.summary.colourFrom === 'refs', 'summary (source refs): merged palette (≤ 8, shares ~1), no pacing / sound without videos', j?.summary);
    const r = cli(['look', 'analyze', '--refs', 'broken.png', '--refs', 'missing.jpg']);
    ok(r.code === 1 && /nothing readable/.test(r.err), 'nothing readable -> exit 1 with the reasons', r.err);
    ok(cli(['look', 'analyze']).code === 1, 'no refs and no --from-project -> usage error');
    const r2 = cli(['look', 'analyze', 'orange.png', '--out', 'sub/analysis.json']);
    const f = path.join(tmp, 'sub', 'analysis.json');
    ok(r2.code === 0 && fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).refs[0].name === 'orange.png' && /palette #/.test(r2.out), 'positional refs + --out writes analysis.json (folders created) and prints a summary', r2.out + r2.err);
  }

  console.log('analyze: videos');
  ff('-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'color=white:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'color=green:s=160x90:r=30:d=1',
    '-filter_complex', '[0][1][2][3]concat=n=4:v=1:a=0', '-pix_fmt', 'yuv420p', 'cuts.mp4');
  ff('-f', 'lavfi', '-i', 'color=0x223344:s=160x90:r=30:d=3', '-pix_fmt', 'yuv420p', 'static.mp4');
  ff('-f', 'lavfi', '-i', 'color=black:s=160x90:r=30:d=3', '-f', 'lavfi', '-i', 'color=white:s=40x40:r=30:d=3', '-filter_complex', "[0][1]overlay=x='mod(t*300,160)':y=25", '-pix_fmt', 'yuv420p', 'moving.webm');
  ff('-f', 'lavfi', '-i', 'color=gray:s=160x90:r=30:d=4', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.25),0.004),0.8*sin(2*PI*2000*t),0)':s=48000:d=4", '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'clicks.mp4');
  ff('-f', 'lavfi', '-i', 'color=red:s=64x64:r=10:d=0.5', '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=10:d=0.5', '-filter_complex', '[0][1]concat=n=2:v=1:a=0', 'anim.gif');
  ff('-f', 'lavfi', '-i', 'color=yellow:s=64x64', '-frames:v', '1', 'still.gif');
  ff('-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30:d=1', '-filter_complex', '[0][1]concat=n=2:v=1:a=0', '-c:v', 'libvpx', '-live', '1', 'live.webm');
  {
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', path.join(tmp, 'live.webm')], { encoding: 'utf8' });
    ok(!Number(JSON.parse(pr.stdout).format.duration), 'live WebM fixture has no duration metadata');
    const v = analyze(['live.webm']).j?.refs[0];
    ok(v?.type === 'video' && Math.abs(v.duration - 2) < 0.15 && v.cuts === 1 && v.motion > 0 && v.shotLen?.median > 0.8, 'live WebM: video, decoded duration ~2 s, cut and motion measured', v);
  }

  {
    const { code, j } = analyze(['cuts.mp4', 'static.mp4', 'moving.webm', 'clicks.mp4', 'anim.gif', 'still.gif']);
    const c = byName(j, 'cuts.mp4'), st = byName(j, 'static.mp4'), mv = byName(j, 'moving.webm'), cl = byName(j, 'clicks.mp4');
    ok(code === 0 && c?.type === 'video' && Math.abs(c.duration - 4) < 0.1 && Math.abs(c.cuts - 3) <= 1 && c.shotLen && Math.abs(c.shotLen.median - 1) < 0.2 && c.palette.length >= 3, 'a clip with 3 hard cuts: cuts = 3 ± 1, median shot ~1 s, palette of its colours', c);
    ok(st?.motion < 0.005 && st.motionLabel === 'calm' && st.cuts === 0, 'static clip: calm, no cuts', st);
    ok(mv?.motionLabel === 'kinetic' && mv.motion > st.motion, 'moving clip (webm): kinetic', mv);
    ok(cl?.audio && cl.audio.onsetsPerSec > 2 && cl.audio.onsetsPerSec < 6 && cl.audio.bands.mid > 0.8 && Number.isFinite(cl.audio.lufs), 'clicks (4/s, 2 kHz): onsets/s ~4, mid band, a LUFS value', cl?.audio);
    ok(!c.audio && !st.audio, 'silent clips have no audio block');
    ok(byName(j, 'anim.gif')?.type === 'video' && byName(j, 'still.gif')?.type === 'image', 'an animated gif is a video, a one-frame gif an image', j?.refs?.map((r) => [r.name, r.type]));
    const p = j.summary.pacing;
    ok(p && p.cutsPerSec > 0 && p.shotLen.median > 0 && ['calm', 'medium', 'kinetic'].includes(p.motionLabel) && j.summary.sound?.onsetsPerSec > 2, 'summary: pacing from the videos, sound from the one with audio', j?.summary);
  }

  console.log('analyze: --from-project');
  {
    const pj = path.join(tmp, 'proj');
    let r = cli(['init', pj, '--template', 'blank']);
    ok(r.code === 0, 'temp project', r.err);
    r = cli(['new', 'one', '--kind', 'anime', '--size', '640x360', '--fps', '30', '--dur', '4'], { cwd: pj });
    fs.writeFileSync(path.join(pj, 'scenes', 'one', 'scene.js'), [
      "import { createTimeline } from 'animejs';",
      'let tl; export default { setup(ctx) {',
      "  tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 400 } }).add('.a', { x: 1, ease: 'outBack(1.4)', duration: 200 }).add('.b', { x: 2, duration: 800 });",
      "  ctx.cue(0.5, 'pop', { id: 'a' }); ctx.cue(1, 'whoosh', { variant: 'air' }); ctx.cue(2, 'whoosh', { variant: 'air' });",
      '}, render(t) {} };',
    ].join('\n'));
    r = cli(['new', 'two', '--kind', 'canvas', '--dur', '2'], { cwd: pj });
    fs.mkdirSync(path.join(pj, 'out', 'two', 'audio'), { recursive: true });
    fs.writeFileSync(path.join(pj, 'out', 'two', 'audio', 'cues.json'), JSON.stringify({ scene: 'two', duration: 2, cues: [{ sound: 'tick' }, { sound: 'tick' }, { sound: 'sample', src: 'library/x.wav' }, { sound: 'pop', mute: true }] }));
    const { code, j } = analyze([], ['--from-project'], { cwd: pj });
    const p = j?.project;
    ok(code === 0 && p && p.scenes.map((s) => s.name).join() === 'one,two' && p.scenes[0].width === 640 && p.scenes[0].fps === 30 && p.scenes[0].kind === 'anime', 'scenes with format (size, fps, kind)', p?.scenes);
    ok(p.presets.length === 1 && p.presets[0].name === 'dark-grid' && p.presets[0].scenes === 2 && p.presets[0].colors.bg && p.presets[0].ease.out === 'outExpo' && p.presets[0].file.startsWith('<engine>/'), 'presets used (engine preset: colours, ease, scene count)', p?.presets?.[0]);
    ok(p.eases.outExpo >= 1 && p.eases['outBack(1.4)'] === 1, 'easing names counted', p?.eases);
    ok(p.durations && p.durations.median === 400 && p.durations.unit === 'ms', 'tween durations median', p?.durations);
    const one = p.scenes[0].sound, two = p.scenes[1].sound;
    ok(one?.from === 'code' && one.cues === 3 && two?.from === 'cues.json' && two.cues === 3 && two.cuesPerSec === 1.5, 'sound: cues.json when rendered (muted cues left out), else cue() calls in the code', [one, two]);
    ok(p.sound.sounds.whoosh === 2 && p.sound.sounds.tick === 2 && p.sound.variants['whoosh:air'] === 2 && p.sound.samples['library/x.wav'] === 1 && p.sound.cuesPerSec === 1.5, 'project sound: sounds / variants / samples counted, cuesPerSec from rendered scenes', p?.sound);
    ok(p.look === null && j.refs.length === 0 && j.summary.project?.tweenMs?.median === 400, 'look id (none) and the project numbers in the summary', j?.summary);
    const sm = j.summary;
    ok(sm.source === 'project' && sm.colourFrom === 'presets' && sm.palette.length >= 3 && sm.palette.length <= 8 && dE(sm.palette[0].hex, '#151515') < 8 && sm.palette.some((c) => c.hex === '#d97757') && Math.abs(sm.palette.reduce((a, c) => a + c.share, 0) - 1) < 0.02 && sm.light < 0.6 && sm.temperature && sm.pacing === null, 'project only: summary palette / light / temperature from the preset colours (source "project")', sm);
    const both = analyze([path.join(tmp, 'orange.png')], ['--from-project'], { cwd: pj }).j?.summary;
    ok(both?.source === 'both' && both.colourFrom === 'refs' && both.palette.length === 1 && dE(both.palette[0].hex, '#d97757') < 3, 'refs + project: colours from the refs (source "both")', both);
    const r2 = cli(['look', 'analyze', '--from-project'], { cwd: tmp });
    ok(r2.code === 1 && /not a gfx project/.test(r2.err), '--from-project outside a project -> error', r2.err);
  }

  console.log('library-side files: hash, use, save, alt');
  const lib = path.join(tmp, 'lib');
  const lp = path.join(tmp, 'lookproj');
  {
    const ld = path.join(lib, 'looks', 'tiny');
    fs.mkdirSync(path.join(ld, 'refs'), { recursive: true });
    fs.writeFileSync(path.join(ld, 'LOOK.md'), '---\nname: Tiny\ntags: [test]\n---\n# Tiny\n');
    fs.copyFileSync(path.join(ROOT, 'templates', 'looks', 'clean-dark', 'preset.js'), path.join(ld, 'preset.js'));
    const palette = [
      { role: 'paper', sound: 'sample', src: 'kenney:impact/x.ogg', alt: { sound: 'swoosh', variant: 'silk', params: { intensity: 0.3 } }, tags: [], note: 'page turns' },
      { role: 'ui', sound: 'pop', tags: ['quiet'], note: '' },
    ];
    fs.writeFileSync(path.join(ld, 'sounds.json'), JSON.stringify(palette, null, 2) + '\n');
    fs.writeFileSync(path.join(ld, 'refs', 'thumb.jpg'), 'a ref, not the card thumb');
    const h0 = LK.lookHash(ld);
    fs.mkdirSync(path.join(ld, 'sample'), { recursive: true });
    fs.writeFileSync(path.join(ld, 'sample', 'scene.json'), JSON.stringify({ kind: 'anime', width: 320, height: 180, fps: 10, duration: 1.5, style: 'look-tiny' }));
    fs.writeFileSync(path.join(ld, 'sample', 'scene.js'), [
      "import { createTimeline } from 'animejs';",
      'let tl;',
      'export default {',
      '  setup({ root, style }) {',
      '    root.style.background = style.colors.bg;',
      "    root.insertAdjacentHTML('beforeend', `<div data-gfx=\"word\" class=\"w\" style=\"position:absolute;left:40px;top:60px;font:600 40px ${style.fonts.sans};color:${style.colors.accent}\">Tiny</div>`);",
      "    tl = createTimeline({ autoplay: false }).add('.w', { opacity: [0, 1], translateX: [-40, 0], duration: 600, ease: 'outExpo' }, 100);",
      '    tl.seek(tl.duration); tl.seek(0);',
      '  },',
      '  render(t) { tl.seek(0); tl.seek(t * 1000); },',
      '};',
    ].join('\n'));
    fs.writeFileSync(path.join(ld, 'thumb.jpg'), 'old thumb');
    fs.writeFileSync(path.join(ld, 'preview.mp4'), 'old clip');
    fs.writeFileSync(path.join(ld, 'analysis.json'), '{}');
    fs.writeFileSync(path.join(ld, 'BRIEF.md'), '# Brief\n');
    ok(LK.lookHash(ld) === h0, 'hash ignores sample/, thumb.jpg, preview.mp4, analysis.json, BRIEF.md (refs/thumb.jpg still counts)');
    ok(LK.isLibrarySide('sample/scene.js') && LK.isLibrarySide('thumb.jpg') && !LK.isLibrarySide('refs/thumb.jpg') && !LK.isLibrarySide('sample') && !LK.isLibrarySide('LOOK.md') && LK.isLibrarySide('BRIEF.md') && !LK.isLibrarySide('refs/BRIEF.md'), 'isLibrarySide: top-level names and sample/**');
    const info = LK.listLooks(lib).find((l) => l.id === 'tiny');
    ok(info && info.thumb === 'thumb.jpg' && info.preview === true && info.sample === true && info.analysis === true && info.brief === true && info.refs === 1, 'look info: thumb / preview / sample / analysis / brief', info);

    let r = cli(['init', lp, '--template', 'blank']);
    const pending = path.join(lib, 'looks', 'pending');
    fs.mkdirSync(pending, { recursive: true }); fs.writeFileSync(path.join(pending, 'BRIEF.md'), '# Brief sent');
    const listed = lastJson(cli(['look', 'list', '--library', lib, '--json'], { cwd: lp }).out);
    ok(listed?.looks.find((l) => l.id === 'pending')?.pending === true && listed.looks.find((l) => l.id === 'tiny')?.pending === false, 'list retains brief-only looks with pending true, complete looks false', listed?.looks);
    const cfgBefore = fs.readFileSync(path.join(lp, 'gfx.json'), 'utf8');
    r = cli(['look', 'use', 'pending', '--library', lib, '--json'], { cwd: lp });
    ok(r.code === 2 && lastJson(r.out)?.status === 'pending' && /LOOK.md.*missing/.test(lastJson(r.out)?.message || '') && fs.readFileSync(path.join(lp, 'gfx.json'), 'utf8') === cfgBefore && !fs.existsSync(path.join(lp, 'looks', 'pending')), 'use refuses a pending Library look: exit 2, JSON status, no project changes', r);
    fs.mkdirSync(path.join(lp, 'looks', 'pending'), { recursive: true });
    fs.writeFileSync(path.join(lp, 'looks', 'pending', 'BRIEF.md'), '# Pending');
    r = cli(['look', 'use', 'pending', '--json'], { cwd: lp });
    ok(r.code === 2 && lastJson(r.out)?.status === 'pending', 'use refuses a pending project look too', r);

    r = cli(['look', 'use', 'tiny', '--library', lib, '--json'], { cwd: lp });
    const pd = path.join(lp, 'looks', 'tiny');
    ok(r.code === 0 && fs.existsSync(path.join(pd, 'LOOK.md')) && fs.existsSync(path.join(pd, 'refs', 'thumb.jpg')) && !['sample', 'thumb.jpg', 'preview.mp4', 'analysis.json', 'BRIEF.md'].some((f) => fs.existsSync(path.join(pd, f))), 'look use copies the look but not its Library-side files', fs.readdirSync(pd));
    const cfg = JSON.parse(fs.readFileSync(path.join(lp, 'gfx.json'), 'utf8'));
    ok(cfg.lookSource.hash === h0 && LK.lookHash(pd) === h0, 'pinned hash = the Library hash (Library-side files make no difference)');
    ok(JSON.stringify(JSON.parse(fs.readFileSync(path.join(pd, 'sounds.json'), 'utf8'))) === JSON.stringify(palette), 'palette alt survives look use');
    let j = lastJson(cli(['look', 'list', '--library', lib, '--json'], { cwd: lp }).out);
    ok(j?.look && !j.look.updateAvailable && !j.look.edited, 'no "Update from library" offer after use');
    fs.writeFileSync(path.join(ld, 'thumb.jpg'), 'new thumb'); fs.writeFileSync(path.join(ld, 'preview.mp4'), 'new clip');
    fs.writeFileSync(path.join(ld, 'sample', 'extra.js'), '// more');
    j = lastJson(cli(['look', 'list', '--library', lib, '--json'], { cwd: lp }).out);
    ok(j?.look && !j.look.updateAvailable && j.look.libraryHash === h0, 'a new preview / sample in the Library does not offer "Update from library"', j?.look);

    // project edits -> save keeps the Library's sample / thumb / preview / analysis
    const pal2 = JSON.parse(fs.readFileSync(path.join(pd, 'sounds.json'), 'utf8'));
    pal2.push({ role: 'wind', sound: 'sample', src: 'kenney:x/wind.ogg', alt: { sound: 'whoosh', variant: 'air' }, tags: [], note: '' });
    fs.writeFileSync(path.join(pd, 'sounds.json'), JSON.stringify(pal2, null, 2) + '\n');
    fs.appendFileSync(path.join(pd, 'LOOK.md'), '\nEdited in the project\n');
    fs.writeFileSync(path.join(pd, 'thumb.jpg'), 'project thumb');
    fs.writeFileSync(path.join(pd, 'BRIEF.md'), 'project brief');
    fs.mkdirSync(path.join(pd, 'sample'), { recursive: true }); fs.writeFileSync(path.join(pd, 'sample', 'scene.json'), '{"project":1}');
    r = cli(['look', 'save', '--json'], { cwd: lp });
    ok(r.code === 0 && lastJson(r.out)?.status === 'saved' && fs.readFileSync(path.join(ld, 'LOOK.md'), 'utf8').includes('Edited in the project'), 'look save writes the project edits', r.out + r.err);
    ok(fs.readFileSync(path.join(ld, 'thumb.jpg'), 'utf8') === 'new thumb' && fs.readFileSync(path.join(ld, 'preview.mp4'), 'utf8') === 'new clip' && fs.readFileSync(path.join(ld, 'analysis.json'), 'utf8') === '{}' && fs.readFileSync(path.join(ld, 'BRIEF.md'), 'utf8') === '# Brief\n' && fs.existsSync(path.join(ld, 'sample', 'extra.js')) && !fs.readFileSync(path.join(ld, 'sample', 'scene.json'), 'utf8').includes('project'), 'look save keeps the Library copy\'s sample / thumb / preview / analysis / BRIEF.md');
    ok(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ld, 'sounds.json'), 'utf8'))) === JSON.stringify(pal2), 'palette alt survives look save');
    // a look made in the project: its own sample goes to a Library that has none
    r = cli(['look', 'new', 'made-here'], { cwd: lp });
    fs.mkdirSync(path.join(lp, 'looks', 'made-here', 'sample'), { recursive: true });
    fs.writeFileSync(path.join(lp, 'looks', 'made-here', 'sample', 'scene.json'), '{}');
    r = cli(['look', 'save', 'made-here', '--library', lib, '--json'], { cwd: lp });
    ok(r.code === 0 && fs.existsSync(path.join(lib, 'looks', 'made-here', 'sample', 'scene.json')), 'look save of a new look carries its sample when the Library has none', r.err);
    // update from the Library keeps the project's own Library-side files, never brings the Library's
    fs.appendFileSync(path.join(ld, 'LOOK.md'), '\nLibrary v2\n');
    r = cli(['look', 'update', '--json'], { cwd: lp });
    ok(r.code === 0 && lastJson(r.out)?.status === 'updated' && fs.readFileSync(path.join(pd, 'LOOK.md'), 'utf8').includes('Library v2') && fs.readFileSync(path.join(pd, 'thumb.jpg'), 'utf8') === 'project thumb' && !fs.existsSync(path.join(pd, 'preview.mp4')) && !fs.existsSync(path.join(pd, 'sample', 'extra.js')), 'look update: Library changes in, Library-side files not copied, the project\'s own kept', r.out + r.err);
    // seed copies everything of a starter (Library-side included)
    const seedLib = path.join(tmp, 'seedlib');
    r = cli(['look', 'seed', '--library', seedLib, '--json']);
    ok(r.code === 0 && !fs.existsSync(path.join(seedLib, 'looks', '_sample')) && !fs.existsSync(path.join(seedLib, 'looks', '_new')), 'seed skips _sample and _new', r.out);
  }

  console.log('look preview');
  {
    const ld = path.join(lib, 'looks', 'tiny');
    fs.rmSync(path.join(ld, 'thumb.jpg')); fs.rmSync(path.join(ld, 'preview.mp4'));
    const hBefore = LK.lookHash(ld);
    const outside = path.join(tmp, 'outside.mp4');
    fs.writeFileSync(outside, 'keep outside');
    for (const name of ['preview.mp4', 'thumb.jpg', 'thumb.png']) {
      fs.symlinkSync(outside, path.join(ld, name));
      const refused = cli(['look', 'preview', 'tiny', '--library', lib]);
      ok(refused.code === 1 && /not a regular file/.test(refused.err) && fs.readFileSync(outside, 'utf8') === 'keep outside' && fs.lstatSync(path.join(ld, name)).isSymbolicLink(), `preview refuses symlinked ${name}, outside file untouched`, refused);
      fs.unlinkSync(path.join(ld, name));
    }
    fs.mkdirSync(path.join(ld, 'thumb.png'));
    const special = cli(['look', 'preview', 'tiny', '--library', lib]);
    ok(special.code === 1 && /not a regular file/.test(special.err), 'preview refuses a directory destination', special);
    fs.rmdirSync(path.join(ld, 'thumb.png'));

    let r = cli(['look', 'preview', 'tiny', '--library', lib, '--json', '--progress', 'json']);
    const ev = r.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const phases = [...new Set(ev.filter((e) => e.type === 'progress').map((e) => e.phase))];
    ok(r.code === 0 && phases.join() === 'copy,thumbnail,preview' && ev.some((e) => e.type === 'done' && e.outputs.length === 2), 'look preview: progress phases copy, thumbnail, preview; done with 2 outputs', r.out.slice(-800) + r.err);
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', path.join(ld, 'preview.mp4')], { encoding: 'utf8' });
    const st = pr.status === 0 ? JSON.parse(pr.stdout).streams[0] : null;
    ok(fs.statSync(path.join(ld, 'thumb.jpg')).size > 500 && st && st.width === 480 && st.height === 270 && st.r_frame_rate === '24/1', 'thumb.jpg + preview.mp4 (480 px long side, 24 fps)', st);
    const t = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(ld, 'thumb.jpg')], { encoding: 'utf8' }).stdout.trim();
    ok(t === '480,270', 'thumbnail is 480 x 270', t);
    ok(LK.lookHash(ld) === hBefore, 'the preview does not change the look hash');
    ok(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('gfx-look-preview-tiny-')).length === 0, 'temp project removed');
    const clipBefore = fs.readFileSync(path.join(ld, 'preview.mp4'));
    r = cli(['look', 'preview', 'tiny', '--library', lib, '--still-only', '--t', '0', '--json']);
    const j = lastJson(r.out);
    ok(r.code === 0 && j?.t === 0 && j.preview === null && fs.readFileSync(path.join(ld, 'preview.mp4')).equals(clipBefore), '--still-only --t 0: only the thumbnail (clip untouched)', r.out + r.err);
    r = cli(['look', 'preview', 'ghost', '--library', lib]);
    ok(r.code === 1 && /not found in the library/.test(r.err), 'an unknown look -> error', r.err);
    fs.rmSync(path.join(lib, 'looks', 'made-here', 'sample'), { recursive: true });
    r = cli(['look', 'preview', 'made-here', '--library', lib]);
    ok(r.code === 1 && /no sample scene/.test(r.err) && /_sample\/BRIEF\.md/.test(r.err), 'no sample/ -> an error that says so', r.err);
    ok(cli(['look', 'preview', '../x', '--library', lib]).code === 1, 'bad id refused');
  }

  console.log('ink contrast');
  {
    const ink = A.inkContrast([{ hex: '#f2ece0', share: 0.93 }, { hex: '#1d1b18', share: 0.05 }, { hex: '#9e2f22', share: 0.02 }]);
    ok(ink > 0.75 && A.inkContrast([{ hex: '#ffffff', share: 0.995 }, { hex: '#000000', share: 0.005 }]) === 0 && A.inkContrast([]) === 0, 'inkContrast = L distance from the dominant colour to the farthest colour with share >= 1 %', ink);
    // type on paper: a few % ink -> contrast (p90 - p10) misses it, inkContrast sees it
    ff('-f', 'lavfi', '-i', 'color=c=0xf2ece0:s=640x640', '-vf', 'drawbox=x=40:y=60:w=300:h=26:color=0x1d1b18:t=fill', '-frames:v', '1', 'paper.png');
    const { j } = analyze(['paper.png']);
    const p = byName(j, 'paper.png');
    ok(p && p.contrast < 0.1 && p.inkContrast > 0.6 && j.summary.inkContrast === p.inkContrast, 'paper with a dark text block: contrast low, inkContrast high (also in the summary)', p && { contrast: p.contrast, inkContrast: p.inkContrast, palette: p.palette });
  }

  console.log('help');
  {
    let r = cli(['look', '--help']);
    ok(r.code === 0 && /gfx look audition/.test(r.out) && /gfx look check/.test(r.out) && /--sheet/.test(r.out), 'gfx look --help lists every look command', r);
    r = cli(['look', 'check', '--help']);
    ok(r.code === 0 && /^gfx look check <id>/.test(r.out) && !/gfx look audition/.test(r.out), 'gfx look check --help: just that command', r.out);
    r = cli(['look', 'preview', '-h']);
    ok(r.code === 0 && /--sheet/.test(r.out), 'gfx look preview -h', r.out);
    r = cli(['still', 'nothing', '--help']);
    ok(r.code === 0 && /^gfx <command>/.test(r.out), 'other commands print the usage for --help instead of running', r);
  }

  console.log('look check');
  {
    const seedLib = path.join(tmp, 'seedlib');
    for (const id of ['clean-dark', 'editorial', 'fast-paced', 'ghibli-soft', 'playful', 'tech-minimal']) {
      const r = cli(['look', 'check', id, '--library', seedLib, '--json']);
      const j = lastJson(r.out);
      ok(r.code === 0 && j?.ok && j.errors.length === 0 && j.bytes < 2 * 1024 * 1024, `starter ${id}: no errors (${j?.warnings.length} warnings, ${Math.round((j?.bytes || 0) / 1024)} KB)`, j);
    }
    const bd = path.join(lib, 'looks', 'broken');
    fs.mkdirSync(path.join(bd, 'sample'), { recursive: true });
    fs.writeFileSync(path.join(bd, 'LOOK.md'), '---\nname: Broken\n---\n# Broken\n');
    fs.writeFileSync(path.join(bd, 'preset.js'), "export default { colors: { bg: '#000', text: '#fff' }, fonts: { sans: \"'Comic Sans', sans-serif\", mono: 'monospace', display: \"'Inter', serif\" }, fontFiles: [{ family: 'Inter', url: '/fonts/inter.woff2' }, { family: 'Ghost', url: '/style/fonts/ghost-400.woff2' }] };\n");
    fs.writeFileSync(path.join(bd, 'sounds.json'), JSON.stringify([
      { role: 'a', sound: 'kazoo' }, { role: 'b', sound: 'impact', variant: 'squeak' }, { role: 'c', sound: 'sample', src: 'library/x/y.wav' },
      { role: 'd', sound: 'sample', src: '/abs/y.wav', alt: { sound: 'pop' } }, { role: 'e', sound: 'sample', src: 'library/x/z.wav', start: -1, alt: { sound: 'beep', variant: 'loud' } },
      { role: 'f', sound: 'sample', src: 'library/x/q.wav', params: { start: 0.1 }, alt: { sound: 'wind', variant: 'gust' } },
    ]));
    fs.writeFileSync(path.join(bd, 'sample', 'scene.json'), '{ nope');
    fs.writeFileSync(path.join(bd, 'big.bin'), Buffer.alloc(2 * 1024 * 1024 + 10));
    const r = cli(['look', 'check', 'broken', '--library', lib, '--json']);
    const j = lastJson(r.out);
    const has = (re) => j?.errors.some((e) => re.test(e));
    const warns = (re) => j?.warnings.some((e) => re.test(e));
    ok(r.code === 1 && j && !j.ok, 'a broken look: exit 1, ok false', r);
    ok(has(/no description/) && has(/no tags/), 'frontmatter: description and tags required', j?.errors);
    ok(has(/colors\.accent is missing/) && !has(/colors\.bg/), 'preset: bg / text / accent required', j?.errors);
    ok(has(/\/fonts\/inter\.woff2 is not a bundled font/) && has(/ghost-400\.woff2 is not in the engine/) && has(/fonts\.sans: "Comic Sans" is not loaded/) && has(/fonts\.display: "Inter" is not loaded/) && !has(/fonts\.mono/), 'fonts: only bundled files; every font key\'s family must be loaded (generic families are fine)', j?.errors);
    ok(has(/unknown synth sound "kazoo"/) && has(/variant "squeak" is not valid for impact/) && has(/\(c\): a sample entry needs an alt/) && has(/\(d\): src "\/abs\/y.wav" must be a library-relative path/) && has(/\(e\): start must be seconds/) && has(/\(e\) alt: variant "loud" is not valid for beep/) && !has(/\(f\)/), 'sounds: names, variants, alt required + valid, src library-relative, start/dur numbers (beep / wind known)', j?.errors);
    ok(warns(/\(f\): params\.start on a sample/) && warns(/library\/x\/q\.wav is not installed/), 'sounds warnings: params.start -> top-level start, src not installed here', j?.warnings);
    ok(has(/sample\/scene\.json is missing or not valid JSON/) && has(/sample\/scene\.js is missing/) && has(/budget 2 MB/), 'sample/scene.json + scene.js checked; folder over 2 MB', j?.errors);
    fs.rmSync(bd, { recursive: true });
    ok(cli(['look', 'check', 'ghost', '--library', lib]).code === 1, 'check of an unknown look -> error');
  }

  console.log('look preview --sheet');
  {
    const ld = path.join(lib, 'looks', 'tiny');
    const h = LK.lookHash(ld), thumb = fs.readFileSync(path.join(ld, 'thumb.jpg'));
    const out = path.join(tmp, 'sheets', 'tiny.png');
    let r = cli(['look', 'preview', 'tiny', '--library', lib, '--sheet', '--t', '0.5,1.2', '--out', out, '--json']);
    const j = lastJson(r.out);
    const size = (f) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim();
    ok(r.code === 0 && j?.sheet === out && fs.existsSync(out) && j.stills.length === 2 && size(j.stills[0]) === '320,180' && /tiny-t0\.5\.png$/.test(j.stills[0]), '--sheet --t: contact sheet + full-size stills next to it', r.out + r.err);
    ok(LK.lookHash(ld) === h && fs.readFileSync(path.join(ld, 'thumb.jpg')).equals(thumb), '--sheet changes nothing in the look folder');
    r = cli(['look', 'preview', 'tiny', '--library', lib, '--sheet', '--n', '4'], { cwd: lp });
    ok(r.code === 0 && fs.existsSync(path.join(lp, 'out', 'look-sheets', 'tiny.png')), 'default: out/look-sheets/<id>.png in the current project', r.out + r.err);
    ok(cli(['look', 'preview', 'tiny', '--library', lib, '--sheet', '--t', '9']).code === 1, '--t outside the sample -> error');
  }

  console.log('look audition');
  {
    const sl = path.join(tmp, 'soundlib');
    fs.mkdirSync(path.join(sl, 'library', 'own'), { recursive: true });
    ff('-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.2:sample_rate=48000', path.join(sl, 'library', 'own', 'beep.wav'));
    const ad = path.join(lib, 'looks', 'aud');
    fs.mkdirSync(ad, { recursive: true });
    fs.writeFileSync(path.join(ad, 'LOOK.md'), '---\nname: Aud\ndescription: x\ntags: [t]\n---\n');
    fs.writeFileSync(path.join(ad, 'sounds.json'), JSON.stringify([
      { role: 'beep', sound: 'sample', src: 'library/own/beep.wav', start: 0.01, alt: { sound: 'beep', variant: 'digital' } },
      { role: 'gone', sound: 'sample', src: 'library/own/missing.wav', alt: { sound: 'pop' } },
      { role: 'wind', sound: 'wind', variant: 'breeze', params: { dur: 1 } },
    ]));
    const out = path.join(tmp, 'aud', 'aud.wav');
    const env = { GFX_LIBRARY: path.join(sl, 'library') };
    // Measure the main cue before the alt: a later synth must not hide a missing sample.
    const tone = (wav, at, hz) => {
      const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', wav, '-ss', String(at), '-t', '0.1', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer' });
      if (pcm.status !== 0) throw new Error(pcm.stderr.toString());
      let re = 0, im = 0;
      const n = pcm.stdout.length / 4;
      for (let i = 0; i < n; i++) {
        const x = pcm.stdout.readFloatLE(i * 4), a = 2 * Math.PI * hz * i / 48000;
        re += x * Math.cos(a); im += x * Math.sin(a);
      }
      return n ? 2 * Math.hypot(re, im) / n : 0;
    };
    const r = cli(['look', 'audition', 'aud', '--library', lib, '--out', out, '--json'], { env });
    const j = lastJson(r.out);
    const rows = j?.roles || [];
    ok(r.code === 0 && fs.existsSync(out) && fs.existsSync(out.replace(/\.wav$/, '.sync.png')), 'audition: wav + sync.png', r.out.slice(-600) + r.err);
    ok(rows.length === 3 && /^sample beep\.wav/.test(rows[0].main) && rows[0].alt === 'beep digital' && /not installed\) -> pop/.test(rows[1].main) && rows[1].note === 'missing' && rows[2].main === 'wind breeze', 'one slot per role: installed sample + its alt, a missing src plays its alt, synth entries as they are', rows);
    const vd = spawnSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const mx = Number((/max_volume: (-?[\d.]+) dB/.exec(vd) || [])[1]);
    ok(mx > -30, 'the audition is not silent', mx);
    ok(rows[0]?.source === path.join(sl, 'library', 'own', 'beep.wav') && tone(out, 0.12, 880) > 0.02, 'global sample: report identifies the installed file and its tone plays in the main slot', rows[0]);

    const ap = path.join(tmp, 'audition-project');
    const init = cli(['init', ap, '--template', 'blank']);
    if (init.code !== 0) throw new Error(init.err);
    const cfgFile = path.join(ap, 'gfx.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    cfg.library = { sources: [{ id: 'own', kind: 'folder', path: 'library/own' }] };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    const local = path.join(ap, 'library', 'own', 'tap.wav');
    fs.mkdirSync(path.dirname(local), { recursive: true });
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2:sample_rate=48000', local);
    ff('-f', 'lavfi', '-i', 'sine=frequency=1760:duration=0.2:sample_rate=48000', path.join(sl, 'library', 'own', 'tap.wav'));
    fs.writeFileSync(path.join(ad, 'sounds.json'), JSON.stringify([
      { role: 'project tap', sound: 'sample', src: 'library/own/tap.wav', alt: { sound: 'pop' } },
      { role: 'global beep', sound: 'sample', src: 'library/own/beep.wav', alt: { sound: 'pop' } },
    ]));
    const projectOut = path.join(tmp, 'aud', 'project.wav');
    const pr = cli(['look', 'audition', 'aud', '--library', lib, '--out', projectOut, '--json'], { cwd: ap, env });
    const pj = lastJson(pr.out);
    ok(pr.code === 0 && pj?.roles[0]?.source === local && pj.roles[0].main === 'sample tap.wav' && pj.roles[0].note === null, 'project sample is reported installed from the original project', pr.out + pr.err);
    const ownTone = tone(projectOut, 0.12, 440), shadowTone = tone(projectOut, 0.12, 1760);
    ok(ownTone > 0.02 && shadowTone < ownTone / 10, 'project-first audition plays the local tone, not the global file at the same relative path', { ownTone, shadowTone });
    ok(pj?.roles[1]?.source === path.join(sl, 'library', 'own', 'beep.wav') && tone(projectOut, 1.52, 880) > 0.02, 'global sample still plays when audition starts in a project with local sources', pj?.roles[1]);

    const { auditionPlan } = await import('../runner/lib/cli/commands/look.js');
    const blocked = path.join(tmp, 'not-a-directory');
    fs.writeFileSync(blocked, 'blocked');
    const fallback = auditionPlan([{ role: 'unstageable', sound: 'sample', src: local, alt: { sound: 'pop' } }], blocked);
    ok(fallback.rows[0].note === 'missing' && /not installed/.test(fallback.rows[0].main) && !fallback.rows[0].source && fallback.cues.length === 1 && fallback.cues[0].sound === 'pop', 'a staging failure reports not installed and plays only the alt', fallback);
    fs.writeFileSync(path.join(ad, 'sounds.json'), '[]');
    ok(cli(['look', 'audition', 'aud', '--library', lib], { env }).code === 1, 'an empty palette -> error');
  }

  console.log('font CSS variables');
  {
    const fp = path.join(tmp, 'fontproj');
    let r = cli(['init', fp, '--template', 'blank']);
    fs.mkdirSync(path.join(fp, 'style', 'presets'), { recursive: true });
    const pj = fs.readFileSync(path.join(ROOT, 'templates', 'looks', 'editorial', 'preset.js'), 'utf8').replace("display: \"'Fraunces', Georgia, serif\",", "display: \"'Fraunces', Georgia, serif\",\n    headlineAlt: \"'Inter', sans-serif\",");
    fs.writeFileSync(path.join(fp, 'style', 'presets', 'fv.js'), pj);
    fs.mkdirSync(path.join(fp, 'scenes', 'fv'), { recursive: true });
    fs.writeFileSync(path.join(fp, 'scenes', 'fv', 'scene.json'), JSON.stringify({ kind: 'anime', width: 64, height: 36, fps: 10, duration: 1, style: 'fv' }));
    fs.writeFileSync(path.join(fp, 'scenes', 'fv', 'scene.js'), [
      'export default {',
      '  setup({ root }) {',
      '    const cs = getComputedStyle(root), v = (k) => cs.getPropertyValue(k);',
      "    const good = v('--gfx-font-serif').includes('Fraunces') && v('--gfx-font-display').includes('Fraunces') && v('--gfx-font-headline-alt').includes('Inter') && v('--gfx-font-sans').includes('Inter') && v('--gfx-font-mono').includes('Plex');",
      "    root.style.background = good ? '#00ff00' : '#ff0000';",
      '  },',
      '  render() {},',
      '};',
    ].join('\n'));
    r = cli(['still', 'fv', '--t', '0', '--out', path.join(tmp, 'fv.png')], { env: { GFX_PROJECT: fp } });
    const px = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(tmp, 'fv.png'), '-vf', 'crop=1:1:10:10', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' }).stdout;
    ok(r.code === 0 && px && px[0] < 30 && px[1] > 220, 'every style.fonts key is a CSS variable --gfx-font-<kebab key> (serif, display, headlineAlt -> headline-alt; sans / mono as before)', [r.err.slice(-300), px && [...px]]);
  }
} catch (e) {
  fail++;
  console.log('  FAIL (exception) ' + (e.stack || e));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nlooks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
