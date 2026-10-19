#!/usr/bin/env bash
# Build an NSIS installer (docs/INSTALL.md §1, §4). Usage: build-installer.sh windows|wsl
#   windows: the app + the Windows engine (<app>\engine\)       -> out/installer/gfx-studio-<ver>-windows-setup.exe
#   wsl:     the app + the WSL engine bundle (engine-wsl.tar.gz) -> out/installer/gfx-studio-<ver>-wsl-setup.exe
# Runs in WSL with the Windows Rust toolchain and `cargo install tauri-cli --version "^2"` on the Windows side.
# Builds in its own Windows folder (never the developer exe's build dir). Override with GFX_WIN_USER / GFX_WIN_BUILD / CARGO_TAURI,
# GFX_VERSION (app version) and GFX_INSTALLER_TEST=1 (a separate test app).
set -euo pipefail
TARGET="${1:-}"; [ "$TARGET" = windows ] || [ "$TARGET" = wsl ] || { echo "usage: build-installer.sh windows|wsl"; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"          # apps/studio
REPO="$(cd "$HERE/../.." && pwd)"
WINUSER="${GFX_WIN_USER:-$USER}"   # the Windows user name, if it differs from the WSL one
DEST="${GFX_WIN_BUILD:-/mnt/c/Users/$WINUSER/dev/gfx-installer-build}"
CARGO_TAURI="${CARGO_TAURI:-/mnt/c/Users/$WINUSER/.cargo/bin/cargo-tauri.exe}"
# GFX_VERSION overrides the app version (install tests: an older build to upgrade from); the engine keeps its own
VERSION="${GFX_VERSION:-$(node -p "require('$REPO/package.json').version")}"
OUT="$REPO/out/installer"
START=$(date +%s)

echo "[1/5] engine bundle ($TARGET)"
node "$HERE/scripts/build-engine.mjs" "$TARGET"

echo "[2/5] vite build"
(cd "$REPO" && npx vite build --config apps/studio/web/vite.config.js)

echo "[3/5] copy sources -> $DEST"
mkdir -p "$DEST"
rsync -a --delete --exclude node_modules --exclude target --exclude .git --exclude 'web/node_modules' --exclude 'installer-res' "$HERE/" "$DEST/"
cp "$REPO/LICENSE" "$DEST/LICENSE.txt"
# the engine resource of this installer only (the other one is removed so it is not bundled by accident)
rm -rf "$DEST/installer-res" && mkdir -p "$DEST/installer-res"
if [ "$TARGET" = windows ]; then
  cp -r "$OUT/engine-windows" "$DEST/installer-res/engine"
  RES='"../installer-res/engine/": "engine/"'
else
  cp "$OUT/engine-wsl.tar.gz" "$DEST/installer-res/"
  RES='"../installer-res/engine-wsl.tar.gz": "engine-wsl.tar.gz"'
fi

echo "[4/5] tauri build (NSIS, version $VERSION)"
# GFX_INSTALLER_TEST=1: a separate app ("gfx studio test", its own identifier, so its own %APPDATA% data, install folder
# and uninstall entry), for install tests on a machine that also runs the real app or a dev build.
ID_JSON=""; SUFFIX=""
if [ "${GFX_INSTALLER_TEST:-}" = 1 ]; then
  ID_JSON='"identifier": "dev.gfx.studio.installtest", "productName": "gfx studio test",'
  SUFFIX="-test"
fi
cat > "$DEST/src-tauri/tauri.installer.json" <<JSON
{
  $ID_JSON
  "version": "$VERSION",
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "publisher": "agent-gfx",
    "shortDescription": "gfx studio: motion graphics directed with your coding agent",
    "copyright": "Copyright (c) 2026 Kirill Fedorov (MIT)",
    "licenseFile": "../LICENSE.txt",
    "resources": { $RES },
    "windows": { "nsis": { "installMode": "currentUser", "installerIcon": "icons/icon.ico", "installerHooks": "installer/hooks.nsh" } }
  }
}
JSON
(cd "$DEST/src-tauri" && "$CARGO_TAURI" build --config tauri.installer.json)

echo "[5/5] collect"
SETUP="$(ls -t "$DEST"/src-tauri/target/release/bundle/nsis/*-setup.exe | head -1)"
NAME="gfx-studio-$VERSION-$TARGET$SUFFIX-setup.exe"
cp "$SETUP" "$OUT/$NAME"
ls -l "$OUT/$NAME"
echo "built in $(( $(date +%s) - START ))s: $OUT/$NAME"
