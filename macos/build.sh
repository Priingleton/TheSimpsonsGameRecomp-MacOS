#!/usr/bin/env bash
# Build the macOS ReXGlue runtime, install it, build simpsons, and stage a runnable package.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SDK="$ROOT/tools/rexglue-sdk"
APP="$ROOT/simpsons"
JOBS="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
CONFIG="${CONFIG:-RelWithDebInfo}"
case "$JOBS" in ''|*[!0-9]*|0) echo 'JOBS must be a positive integer.' >&2; exit 1;; esac
[ "$(uname -s)" = Darwin ] || { echo 'Build on macOS.' >&2; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo 'This script targets Apple Silicon (arm64).' >&2; exit 1; }
for tool in cmake ninja python3; do
  command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done

export CPM_SOURCE_CACHE="${CPM_SOURCE_CACHE:-$SDK/out/deps}"

echo "==> Configuring ReXGlue SDK (mac-arm64)"
(
  cd "$SDK"
  cmake --preset mac-arm64 -DREXGLUE_REGISTER_PACKAGE=OFF
)

echo "==> Building ReXGlue SDK ($CONFIG, $JOBS jobs)"
(
  cd "$SDK"
  cmake --build out/build/mac-arm64 --config "$CONFIG" --parallel "$JOBS"
)

echo "==> Installing ReXGlue SDK"
(
  cd "$SDK"
  cmake --install out/build/mac-arm64 --config "$CONFIG"
)

export REXGLUE_MAC_SDK="$SDK/out/install/mac-arm64"
echo "REXGLUE_MAC_SDK=$REXGLUE_MAC_SDK"

# MoltenVK / vulkan-loader often stay in the build tree only. Stage the names
# the app post-build copy and runtime loader expect.
SDK_BUILD_LIB="$SDK/out/mac-arm64/$CONFIG"
mkdir -p "$REXGLUE_MAC_SDK/lib" "$REXGLUE_MAC_SDK/share/vulkan/icd.d"
if [ -f "$SDK_BUILD_LIB/libMoltenVKrd.dylib" ]; then
  cp -f "$SDK_BUILD_LIB/libMoltenVKrd.dylib" "$REXGLUE_MAC_SDK/lib/libMoltenVK.dylib"
  cp -f "$SDK_BUILD_LIB/libMoltenVKrd.dylib" "$REXGLUE_MAC_SDK/lib/"
fi
if [ -f "$SDK_BUILD_LIB/libMoltenVK.dylib" ]; then
  cp -f "$SDK_BUILD_LIB/libMoltenVK.dylib" "$REXGLUE_MAC_SDK/lib/"
fi
if [ -f "$SDK_BUILD_LIB/libvulkanrd.1.dylib" ]; then
  cp -f "$SDK_BUILD_LIB/libvulkanrd.1.dylib" "$REXGLUE_MAC_SDK/lib/libvulkan.1.dylib"
  cp -f "$SDK_BUILD_LIB/libvulkanrd.dylib" "$REXGLUE_MAC_SDK/lib/libvulkan.dylib"
  cp -f "$SDK_BUILD_LIB/libvulkanrd.1.dylib" "$REXGLUE_MAC_SDK/lib/"
  cp -f "$SDK_BUILD_LIB/libvulkanrd.dylib" "$REXGLUE_MAC_SDK/lib/"
fi
if [ ! -f "$REXGLUE_MAC_SDK/share/vulkan/icd.d/MoltenVK_icd.json" ]; then
  cat > "$REXGLUE_MAC_SDK/share/vulkan/icd.d/MoltenVK_icd.json" <<'EOF'
{
  "file_format_version": "1.0.0",
  "ICD": {
    "library_path": "../../../lib/libMoltenVK.dylib",
    "api_version": "1.4.0"
  }
}
EOF
fi
install_name_tool -id @rpath/libMoltenVK.dylib "$REXGLUE_MAC_SDK/lib/libMoltenVK.dylib" 2>/dev/null || true
install_name_tool -id @rpath/libvulkan.1.dylib "$REXGLUE_MAC_SDK/lib/libvulkan.1.dylib" 2>/dev/null || true

