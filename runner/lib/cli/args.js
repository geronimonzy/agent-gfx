// Option table + usage text. New options (e.g. FOUNDATION.md §4 render options) go into OPTIONS; parseArgs is strict
// about types only, every command reads what it needs from `values`.
export const USAGE = `gfx <command> [options]          (global: --project <dir>, --progress json)
  init <dir> [--template <id>|user/<id>|<folder>] [--name "My project"] [--existing]   create a project (gfx.json, scenes/, skills, CLAUDE.md);
                           --existing: also in a folder that already has files (nothing existing is overwritten)
  init --refresh [<dir>] [--no-skills] [--json]   rewrite the managed block of CLAUDE.md (user text outside it is kept),
                           sync the managed skill copies (not with --no-skills: untouched files updated, your edits kept with
                           the engine version in .gfx/skills-new/; record .gfx/skills.json) and write .gfx/engine.json
                           --workflow quick|full|<json>: the machine default for the managed block's workflow line (init and
                           --refresh; remembered in .gfx/workflow.json; gfx.json "settings".workflow wins)
  template list [--json] | preview <ref> | remove user/<id>   built-in + user templates (docs/TEMPLATES.md)
  template save [--scene <name>] [--name "Title"] [--id <id>] [--description ".."] [--t <sec>] [--no-preview] [--force]
                           this project (or one scene) -> the user templates (GFX_TEMPLATES, else <library>/templates; --library <dir>,
                           default <Documents>/gfx library); template list/preview/remove and init take --library too
  look list [--library <dir>] [--json]   project looks + the library's (docs/LOOKS.md §2)
  look use <id> [--library <dir>] [--force]   pin a library look (copy to looks/<id>/, gfx.json look + lookSource, preset
                           look-<id>, managed block); without --library: use the project's own looks/<id>/
  look update [--library <dir>] [--json]   take the library's newer copy (only when the project copy is unedited)
  look save [<id>] [--library <dir>] [--force] [--json]   project look -> library (--force overwrites a newer library copy)
  look new <id>            scaffold looks/<id>/ (LOOK.md, preset.js, sounds.json) in the project
  look seed --library <dir>   copy the starter looks into the library (existing looks are never overwritten)
  look analyze [--refs <file>]... [<file>...] [--from-project] [--out <file>] [--json]   measure reference images /
                           videos (palette, light, cuts, motion, sound density) and/or this project's scenes -> analysis.json
  look preview <id> [--library <dir>] [--t <sec>] [--still-only]   render the look's sample/ scene -> thumb.jpg + preview.mp4
                           in the look folder (default --library: <Documents>/gfx library; --t default 70% of the duration)
  look preview <id> --sheet [--n 12] [--cols 4] [--t a,b] [--out <png>]   contact sheet of the sample (+ full-size stills at --t)
  look check <id> [--library <dir>] [--json]   validate a look (frontmatter, preset keys, bundled fonts, sounds + alt, sample, <= 2 MB)
  look audition <id> [--library <dir>] [--out <wav>]   every sound-palette role in sequence -> wav + sync.png
                           (gfx look --help / gfx look <cmd> --help: details)
  context <scene> [--t s] [--el key]... [--comment id]... [--tweaks] [--values-json file] [--format md|json]   brief for Claude
  doctor [--json]          engine/project paths, node, browser, ffmpeg, library; exit 1 if something required is missing
  setup ffmpeg [--force]   download a static ffmpeg + ffprobe into <library-parent>/bin
  setup chrome [--force]   download the pinned chrome-headless-shell into <library-parent>/browsers (preferred over system Chrome)
  new <name> --kind three|canvas|svg|anime [--size 1920x1080] [--fps 60] [--dur 6] [--style dark-grid]
  dev <name> [--port 5173]
  still <name> --t <sec> [--out file.png] [--scale k] [--mode fast|exact]
  sheet <name> [--n 12] [--cols 4] [--out file.png] [--mode fast|exact]
  render <name> [--format mp4|webm|gif|png|prores|webm-alpha|mov-alpha] [--codec h264|h265] [--crf N | --quality draft|normal|high]
         [--fps N] [--from s] [--to s] [--dur s] [--size WxH | --scale k | --preset 1080p|4k|reel|reel-4k|square|portrait|720p]
         [--crop x,y,w,h | --crop-track file.json] [--fit contain|cover] [--pad #hex] [--reframe WxH] [--alpha]
         [--render-preset id] [--out path] [--audio [--keep-silent]] [--workers N|auto]
         [--mode fast|exact]   fast = GPU raster + workers auto (not bit-exact; default exact, env GFX_MODE)
         [--frame-format png|jpeg]   intermediate frames; jpeg only for mp4/webm/gif drafts
  render --list-presets [<name>] [--json]   built-in + scenes/<name>/render.json presets  audio <name> [--video path]
  export <name>
  serve [--port 5199]      long-running Vite (project root); GET /__gfx/ping; live bridge at /runner/player/bridge.html?scene=<name>
  review <scene> [--all] [--json] [--stills] [--resolve id] [--wontfix id] [--reopen id] [--reply "..."]
  apply <scene> [--tweaks] [--sound]   fold out/<scene>/review/draft.json into scenes/<scene>/{tweaks,sound}.json
  version init | status | save [-m note] [--actor user|claude|auto] [--thumb scene@t] | log [--limit n] [--path p] | diff <a> [<b>|--worktree] [--path p] | restore <sha> [--path p]... | export <rev> --out <dir> | preview <rev|now> [--port p] [--idle s]   project history; --json; --allow-engine
  list
  lib list [--json] | add <id> <path> [--license ".."] [--json] | remove <id> [--json] | enable|disable <id>
  lib fetch kenney [--packs impact,interface,ui,digital,scifi,rpg] | fetch freesound --query "<q>" [--n 50] [--min-dur 0.05 --max-dur 6]
  lib index [<id>...] [--force]   (a v1 index is re-tagged in place: labels / role / bands, no CLAP audio pass)
  lib search "<text>" [--role hits|motion|ui|accents] [--max-dur s] [--source id]... [--n 10] [--json]
  lib similar <entry id | audio file | scene:cueId> [--role r] [--max-dur s] [--min-dur s] [--source id]... [--n 8] [--json]
  lib info <src | entry id | path> [--json]   one file (path, licence, duration, labels, role, bands); exit 1 = not installed
  lib files [--source id]... [--grep <text>] [--role r] [--json]   browse the library's files   (gfx lib --help)`;

