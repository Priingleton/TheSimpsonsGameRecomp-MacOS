# macOS packaging

Scripts and **TSG Launcher** (Electron) for the Apple Silicon desktop build. There is no Swift launcher in this tree.

## Scripts

| Script | Purpose |
|---|---|
| `build.sh` | Build ReXGlue SDK, `extract-xiso`, `simpsons`, and stage `dist/TheSimpsonsGame-Recompiled-macOS-arm64/` with `TSG Launcher.app` |
| `verify-package.sh` | Fail if the staged package contains ISOs, XEXs, or files under `gamedata/` |

## Electron launcher

Source: `electron-launcher/`. Dependencies are installed with `npm ci` during `build.sh` and are **not** committed (`node_modules/` is gitignored).

```bash
cd macos/electron-launcher
npm ci
npm start   # dev, needs SIMPSONS_PACKAGE_ROOT pointing at a staged package
```

## Legal

Never place disc images or extracted game data under this tree for commits or CI artifacts.
Players supply their own ISO through the launcher.
