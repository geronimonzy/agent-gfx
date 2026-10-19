# Claude in gfx studio: terminal + T3 Code — spec v1

Two ways to work with Claude from the app, sharing one context format:
1. **Terminal** — an embedded terminal in the project folder; one click starts Claude Code there. Fast, local,
   full power.
2. **T3 Code** — "Send to T3" sends the same context to a T3 thread over MCP, and the T3 panel shows the thread
   (docs/T3.md). Claude in T3 edits the project; the app picks up the changes (live reload, comments resolved via
   `gfx review`, renders). Back and forth without copy-paste.

## 1. `gfx` everywhere
- Engine ships launchers: `<engine>/bin/gfx` (sh) and `<engine>/bin/gfx.cmd` (Windows) that run
  `<engine-node> <engine>/runner/cli.js "$@"` (bundled node if present, else `node`). In this repo `npm link`-free:
  `bin/gfx` works from any cwd.
- Terminals opened by the app prepend `<engine>/bin` to PATH and set `GFX_PROJECT`, `GFX_ENGINE`.
- Project `CLAUDE.md` (template + `gfx init`) says `gfx <cmd>` — no machine-specific absolute paths. Existing
  projects: `gfx init --refresh` rewrites CLAUDE.md + re-copies skills (keeps user edits outside a marked block).

## 2. Context format — `gfx context`
`gfx context <scene> [--t s] [--el key]... [--comment id]... [--tweaks] [--format md|json]` prints a compact brief
Claude can act on:
```
## gfx context — _reel-test @ 07.61 (f456 / 900), 1080x1920 @60, project <path>
Selected: total — div.total "42,05 €"  (actual cx 535.5 cy 1357 · scale 1.00 · rot 0° · opacity 1.00)
Pending tweaks: total { x: +40, scale: 1.2 }   (draft, not applied)
Comments:
- c3 07.61 @(540,1210) el=total: "make the total bigger and land on the ding"  [open]
  markup: <abs path>/out/_reel-test/review/shots/c3.png
Files: scenes/_reel-test/scene.js · STORYBOARD.md · SOUND.md · tweaks.json · out/_reel-test/review/draft.json
Workflow: read the markup PNGs first; fix in code; gfx still/sheet to verify; gfx review --resolve <id> --reply "..."
```
(Actual values need a live bridge: the app passes them in via `--values-json <file>`; the CLI alone omits them.)
The user's message is appended after the brief.

## 3. Terminal (studio)
- Bottom dock tab **Terminal** next to the timeline (toggle `` Ctrl+` ``), resizable; multiple tabs (+), each a PTY
  in the project dir. Rust: `portable-pty` (ConPTY on Windows): `pty_open(id, cols, rows, opts)` → spawns the shell
  (native project: `pwsh.exe` if present else `powershell.exe`, user-overridable; WSL project:
  `wsl.exe -d <distro> --cd <linux path> -- bash -l`), env per §1; `pty_write(id, data)`, `pty_resize(id, cols,
  rows)`, `pty_close(id)`; output streamed as events `pty://<id>` (batched ~16 ms). Frontend: `@xterm/xterm` +
  fit addon (bundled, no CDN), app theme colours, copy/paste (Ctrl+Shift+C/V), links clickable (file paths under
  out/ open in the app: images → preview overlay, videos → reveal).
- **Claude** button: opens/focuses a terminal and runs `claude` (configurable command; default `claude`). If the
  command is missing, show install hint (link to Claude Code install docs).
- **Ask Claude** (from: selected element in the inspector, a comment popover, the Changes tab, the render error log):
  opens a small composer (prefilled `gfx context` brief preview + text box) with buttons: **Terminal** (pastes
  `brief + message` into the Claude terminal input — bracketed paste, not auto-submitted unless "Send immediately" is
  ticked) and **T3** (docs/T3.md §5).
- Dev shim (Linux browser testing): PTY via `script -qfc` or python `pty` over a WebSocket/SSE pair; same API.

## 4. T3 Code link
Replaced by **docs/T3.md** (connect over MCP OAuth, T3 panel with threads + the native T3 view, Send to T3 with
attachments). The webhook URL, thread link, send mode, `http_post_json` and the "Open T3" link described in v1 are gone.

## 5. Help + keybindings (follow-up)
`?` opens a Help overlay listing every shortcut by area (generated from one registry used by the key handler), with
conflicts detected at startup (dev warning). Audit: one key → one action per context. Implemented: docs/KEYS.md
(`keys.js` registry + dispatcher, `keymap.js` table, `keys-help.js` overlay, `?` button in the top bar).
