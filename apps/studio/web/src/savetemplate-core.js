// Pure helpers of the Save as template dialog (docs/TEMPLATES.md §4); twins of runner/lib/templates.js where noted.

/** Twin of templates.js slugId: the template id a title gets. */
export const templateId = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
/** Twin of templates.js BUILTIN ids users can't take (the engine checks its own folder too). */
export const BUILTIN_IDS = ['blank', 'reel', 'promo', 'sting', 'explainer', 'square'];

/** Why the name can't be saved, or ''. */
export function nameError(name) {
  const id = templateId(name);
  if (!String(name || '').trim()) return 'Give the template a name.';
  if (!id) return 'Use some letters or digits in the name.';
  if (BUILTIN_IDS.includes(id)) return `"${id}" is a built-in template: choose another name.`;
  return '';
}

/** `gfx template save` arguments. scope: 'scene' | 'project'. */
export function saveArgs({ scope, scene, name, description, preview = true, force = false, library = [] }) {
  const a = ['template', 'save', '--name', String(name).trim(), '--id', templateId(name), ...library];
  if (scope === 'scene' && scene) a.push('--scene', scene);
  if (String(description || '').trim()) a.push('--description', String(description).trim());
  if (!preview) a.push('--no-preview');
  if (force) a.push('--force');
  return a;
}

const distroOf = (p) => /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)/i.exec(String(p || ''))?.[1]?.toLowerCase() || null;
/**
 * `--library <Library folder>` for `gfx template` / `gfx init` (user templates live in `<library>/templates`), only when
 * the Library folder is in the same environment as the target folder / project (both Windows, or the same WSL distro):
 * the engine of another environment keeps its own default (`<its Documents>/gfx library/templates`), so Windows and WSL
 * templates stay separate (docs/TEMPLATES.md §2).
 */
export function libraryArgs(lib, target) {
  const l = String(lib || '').trim();
  return l && distroOf(l) === distroOf(target) ? ['--library', l] : [];
}

/** The engine's "already exists" refusal (offer Replace). */
export const existsError = (msg) => /already exists/i.test(String(msg || ''));

/** Progress phase -> status line. */
export const PHASES = { copy: 'Copying the files…', thumbnail: 'Making the thumbnail…', preview: 'Rendering the preview clip…' };
