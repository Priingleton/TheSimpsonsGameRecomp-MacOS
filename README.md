# The Simpsons Game Recompiled (macOS)

A native **macOS Apple Silicon** port of *The Simpsons Game* (Xbox 360, 2007). The original PowerPC executable is statically recompiled to arm64 and runs through the ReXGlue runtime, with graphics via **Vulkan on Metal (MoltenVK)** and windowing via **SDL3**.

This fork targets desktop macOS only. It follows the working Apple/MoltenVK path from [TheSimpsonsGame-iOS](https://github.com/DevZer0D4Y/TheSimpsonsGame-iOS). Upstream desktop work for Linux, Steam Deck, and Windows lives at [YesterMester/TheSimpsonsGameRecomp](https://github.com/YesterMester/TheSimpsonsGameRecomp).

**This project does not ship any game assets.** You must provide your own legally obtained Xbox 360 disc image (ISO/XISO). No ISOs, XEXs, movies, levels, or other copyrighted game files are included in this repository or in release downloads.

## Contents

- [Status](#status)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Building from source](#building-from-source)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [Legal](#legal)
- [License](#license)
- [Credits](#credits)

## Status

| Platform | Status |
|---|---|
| macOS (Apple Silicon, arm64) | Playable (SDL3 + MoltenVK) |

Windows and Linux builds are **not** supported in this fork. Use upstream for those platforms.

## Features

- Native arm64 game executable (recompiled PowerPC → C++ → Apple Silicon)
- Vulkan renderer through MoltenVK (Metal)
- **TSG Launcher** (TSG = The Simpsons Game) with Install, Settings, Patches, and Support tabs
- Install from your own Xbox 360 ISO via bundled `extract-xiso`
- 60 FPS gameplay by default, with menu pacing kept closer to the original 30 FPS cadence
- Free camera and photo mode (including screenshots to a folder you choose)
- Ink outline and eye-shading options
- Controller support, plus keyboard and mouse with rebindable keys
- Optional intro logo skip and start-episode selection (patches)

## Requirements

- An **Apple Silicon** Mac (arm64) running **macOS 14** or later
- Your own copy of *The Simpsons Game* for Xbox 360 as an **ISO/XISO**  
  USA title ID **45410809** is the main target; European multi-language discs also work
- Several GB of free disk space for the extracted game data
- A controller is recommended

To build from source you also need Xcode command-line tools, CMake 3.25+, Ninja, Python 3, and Node.js 18+.

## Installation

1. Download the latest **macOS arm64** zip from this repository’s [Releases](../../releases) page (once published).
2. Unzip it anywhere.
3. Open **TSG Launcher.app**, or double-click **Play.command**.
4. On first launch, macOS may ask you to allow an unsigned app: right-click → **Open**, or allow it under System Settings → Privacy & Security.
5. In **Install**, select your own Xbox 360 ISO and extract it locally.
6. Adjust settings if you want, then press **Play**.

The release package never includes game data. TSG Launcher only extracts the ISO you choose on your Mac.

Saves and user data live under `~/Library/Application Support/simpsons`. Photo-mode screenshots default to `~/Pictures/The Simpsons Game` (changeable in Settings).

## Building from source

```bash
bash macos/build.sh
```

This builds the ReXGlue SDK, `extract-xiso`, the `simpsons` game binary, and packages `TSG Launcher.app` into:

```text
dist/TheSimpsonsGame-Recompiled-macOS-arm64/
```

Optional:

```bash
JOBS=6 CONFIG=Release bash macos/build.sh
bash macos/verify-package.sh
```

`verify-package.sh` fails if the package contains disc images, XEXs, or files under `gamedata/`.

### CI

- **Build check** (`.github/workflows/build.yml`) — builds the full macOS package on pushes and pull requests.
- **Release** (`.github/workflows/release.yml`) — builds the package, verifies it contains no game content, zips it, and publishes a GitHub Release (on `v*` tags, or manually via workflow dispatch).

## Configuration

Use the TSG Launcher **Settings** tab. Values are written to `simpsons.toml` next to the game binary. Options that say “Restart needed” apply the next time you press Play.

Useful defaults on Mac:

- Windowed 1280×720
- 60 FPS in levels
- VSync on
- Vulkan render path: FBO (recommended on Mac)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Never commit game files, ISOs, extracted assets, build products, or personal saves. Report security issues privately using [SECURITY.md](SECURITY.md).

## Legal

Unofficial fan project, unaffiliated with Electronic Arts, Fox, Disney, or Microsoft. You must own the game. No ISOs, XEXs, or copyrighted game assets are distributed with this repository or its releases.

## License

Project code is under the [GNU General Public License v3](LICENSE). Vendored third-party libraries (ReXGlue, MoltenVK, SDL3, Electron, and others) keep their own licenses.

## Credits

- Upstream [TheSimpsonsGameRecomp](https://github.com/YesterMester/TheSimpsonsGameRecomp) by YesterMester and contributors
- Working Apple/Vulkan reference: [TheSimpsonsGame-iOS](https://github.com/DevZer0D4Y/TheSimpsonsGame-iOS)
- ReXGlue by Tom Clay; Xenia; MoltenVK, SDL3, and other vendored libraries retain their own licenses
