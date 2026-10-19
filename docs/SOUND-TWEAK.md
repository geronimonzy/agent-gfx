# Sound tweak window, Replace…, taste memory (spec)

Finding 24 (docs/JOURNEYS.md), approved 2026-10-18. Order: 1 tweak window + Mutate/Vary → 2 Replace… → 3 taste memory.
Ideas from jfxr (sliders per stage), jsfxr (Mutate = small random step, repeatable) and ZzFX (a sound = a short
parameter recipe); no packages.

## 1. Engine: new per-cue parameters (runner/lib/sfx.js)
Optional cue fields, valid on every sound (scene `ctx.cue` opts, sound.json `cues.<id>` / `add[]`, draft):

| field | range | effect |
|---|---|---|
| `attack` | 0..2 s | fade-in of the cue's whole output from its start |
| `decay` | 0.02..8 s | exponential fade to silence ending `attack + decay` after the start (shortens a sound) |
| `bright` | −1..1 | tone tilt: high shelf at 2.5 kHz, `bright × 15` dB |
| `reverb` | 0..1 | extra send into the shared reverb (the existing seeded impulse: deterministic) |
| `seed` | integer ≥ 1 | another draw of the sound's built-in variance (pitch/filter/length/curve jitter) |

Shaping (attack/decay/bright) applies to the dry signal and the cue's own reverb sends. A cue without these fields
builds exactly the old audio graph: stems stay byte-identical (the reel fixture stems/mix md5 + the 7.61 still checked).
`seed` only changes the rng seed when present. Existing fields keep their meaning (pitch, gain, pan, dur, intensity,
variant, src/start/rate/env for samples).

## 2. Studio: tweak window (apps/studio/web/src/soundtweak.js)
Floating, non-modal window for the selected cue: **Tweak…** in the cue inspector or double-click a cue marker; Esc /
× closes; follows the selection. Header: cue id, sound, stem. Rows (slider + number, double-click = reset):
Pitch (st), Length (= `dur` for swoosh/whoosh/suck/rise/type/sample, else `decay`), Attack, Decay, Brightness, Reverb,
Gain (dB), Pan, Intensity (sounds that use it), Variant (sounds with variants). Buttons:
- **Mutate**: small random step of the current values (pitch ±1.5 st, gain ±1.5 dB, brightness ±0.2, reverb ±0.08,
  length ×0.85..1.15, intensity ±0.1, pan ±0.1). Seeded by the cue id + the current values, so the same state always
  mutates to the same result; the result is stored as plain parameters.
- **Vary**: `seed + 1` (another take of the same sound).
- **Reset sound**: drops the window's parameters (keeps time / mute).
Every change is a draft cue override (one undo step per slider drag), audible through the existing debounced draft
re-synth; A/B compares with Original; Save draft + `gfx apply` writes sound.json as today.

## 3. Replace…
A list in the window, each row ▶ audition (the candidate rendered alone, offline, same synth) and click = use it:
- **Variants**: the sound's other variants and seeds.
- **Same role**: other synth sounds of the cue's stem role (ui: click/pop/tick/type, …).
- **Similar in the library**: CLAP cosine + feature distance (`similar()` in runner/lib/sound-rank.js) from the cue's own index entry
  (synth index entry of its sound/variant, or the sample's entry) over the enabled sources; needs `gfx lib index`.
- **Past choices**: what was picked before for this sound (taste memory).
Picking a library sample turns the cue into a sample cue (`sound: 'sample'`, src/start/dur, same stem); picking a
synth sound sets `sound`/`variant`. One undo step; logged to taste memory.

## 4. Taste memory
Machine-level JSON (the machine Library, `taste/sounds.json`): entries `{ at, scene, cue, stem, from, to, via, tags }`
(`from`/`to` = `{ sound, variant?, src? }`). Ranking: suggestion score + 0.2 per earlier pick of the same target for
the same source sound (capped), shown as "picked N×". Looks palettes (LOOKS.md) can read it later.

## 5. Tests
`tests/soundtweak.test.mjs` (Chrome OfflineAudioContext): identity without new fields, determinism, each parameter
changes the output in the expected direction (attack lowers the onset, decay shortens, bright moves energy, reverb adds
tail, seed differs); `soundtweak-core.test.js` (Mutate repeatability/ranges, length mapping, ranking);
E2E `out/studio-soundtweak-check.mjs`.

## As built (2026-10-18)
- Engine (`runner/lib/sfx.js`): `attack`, `decay`, `bright`, `reverb`, `seed` (`TWEAK_KEYS`) in `makeCue` (clamped;
  identity values not stored) and the sound.json / draft overrides. Shaping sits after the cue's bus (dry + its own
  reverb sends); pre-roll recipes (swoosh, whoosh, suck, rise) report their real onset (`bus.onset`) so Attack starts
  there; `reverb` is an extra send (scaled by the cue trim) into the shared seeded reverb. Without the fields the
  graph is unchanged: the reel fixture stems + mix md5 and the 7.61 still identical.
