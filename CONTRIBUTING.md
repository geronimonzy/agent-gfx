# Contributing to agent-gfx

Thanks for looking. gfx is early and Windows-first; issues, ideas and pull requests are welcome.

## Before you start
- For anything bigger than a fix, open an issue first and describe the idea. Features in this repo start as a short
  spec in `docs/` (see the existing ones: each has the design and an "As built" section).
- Coding agents: [AGENTS.md](AGENTS.md) has the layout, commands and the rules that bite. They apply to humans too.

## Setup
```
npm install                    # engine + studio web deps
gfx doctor                     # node, browser, ffmpeg, sound library
npm run studio:dev             # studio UI in a browser with a dev shim (http://127.0.0.1:5177)
```
The Windows app (`apps/studio/src-tauri`) needs Rust and is built on Windows: `npm run studio:build`, then
`cargo build --release` in `apps/studio/src-tauri`. From WSL, `apps/studio/scripts/build-win.sh` does both
(`GFX_WIN_USER` if your Windows user name differs).

## Pull requests
- Keep a change focused, and say what you tested.
- Run the tests your change touches (see AGENTS.md → Commands). Engine changes must keep renders byte-identical
  (the `_reel-test` still check in AGENTS.md) unless the change is meant to alter output; then say so.
- Studio UI: plain JS modules, design tokens in CSS, `await api.ask(...)` instead of `confirm()`.
- New third-party code, fonts, sounds or models: add them to `THIRD_PARTY_NOTICES.md` with their licence. Only
  licences that allow redistribution (MIT, Apache-2.0, BSD, OFL, CC0, …).

## Extending gfx
- **Skills** (`.claude/skills/`) are the main extension point: they teach the agent a scene kind, a sound workflow or a
  look. A new kind of scene or workflow can often be a skill plus a template.
- **Looks and templates**: starter looks in `templates/looks/`, project templates in `templates/projects/`
  (`docs/LOOKS.md`, `docs/TEMPLATES.md`).

## Licence
By contributing you agree that your contribution is released under the project's MIT licence ([LICENSE](LICENSE)).
