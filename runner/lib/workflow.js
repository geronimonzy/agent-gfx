// Workflow profiles (docs/LOOKS.md §1): how much Claude verifies / renders / sounds on a first take.
// gfx.json `"settings".workflow` = "quick" | "full" | { verify: "sheet"|"stills"|"full", render: bool, sound: "asked"|"always" }.
// Precedence: the project's value, else the machine default (`--workflow` from gfx studio, remembered in the machine-local
// `.gfx/workflow.json` so later block refreshes without the flag keep it), else quick.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './paths.js';

export const PROFILES = {
  quick: { verify: 'sheet', render: false, sound: 'asked' },
  full: { verify: 'full', render: true, sound: 'always' },
};
const VERIFY = ['sheet', 'stills', 'full'], SOUND = ['asked', 'always'];

/** Normalise a raw value -> `{ profile: 'quick'|'full'|'custom', verify, render, sound }`, or null when it isn't valid. */
export function parseWorkflow(v) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (PROFILES[s]) return { profile: s, ...PROFILES[s] };
    if (s.startsWith('{')) { try { return parseWorkflow(JSON.parse(s)); } catch { return null; } }
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (v.verify !== undefined && !VERIFY.includes(v.verify)) return null;
  if (v.render !== undefined && typeof v.render !== 'boolean') return null;
  if (v.sound !== undefined && !SOUND.includes(v.sound)) return null;
  return { profile: 'custom', ...PROFILES.quick, ...Object.fromEntries(['verify', 'render', 'sound'].filter((k) => v[k] !== undefined).map((k) => [k, v[k]])) };
}

const machineFile = (dest) => path.join(dest, '.gfx', 'workflow.json');

/** Remember the machine default passed with `--workflow` (throws on an invalid value). */
export function rememberMachineWorkflow(dest, raw) {
  const w = parseWorkflow(raw);
  if (!w) throw new Error(`invalid --workflow "${raw}" (quick, full or {"verify":"sheet|stills|full","render":true|false,"sound":"asked|always"})`);
  fs.mkdirSync(path.join(dest, '.gfx'), { recursive: true });
  const { profile, ...fields } = w;
  fs.writeFileSync(machineFile(dest), JSON.stringify({ machine: profile === 'custom' ? fields : profile }, null, 2) + '\n');
  return w;
}

/** Effective workflow for a project: `{ ...parsed, source: 'project'|'machine'|'default', invalid? }`. */
export function effectiveWorkflow(dest, cfg) {
  const raw = cfg && cfg.settings && typeof cfg.settings === 'object' ? cfg.settings.workflow : undefined;
  if (raw !== undefined) {
    const w = parseWorkflow(raw);
    if (w) return { ...w, source: 'project' };
  }
  const m = parseWorkflow(readJson(machineFile(dest), {}).machine);
  const base = m ? { ...m, source: 'machine' } : { profile: 'quick', ...PROFILES.quick, source: 'default' };
  return raw !== undefined ? { ...base, invalid: raw } : base;
}

const VERIFY_TEXT = { sheet: '1 contact sheet', stills: 'contact sheet + key stills', full: 'contact sheet + stills at every beat (2 passes)' };

/** The managed CLAUDE.md line, e.g. `Workflow (this project): Quick first take: 1 contact sheet, no render, sound only if asked.` */
export function workflowLine(w) {
  const label = { quick: 'Quick', full: 'Full', custom: 'Custom' }[w.profile];
  return `Workflow (this project): ${label} first take: ${VERIFY_TEXT[w.verify]}, ${w.render ? 'render when done' : 'no render'}, ${w.sound === 'always' ? 'sound always' : 'sound only if asked'}.`;
}