- Studio: `soundtweak-core.js` (rows, Length → `dur`/`decay`, Mutate seeded by id + current values, Vary, taste
  ranking), `soundtweak.js` (window: draggable header, Esc / ×, follows the selection; sliders = draft overrides, one
  undo step per drag; ▶ Play renders the cue alone at its own `t` so the seeded variance matches; Replace… groups
  Variants (named variants + next takes), Same role, Similar in the library (cosine + feature distance from the cue's
  own index entry: the synth index entry nearest in intensity/length, or the sample's entry; enabled sources), Past
  choices), `taste.js`. Opened by **Tweak sound…** in the cue inspector or a double-click on a cue. Replacing keeps the
  cue's lane (stem stored explicitly). `store.js` stemSig includes the new fields (draft re-synth).
- Taste memory lives in the **machine Library** (`<Library>/taste/sounds.json`, default `~/Documents/gfx library`,
  setting `libraryDir`), deliberately: the engine's sound library (`library/`) is read-only from the studio, the machine
  Library already has guarded write ops (JS `library-core.js` + Rust `library.rs`, new kind `taste`). Read lazily when
  the window opens (no folder created on read); written only when a Replace… pick is logged. Looks palettes don't read
  it yet.
- Tests: `tests/soundtweak.test.mjs` (11), `soundtweak-core.test.js` (3), `library-core` + Rust guard cases,
  E2E `out/studio-soundtweak-check.mjs` (23; uses a temp Library via the dev shim's `libraryDir`, restored after).
- Not done: Mutate / Vary for several selected cues at once; a "Tweak" keyboard shortcut; Looks palette integration.
- Codex review fixes (d19fcbb): a neutral shaping value (attack / brightness / reverb 0, Length at "off") over a base
  value from the scene / sound.json is stored as an explicit `0` (the synth reads 0 as off; `clearFor`), else the
  override is dropped; audition and Use share one replacement transform (`replacementPatch` / `replaced`); the window
  opens right of the Inspector, else left of it, else at the viewport's right edge, and a kept position is re-clamped
  on reopen (`placeWindow`); auditions carry a generation token (a newer one, closing the window or a scene change
  cancels a pending render); the taste file is re-read right before each write (and on every window open), and a read
  error skips the write instead of overwriting; Vary and the "take" suggestions are hidden for ding, chime and samples
  (no seeded variance). Tests: soundtweak 12, soundtweak-core 4, E2E soundtweak 25.
- **2026-10-18 (user): no separate window.** The tweak controls are a **Shape** section at the bottom of the cue
  inspector (`mountTweak(host, id)`, built with the cue's inspector; rows use the inspector's `.field` grid): Length /
  Attack / Brightness / Reverb (+ Intensity, Variant where the sound has them) — Gain / Pitch / Pan stay the inspector's
  own fields, not repeated. Order (no clickable control moves after a click, 2026-10-18 layout-shift pass): ▶ Play · Mutate · Vary
  · **Reset shape** · Replace… right under the header, the Replace… list (fixed height, scrolls; keeps its order while
  open, marks the sound in use, re-ranks when reopened), then the rows (which vary with the sound); Vary keeps its slot
  when hidden.
  A cue double-click (`openTweak`) selects the cue and focuses its first shape slider. The floating window, its drag
  header, Esc / × and `placeWindow` are gone. E2E soundtweak 23.
