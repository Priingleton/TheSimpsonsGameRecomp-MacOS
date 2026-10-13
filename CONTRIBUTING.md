# Contributing

Contributions are welcome: bug reports, testing, documentation, fixes, and features.
You do not need to know C++ to help. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- This fork is **macOS Apple Silicon only**. Windows/Linux work belongs upstream at
  [YesterMester/TheSimpsonsGameRecomp](https://github.com/YesterMester/TheSimpsonsGameRecomp).
- Check open issues and pull requests so work is not duplicated.
- For anything larger than a small fix, open an issue first to discuss the approach.

## Reporting bugs and suggesting features

Use this repository’s issue templates. For a bug, include:

- Release version or commit (launcher → About)
- macOS version
- Apple Silicon Mac model if known
- Steps to reproduce
- Renderer path and frame-rate settings if relevant

The launcher **Support** tab can create a diagnostics bundle. Remove personal information from
logs before posting. **Do not upload game data, ISOs, XEXs, or extracted assets.**

Accessibility reports are welcome; see [ACCESSIBILITY.md](ACCESSIBILITY.md). Report security
issues privately using [SECURITY.md](SECURITY.md).

## Building and making changes

Fork the repository, branch from `main`, and build with:

```bash
bash macos/build.sh
```

Keep your own ISO and saves backed up when testing.

- Follow the style of the code around your change. Format changed C++ without reformatting
  unrelated files.
- To change game behaviour, prefer overriding a recompiled function in `simpsons/src` over
  editing `simpsons/generated` (produced by the recompiler).
- TSG Launcher settings live in `macos/electron-launcher/main/settings.js` and are written to
  `simpsons.toml`.
- Keep fixes focused. Preserve existing settings, saves, and working renderer paths.
- **Never** include game files, ISOs, extracted assets, `gamedata/`, `userdata/`, build output,
  runtime binaries, shader dumps, or local test captures.
- Preserve other contributors’ authorship and the licences of code you reuse.

## Checking your change

Run what matches your change, and say what you could not test.

- Game or runtime: build with `macos/build.sh`, then play with **your own** game data.
- Launcher (Electron): exercise Install / Settings / Play flows; confirm settings survive a restart.
- Packaging: `bash macos/verify-package.sh` must pass (no ISO/XEX/gamedata files in the package).
- Documentation: check text and links.

The **Build check** workflow must pass on macOS. A passing build does not prove the game works
on every Mac.

## Opening a pull request

Open the pull request against `main`. Keep each pull request to one change, link related issues,
and describe what it fixes or adds, how you tested it, and any remaining limits.

By submitting a pull request, you agree that your contribution is licensed under the licence of
the part of the project it changes (see [License](README.md#license)).