APP_PRESET="mac-arm64-release"
if [ "$CONFIG" = "RelWithDebInfo" ]; then
  APP_PRESET="mac-arm64-relwithdebinfo"
elif [ "$CONFIG" = "Debug" ]; then
  APP_PRESET="mac-arm64-relwithdebinfo"
fi

echo "==> Configuring simpsons ($APP_PRESET)"
(
  cd "$APP"
  cmake --preset "$APP_PRESET" -DSIMPSONS_REGENERATE_CODE=OFF
)

echo "==> Building simpsons ($JOBS jobs)"
(
  cd "$APP"
  cmake --build --preset "$APP_PRESET" --parallel "$JOBS"
)

STAGE="$ROOT/dist/TheSimpsonsGame-Recompiled-macOS-arm64"
# Keep installed game data / saves across rebuilds. Never keep ISO-derived hero
# stills — those must be generated on the player's machine after they install.
KEEP="$ROOT/dist/.stage-keep-$$"
mkdir -p "$KEEP"
for d in gamedata userdata cache logs backups mods; do
  if [ -d "$STAGE/$d" ] && [ -n "$(ls -A "$STAGE/$d" 2>/dev/null || true)" ]; then
    mv "$STAGE/$d" "$KEEP/$d"
  fi
done
# Preserve menu fonts only under art/ (not cutscene hero JPGs).
if [ -d "$STAGE/art/fonts" ]; then
  mkdir -p "$KEEP/art/fonts"
  cp -R "$STAGE/art/fonts/." "$KEEP/art/fonts/"
fi
# Preserve player config if present (rebuild still writes fresh defaults when missing).
[ -f "$STAGE/simpsons.toml" ] && cp -f "$STAGE/simpsons.toml" "$KEEP/simpsons.toml" || true
[ -x "$STAGE/ffmpeg" ] && cp -f "$STAGE/ffmpeg" "$KEEP/ffmpeg" || true
echo "==> Staging package at $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE/lib" "$STAGE/gamedata" "$STAGE/userdata" "$STAGE/cache" "$STAGE/logs" \
  "$STAGE/art" "$STAGE/vulkan/lib" "$STAGE/vulkan/share/vulkan/icd.d"
for d in gamedata userdata cache logs backups mods; do
  if [ -d "$KEEP/$d" ]; then
    rm -rf "$STAGE/$d"
    mv "$KEEP/$d" "$STAGE/$d"
  fi
done
if [ -d "$KEEP/art/fonts" ]; then
  mkdir -p "$STAGE/art/fonts"
  cp -R "$KEEP/art/fonts/." "$STAGE/art/fonts/"
fi
[ -x "$KEEP/ffmpeg" ] && mv "$KEEP/ffmpeg" "$STAGE/ffmpeg" || true
# Keep the player's simpsons.toml aside until after fresh defaults are written.
SAVED_TOML=""
if [ -f "$KEEP/simpsons.toml" ]; then
  SAVED_TOML="$ROOT/dist/.stage-toml-$$"
  mv "$KEEP/simpsons.toml" "$SAVED_TOML"
fi
rm -rf "$KEEP"

BIN="$APP/out/build/$APP_PRESET/simpsons"
cp -f "$BIN" "$STAGE/simpsons"

# Runtime dylibs live next to the executable (@executable_path / @rpath).
for f in librexruntimerd.dylib librexgpu-xenosrd.dylib libTracyClientrd.dylib \
         librexruntime.dylib librexgpu-xenos.dylib; do
  if [ -f "$REXGLUE_MAC_SDK/lib/$f" ]; then
    cp -f "$REXGLUE_MAC_SDK/lib/$f" "$STAGE/"
  fi
done

# Vulkan stack: both vulkan/ (ReXGlue mac layout) and lib/ (DYLD helper).
for f in libMoltenVK.dylib libvulkan.1.dylib libvulkan.dylib \
         libMoltenVKrd.dylib libvulkanrd.1.dylib libvulkanrd.dylib; do
  if [ -f "$REXGLUE_MAC_SDK/lib/$f" ]; then
    cp -f "$REXGLUE_MAC_SDK/lib/$f" "$STAGE/vulkan/lib/"
    cp -f "$REXGLUE_MAC_SDK/lib/$f" "$STAGE/lib/"
  fi
