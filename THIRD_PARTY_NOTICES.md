# Third-party notices

gfx itself is MIT licensed (see `LICENSE`). It includes or downloads the components below, which keep their own
licences. Full licence texts ship with each package (`node_modules/<pkg>/LICENSE`) and, for Rust crates, are generated
from `Cargo.lock` at release time. This file lists names, licences and required attributions.

## Bundled

### npm runtime dependencies

| Package | Version | Licence | Copyright / source |
|---|---|---|---|
| anime.js | 4.5.0 | MIT | (c) Julian Garnier, github.com/juliangarnier/anime |
| three.js | 0.186.1 | MIT | (c) three.js authors, github.com/mrdoob/three.js |
| fflate | 0.8.3 | MIT | (c) Arjun Barrett, github.com/101arrowz/fflate |
| Vite | 8.3.4 | MIT | (c) Yuxi (Evan) You and Vite contributors |
| lightningcss (Vite dependency) | 1.33.0 | MPL-2.0 | unmodified; source: github.com/parcel-bundler/lightningcss |
| @huggingface/transformers, @huggingface/tokenizers | 4.3.1, 0.2.0 | Apache-2.0 | (c) Hugging Face, github.com/huggingface/transformers.js |
| ONNX Runtime (node, common, web) | 1.30.0 / 1.31.0-dev | MIT | (c) Microsoft Corporation, github.com/microsoft/onnxruntime |
| puppeteer-core, @puppeteer/browsers, chromium-bidi, webdriver-bidi-protocol | 25.13.0 / 3.2.4 | Apache-2.0 | (c) Google LLC, github.com/puppeteer/puppeteer |
| flatbuffers, long, detect-libc | 25.9.23, 5.3.2, 2.1.2 | Apache-2.0 | upstream repositories |
| sharp (+ libvips) | 0.35.5 | Apache-2.0; libvips LGPL-3.0-or-later | Pulled in by transformers.js for image preprocessing; gfx uses audio only. To be excluded from installers; if shipped, the LGPL libvips must stay a replaceable library, source: github.com/lovell/sharp-libvips |

The MIT and Apache-2.0 licence texts apply as published by each project. Remaining transitive packages in
`package-lock.json` are MIT, Apache-2.0, BSD-3-Clause, ISC, 0BSD, or MIT OR CC0-1.0. No GPL or AGPL.

### Studio UI libraries (compiled into the studio bundle)

| Package | Licence | Copyright |
|---|---|---|
| CodeMirror 6 (`@codemirror/*`) and Lezer (`@lezer/*`, crelt, style-mod, w3c-keyname) | MIT | (c) Marijn Haverbeke and contributors |
| xterm.js (`@xterm/xterm`, addon-fit, addon-web-links) | MIT | (c) The xterm.js authors |
| dockview-core | MIT | (c) mathuo |

### Rust crates (apps/studio/src-tauri)

Listed from `Cargo.lock` (453 crates at last count); licences per crates.io, to be verified with cargo-about and
cargo-deny before release. Not verified offline.

| Crate | Licence |
|---|---|
| tauri 2, tauri-plugin-dialog, serde, serde_json, ureq, sha2, base64, getrandom, webview2-com, windows-core | MIT OR Apache-2.0 |
| portable-pty | MIT |
| Candidates outside MIT/Apache/BSD (check): webpki-roots | CDLA-Permissive-2.0 |
| ring | ISC / OpenSSL-style composite |
| unicode-ident | MIT OR Apache-2.0, with Unicode-3.0 data |
| option-ext (via dirs-sys), cssparser, selectors (via tauri-utils) | MPL-2.0 |
| r-efi | multi-licensed, MIT chosen |

The WebView2 runtime is Microsoft's Evergreen runtime and is not bundled.

### Fonts (`style/fonts/` and `apps/studio/web/src/theme/fonts/`)

