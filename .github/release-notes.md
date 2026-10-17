You need your own copy of The Simpsons Game for Xbox 360. No game content is included; the
launcher installs the game from your own ISO. Launcher artwork is generated after you install —
releases never ship cutscene stills or extracted game data.

### macOS 0.2.2

- Options › **GRAPHICS** Highlander CRT-style host UI (font shipped; menu patches apply after ISO install — no Python).
- Fixes Gatekeeper “damaged” / can’t-open downloads: broken Electron signatures are stripped, then
  the app is ad-hoc signed inside-out for Apple Silicon.
- Fixes dock icon with no window: macOS App Translocation no longer kills startup; **Play.command**
  clears quarantine on the package folder.
- Install / About show the real package and game-data paths.

### First launch

1. Unzip and move the folder out of Downloads (Desktop is fine).
2. Double-click **Play.command** (preferred), or right-click **TSG Launcher.app** → **Open**.
3. Install your own Xbox 360 ISO in the launcher.