done
(
  cd "$STAGE/vulkan/lib"
  [ -f libMoltenVKrd.dylib ] && [ ! -e libMoltenVK.dylib ] && ln -sf libMoltenVKrd.dylib libMoltenVK.dylib
  [ -f libvulkanrd.1.dylib ] && [ ! -e libvulkan.1.dylib ] && ln -sf libvulkanrd.1.dylib libvulkan.1.dylib
  [ -f libvulkanrd.dylib ] && [ ! -e libvulkan.dylib ] && ln -sf libvulkanrd.dylib libvulkan.dylib
)
(
  cd "$STAGE/lib"
  [ -f libMoltenVKrd.dylib ] && [ ! -e libMoltenVK.dylib ] && ln -sf libMoltenVKrd.dylib libMoltenVK.dylib
  [ -f libvulkanrd.1.dylib ] && [ ! -e libvulkan.1.dylib ] && ln -sf libvulkanrd.1.dylib libvulkan.1.dylib
  [ -f libvulkanrd.dylib ] && [ ! -e libvulkan.dylib ] && ln -sf libvulkanrd.dylib libvulkan.dylib
)

if [ -f "$REXGLUE_MAC_SDK/share/vulkan/icd.d/MoltenVK_icd.json" ]; then
  cp -f "$REXGLUE_MAC_SDK/share/vulkan/icd.d/MoltenVK_icd.json" \
    "$STAGE/vulkan/share/vulkan/icd.d/"
else
  cat > "$STAGE/vulkan/share/vulkan/icd.d/MoltenVK_icd.json" <<'EOF'
{
  "file_format_version": "1.0.0",
  "ICD": {
    "library_path": "../../../lib/libMoltenVK.dylib",
    "api_version": "1.4.0"
  }
}
EOF
fi

# ISO installer tool (required for the launcher Install tab)
echo "==> Building extract-xiso"
EXTRACT_BUILD="$ROOT/tools/extract-xiso/build"
# Drop a stale CMake cache if this tree was moved (path baked into CMakeCache).
if [ -f "$EXTRACT_BUILD/CMakeCache.txt" ] &&
   ! grep -q "^CMAKE_HOME_DIRECTORY:INTERNAL=$ROOT/tools/extract-xiso$" "$EXTRACT_BUILD/CMakeCache.txt" 2>/dev/null; then
  rm -rf "$EXTRACT_BUILD"
fi
cmake -S "$ROOT/tools/extract-xiso" -B "$EXTRACT_BUILD" -DCMAKE_BUILD_TYPE=Release
cmake --build "$EXTRACT_BUILD" --parallel "$JOBS"
cp -f "$EXTRACT_BUILD/extract-xiso" "$STAGE/extract-xiso"
chmod +x "$STAGE/extract-xiso"

# Bundled ffmpeg for launcher artwork (cutscene stills). Prefer a cached copy.
ensure_ffmpeg() {
  if [ -x "$STAGE/ffmpeg" ]; then
    return 0
  fi
  local cache="$ROOT/dist/.cache/ffmpeg-macos-arm64"
  mkdir -p "$(dirname "$cache")"
  if [ ! -x "$cache" ]; then
    echo "==> Downloading static ffmpeg (macOS arm64) for launcher artwork"
    local zip="$ROOT/dist/.cache/ffmpeg-macos-arm64.zip"
    mkdir -p "$(dirname "$zip")"
    curl -fsSL -o "$zip" \
      "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip"
    local tmp
    tmp="$(mktemp -d)"
    unzip -qo "$zip" -d "$tmp"
    local bin
    bin="$(find "$tmp" -type f -name ffmpeg | head -n1)"
    if [ -z "$bin" ] || [ ! -f "$bin" ]; then
      echo "error: ffmpeg binary missing from download" >&2
      rm -rf "$tmp"
      return 1
    fi
    cp -f "$bin" "$cache"
    chmod +x "$cache"
    rm -rf "$tmp"
  fi
  cp -f "$cache" "$STAGE/ffmpeg"
  chmod +x "$STAGE/ffmpeg"
}
ensure_ffmpeg

# Old Python launcher removed — TSG Launcher (Electron) is the only UI.

