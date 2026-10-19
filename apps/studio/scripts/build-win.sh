#!/usr/bin/env bash
# Build the Windows exe from WSL. Usage: build-win.sh [--shell-only]
# Override with GFX_WIN_USER (the Windows user name, if it differs from the WSL one), GFX_WIN_DEV (build dir), CARGO.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # apps/studio
WINUSER="${GFX_WIN_USER:-$USER}"
DEST="${GFX_WIN_DEV:-/mnt/c/Users/$WINUSER/dev/gfx-studio}"
CARGO="${CARGO:-/mnt/c/Users/$WINUSER/.cargo/bin/cargo.exe}"
SHELL_ONLY=0; [ "${1:-}" = "--shell-only" ] && SHELL_ONLY=1
START=$(date +%s)

mkdir -p "$DEST"
if [ $SHELL_ONLY -eq 0 ]; then
  echo "[1/3] vite build"
  (cd "$HERE/web" && npx vite build)
  [ -f "$HERE/web/dist/index.html" ] || { echo "web/dist missing"; exit 1; }
fi

echo "[2/3] rsync -> $DEST"
rsync -a --delete --exclude node_modules --exclude target --exclude dist --exclude .git \
  --exclude 'web/dist' --exclude 'web/node_modules' "$HERE/" "$DEST/"
mkdir -p "$DEST/web/dist"
if [ $SHELL_ONLY -eq 1 ]; then
  # placeholder only in the Windows build dir, never in web/
  echo '<!doctype html><title>gfx studio</title><body style="background:#14171f;color:#e6e8ef">gfx studio placeholder</body>' > "$DEST/web/dist/index.html"
else
  rsync -a --delete "$HERE/web/dist/" "$DEST/web/dist/"
fi

echo "[3/3] cargo build --release"
cd "$DEST/src-tauri"
"$CARGO" build --release
ls -l "$DEST/src-tauri/target/release/gfx-studio.exe"
echo "built in $(( $(date +%s) - START ))s: $(wslpath -w "$DEST/src-tauri/target/release/gfx-studio.exe" 2>/dev/null || echo "$DEST/src-tauri/target/release/gfx-studio.exe")"