const STRING = ['kind', 'size', 'fps', 'dur', 'style', 'port', 't', 'out', 'n', 'cols', 'format', 'from', 'to', 'scale', 'video',
  'packs', 'query', 'preset', 'crop', 'crop-track', 'fit', 'pad', 'reframe', 'codec', 'crf', 'quality', 'render-preset', 'min-dur', 'max-dur', 'license', 'reply', 'values-json', 'project', 'progress', 'template', 'name', 'actor', 'thumb', 'limit', 'workers', 'mode', 'frame-format', 'workflow', 'library', 'idle'];
const BOOLEAN = ['audio', 'alpha', 'list-presets', 'force', 'existing', 'all', 'json', 'stills', 'tweaks', 'sound', 'refresh', 'worktree', 'allow-engine', 'keep-silent', 'no-skills'];
const MULTIPLE = ['path', 'source', 'el', 'comment', 'resolve', 'wontfix', 'reopen'];
// gfx lib search / similar / files (docs/SOUND-LIBRARY.md §3); --help is read by gfx lib (and gfx look)
STRING.push('role', 'grep');
if (!BOOLEAN.includes('help')) BOOLEAN.push('help');
// gfx template (docs/TEMPLATES.md §3)
STRING.push('for', 'id', 'description', 'scene');
BOOLEAN.push('no-preview');
// gfx look analyze / preview (docs/LOOK-PIPELINE.md §1-2)
MULTIPLE.push('refs');
BOOLEAN.push('from-project', 'still-only');
// gfx look preview --sheet / check / audition, gfx look [<cmd>] --help (docs/LOOK-PIPELINE.md "Friction round")
BOOLEAN.push('sheet');

export const OPTIONS = Object.fromEntries([
  ...STRING.map((k) => [k, { type: 'string' }]),
  ...BOOLEAN.map((k) => [k, { type: 'boolean' }]),
  ['message', { type: 'string', short: 'm' }],
  ['help', { type: 'boolean', short: 'h' }],
  ...MULTIPLE.map((k) => [k, { type: 'string', multiple: true }]),
]);