if [ -n "$SAVED_TOML" ] && [ -f "$SAVED_TOML" ]; then
  mv "$SAVED_TOML" "$STAGE/simpsons.toml"
else
  cat > "$STAGE/simpsons.toml" <<'EOF'
# The Simpsons Game — macOS defaults. Use the launcher for changes.
gpu_plugin = "xenos"
fullscreen = false
window_width = 1280
window_height = 720
vsync = true
present_letterbox = true
unlock_60fps = true
frame_rate = 60
menu_frame_rate = 30
framerate_limit = 0
audio_maxqframes = 32
audio_pace_callbacks = true
subtitles = false
render_target_path_vulkan = "fbo"
vulkan_allow_present_mode_immediate = false
vulkan_allow_present_mode_mailbox = false
vulkan_allow_present_mode_fifo_relaxed = false
vulkan_log_debug_messages = false
EOF
fi

# Options › GRAPHICS post-install patcher (rewrites player-extracted .str only).
echo "==> Staging gamedata patch tools"
mkdir -p "$STAGE/tools/gamedata-patches"
cp -f "$ROOT/tools/gamedata-patches/apply_options_ui.py" "$STAGE/tools/gamedata-patches/"
cp -f "$ROOT/tools/gamedata-patches/refpack.py" "$STAGE/tools/gamedata-patches/"
chmod +x "$STAGE/tools/gamedata-patches/apply_options_ui.py"

# Highlander menu font for the host Graphics page (not game data).
echo "==> Staging Highlander menu font"
mkdir -p "$STAGE/art/fonts"
FONT_SRC="$ROOT/simpsons/assets/fonts/Highlander ITC Std Bold.otf"
if [ ! -f "$FONT_SRC" ]; then
  FONT_SRC="$ROOT/Highlander ITC Std Bold.otf"
fi
if [ -f "$FONT_SRC" ]; then
  cp -f "$FONT_SRC" "$STAGE/art/fonts/Highlander ITC Std Bold.otf"
else
  echo "warning: Highlander ITC Std Bold.otf missing — Graphics menu will use the default font" >&2
fi
# Never ship ISO-derived launcher stills (copyrighted game frames).
find "$STAGE/art" -maxdepth 1 -type f \( \
  -iname 'hero*.jpg' -o -iname 'hero*.jpeg' -o -iname 'hero*.png' -o -iname 'hero*.webp' \
  -o -name '.attempted*' \
\) -delete 2>/dev/null || true

# Electron launcher (.app)
echo "==> Packaging Electron launcher"
(
  cd "$ROOT/macos/electron-launcher"
  unset ELECTRON_RUN_AS_NODE
  if [ ! -d node_modules/electron ]; then
    npm ci --no-fund --no-audit
  fi
  node scripts/pack-app.js "$STAGE/TSG Launcher.app"
)

cat > "$STAGE/Play.command" <<'EOF'
#!/bin/zsh
cd "$(dirname "$0")"
# Clear quarantine so macOS does not App Translocate the .app away from this folder
# (that leaves a dock icon with no window). Safe on user-owned downloads.
xattr -cr "$PWD" >/dev/null 2>&1 || true
export SIMPSONS_PACKAGE_ROOT="$PWD"
export DYLD_LIBRARY_PATH="$PWD:$PWD/lib:$PWD/vulkan/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export VK_ICD_FILENAMES="$PWD/vulkan/share/vulkan/icd.d/MoltenVK_icd.json"
exec "$PWD/TSG Launcher.app/Contents/MacOS/TSGLauncher"
EOF
chmod +x "$STAGE/Play.command" "$STAGE/simpsons"
rm -f "$STAGE/Fix Mac Gatekeeper.command"