| Font | Licence | Attribution | Licence file |
|---|---|---|---|
| Inter 400/500/600/700 | SIL OFL 1.1, https://openfontlicense.org | Copyright 2016 The Inter Project Authors | `style/fonts/LICENSE-Inter.txt` |
| IBM Plex Mono 400/500/600 | SIL OFL 1.1 | Copyright IBM Corp. | `style/fonts/LICENSE-IBM-Plex-Mono.txt` |
| Fraunces 400/600/700 | SIL OFL 1.1 | Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) | `style/fonts/LICENSE-Fraunces.txt` |
| Nunito 400/600/800 | SIL OFL 1.1 | Copyright 2014 The Nunito Project Authors (github.com/googlefonts/nunito) | `style/fonts/LICENSE-Nunito.txt` |
| Fredoka 400/600/700 | SIL OFL 1.1 | Copyright 2016 The Fredoka Project Authors (github.com/hafontia/Fredoka-One) | `style/fonts/LICENSE-Fredoka.txt` |
| Space Grotesk 400/500/700 | SIL OFL 1.1 | Copyright 2020 The Space Grotesk Project Authors (github.com/floriankarsten/space-grotesk) | `style/fonts/LICENSE-Space-Grotesk.txt` |
| Ubuntu 300/500 | Ubuntu Font Licence 1.0 (not OFL), https://ubuntu.com/legal/font-licence | Copyright 2010, 2011 Canonical Ltd | `style/fonts/LICENSE-Ubuntu.txt` |

Studio ships Inter and IBM Plex Mono from `apps/studio/web/src/theme/fonts/`. Their complete OFL texts are
packaged via `apps/studio/web/public/licenses/` as `/licenses/LICENSE-Inter.txt` and
`/licenses/LICENSE-IBM-Plex-Mono.txt`.

The `style/fonts/` files are the unmodified latin-subset woff2 builds from @fontsource 5.x (npm `@fontsource/<font>`;
Fraunces, Nunito, Fredoka and Space Grotesk at 5.3.0), with each package's licence file.

Studio subsets: latin, latin-ext and cyrillic files are the @fontsource builds (unmodified). The
`inter-symbols-*.woff2` files are subsets of Inter 4.1 (https://github.com/rsms/inter/releases/tag/v4.1; arrows, math
operators, misc technical, geometric shapes, misc symbols/dingbats) made with fontTools `pyftsubset`; Inter has no
reserved font name, and the subset stays under the OFL.

Other fonts are used unmodified. Modified versions of Ubuntu must be renamed under its licence; OFL fonts must not be sold
on their own or use reserved names when modified.

### Sounds

| Item | Licence | Source |
|---|---|---|
| Kenney packs (digital, impact, interface, rpg, scifi, ui) in `library/kenney` | CC0-1.0 (each pack's `License.txt`) | https://kenney.nl (credit appreciated, not required) |
| Synth cues and beds (`runner/lib/sfx.js`) | MIT, our own | this repository |

## Downloaded on request (not distributed by gfx)

| Item | Licence / terms | Notes |
|---|---|---|
| FFmpeg (Windows GPL build by BtbN) | GPL (build includes libx264/libx265) | Downloaded by the user via `gfx setup ffmpeg` / the studio button from github.com/BtbN/FFmpeg-Builds (pinned: ffmpeg 9.0.2 from the autobuild-2026-09-30-13-08 release, SHA-256 verified). gfx does not bundle it and runs it only as a separate process. Source: https://ffmpeg.org and the BtbN build scripts. Linux builds come from johnvansickle.com (GPL-3.0 static). |
| chrome-headless-shell (Chrome for Testing) | Chromium BSD-3-Clause plus third-party components; the `LICENSE` in the downloaded zip applies | `gfx setup chrome`, from storage.googleapis.com/chrome-for-testing-public. Not bundled; Google's terms apply to the download. |
| CLAP model weights (laion/clap-htsat-unfused, laion/larger_clap_general; ONNX by Xenova) | Apache-2.0 | (c) LAION; Wu et al., "Large-scale Contrastive Language-Audio Pretraining", arXiv:2211.06687. Training data (LAION-Audio-630K) is mixed-licence. About 1 GB, optional download. |
| Freesound sounds | CC0 only (fetcher filters `license:"Creative Commons 0"`) | User's own API key; per-file credits in `library/freesound-cc0/credits.json`. Not stored in this repository. |

## Development-only (not redistributed)

Test and build tooling used from `devDependencies`: Vite and its lightningcss (MPL-2.0, see above) when running from
source, plus the lockfile's MIT, ISC, BSD and Apache-2.0 build tools. Nothing here is shipped in an installer beyond
what is listed under Bundled.
