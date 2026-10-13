# simpsons (macOS game binary)

Apple Silicon build of the recompiled *The Simpsons Game* executable. Players run
it through **TSG Launcher** in the staged package — not by launching this binary
alone unless debugging.

## Build

From the repo root:

```bash
bash macos/build.sh
```

Or, with the ReXGlue SDK already installed at `REXGLUE_MAC_SDK`:

```bash
cd simpsons
cmake --preset mac-arm64-relwithdebinfo -DSIMPSONS_REGENERATE_CODE=OFF
cmake --build --preset mac-arm64-relwithdebinfo
```

Generated recomp sources under `generated/` are checked in. Regenerating them
from a XEX is not part of the normal Mac package build.

## Layout

| Path | Purpose |
|---|---|
| `src/` | Mac hooks (freecam, frame pacing, ink/eyes, …) and `simpsons_app.h` |
| `generated/` | Pre-generated recompiled guest code |
| `config/` | Recompiler hooks / function lists |

This fork is **macOS only**. iOS packaging was removed.
