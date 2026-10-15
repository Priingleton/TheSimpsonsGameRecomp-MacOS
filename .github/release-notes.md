You need your own copy of The Simpsons Game for Xbox 360. No game content is included; the
launcher installs the game from your own ISO.

### macOS 0.2.1

- Fixes “can’t be opened” / launch failure on Apple Silicon downloads: the package is now
  ad-hoc signed inside-out after stripping Electron’s broken post-repack signatures.
- First launch may still show the unidentified-developer warning — right-click → **Open**.

### macOS 0.2.0

- Options › **GRAPHICS** uses a Highlander CRT-style host UI, with the menu font shipped in the package.
- After you install your ISO, the launcher patches your extracted files for the Graphics page automatically (needs python3 once).
