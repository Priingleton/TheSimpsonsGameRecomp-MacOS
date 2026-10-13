#!/usr/bin/env bash
# Fail if a staged package contains game disc/content files.
# Usage: bash macos/verify-package.sh [package-dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${1:-$ROOT/dist/TheSimpsonsGame-Recompiled-macOS-arm64}"

if [ ! -d "$STAGE" ]; then
  echo "error: package directory missing: $STAGE" >&2
  exit 1
fi

echo "==> Verifying package has no game disc/content files: $STAGE"

bad="$(
  find "$STAGE" \( \
    -iname '*.iso' -o -iname '*.xiso' -o -iname '*.img' -o -iname '*.360' \
    -o -iname '*.xex' -o -iname 'default.xex' \
  \) -type f 2>/dev/null || true
)"

# Extracted game trees (copyrighted). Empty gamedata/ placeholder is OK.
if [ -d "$STAGE/gamedata" ]; then
  gamedata_files="$(find "$STAGE/gamedata" -type f 2>/dev/null || true)"
  if [ -n "$gamedata_files" ]; then
    bad="${bad}"$'\n'"${gamedata_files}"
  fi
fi

# Trim empty lines
bad="$(printf '%s\n' "$bad" | sed '/^$/d')"

if [ -n "$bad" ]; then
  echo "error: forbidden game content found in package:" >&2
  printf '%s\n' "$bad" | sed 's/^/  /' >&2
  exit 1
fi

for need in "simpsons" "TSG Launcher.app/Contents/MacOS/TSGLauncher" "extract-xiso" "Play.command"; do
  if [ ! -e "$STAGE/$need" ]; then
    echo "error: missing required package file: $need" >&2
    exit 1
  fi
done

echo "Package OK (no ISO/XEX/gamedata files; TSG Launcher + engine present)."