# Electron ships pre-signed helpers. After repack those signatures no longer match,
# and macOS reports the app as "damaged". Apple Silicon also refuses fully unsigned
# binaries (launch fails). Strip broken signatures, then ad-hoc sign inside-out.
echo "==> Replacing broken signatures with ad-hoc codesign (Apple Silicon / Gatekeeper)"
strip_signature() {
  local target="$1"
  [ -e "$target" ] || return 0
  codesign --remove-signature "$target" >/dev/null 2>&1 || true
}
sign_adhoc() {
  local target="$1"
  [ -e "$target" ] || return 0
  codesign --force --sign - --timestamp=none "$target" >/dev/null 2>&1 || \
    codesign --force --sign - "$target" >/dev/null 2>&1 || true
}
strip_machos_under() {
  local root="$1"
  [ -e "$root" ] || return 0
  find "$root" \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' \) 2>/dev/null \
    | while IFS= read -r p; do strip_signature "$p"; done
  find "$root" -type f \( -name '*.dylib' -o -name '*.so' -o -perm -111 \) 2>/dev/null \
    | while IFS= read -r p; do
        case "$(/usr/bin/file -b "$p" 2>/dev/null)" in
          *Mach-O*) strip_signature "$p" ;;
        esac
      done
}
adhoc_sign_app_bundle() {
  local app="$1"
  [ -d "$app" ] || return 0
  # Apple Silicon requires every Mach-O to be signed, including Electron's
  # chrome_crashpad_handler. Sign leaf binaries deepest-first, then bundles.
  find "$app" -type f ! -path '*/.*' 2>/dev/null | while IFS= read -r f; do
    case "$(/usr/bin/file -b "$f" 2>/dev/null)" in
      *Mach-O*) printf '%s\n' "$f" ;;
    esac
  done | awk '{ print length, $0 }' | sort -nr | cut -d' ' -f2- | while IFS= read -r f; do
    sign_adhoc "$f"
  done
  {
    find "$app/Contents/Frameworks" -name '*.app' -type d 2>/dev/null || true
    find "$app/Contents/Frameworks" -name '*.framework' -type d 2>/dev/null || true
    printf '%s\n' "$app"
  } | awk '{ print length, $0 }' | sort -nr | cut -d' ' -f2- | while IFS= read -r b; do
    sign_adhoc "$b"
  done
}
strip_machos_under "$STAGE/TSG Launcher.app"
strip_signature "$STAGE/TSG Launcher.app"
for bin in simpsons extract-xiso ffmpeg; do
  strip_signature "$STAGE/$bin"
done
for dir in "$STAGE" "$STAGE/lib" "$STAGE/vulkan/lib"; do
  [ -d "$dir" ] || continue
  find "$dir" -maxdepth 1 -type f \( -name '*.dylib' -o -perm -111 \) 2>/dev/null \
    | while IFS= read -r p; do
        case "$(/usr/bin/file -b "$p" 2>/dev/null)" in
          *Mach-O*) strip_signature "$p" ;;
        esac
      done
done
adhoc_sign_app_bundle "$STAGE/TSG Launcher.app"
for bin in simpsons extract-xiso ffmpeg; do
  sign_adhoc "$STAGE/$bin"
done
for dir in "$STAGE" "$STAGE/lib" "$STAGE/vulkan/lib"; do
  [ -d "$dir" ] || continue
  find "$dir" -maxdepth 1 -type f \( -name '*.dylib' -o -perm -111 \) 2>/dev/null \
    | while IFS= read -r p; do
        case "$(/usr/bin/file -b "$p" 2>/dev/null)" in
          *Mach-O*) sign_adhoc "$p" ;;
        esac
      done
done

echo "0.2.2" > "$STAGE/VERSION"

cat > "$STAGE/README.md" <<'EOF'
# The Simpsons Game Recompiled — macOS arm64

## First run
1. Unzip the download.
2. Move the whole folder out of Downloads (Desktop is fine).
3. Double-click **Play.command** (preferred) — it clears macOS quarantine so the
   app is not isolated from this folder. Or right-click **TSG Launcher.app** → Open.
4. Use **Install** to pick your own Xbox 360 ISO (not included) and extract it locally.
5. The launcher applies Options › GRAPHICS patches to your files (needs python3 once).
6. Display defaults to a windowed 1280x720 window at 60 FPS. Change settings in TSG Launcher, then press **Play**.

If you only see a dock icon and no window, macOS App Translocation is the cause:
run Play.command, or `xattr -cr` on this folder, then open the app again.

**TSG** = The Simpsons Game. You must own the game. No disc images or game assets are shipped with this build.
EOF

echo "Package ready: $STAGE"
echo "Binary: $STAGE/simpsons"
