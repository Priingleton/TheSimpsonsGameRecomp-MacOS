'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

function resolvePackageRoot() {
  if (process.env.SIMPSONS_PACKAGE_ROOT) {
    return path.resolve(process.env.SIMPSONS_PACKAGE_ROOT);
  }
  // Packaged: .../Package/TSG Launcher.app/Contents/MacOS/<bin>
  if (app.isPackaged) {
    const macOS = path.dirname(process.execPath);
    const appBundle = path.dirname(path.dirname(macOS));
    return path.dirname(appBundle);
  }
  // Dev: prefer staged dist package if present.
  const repo = path.resolve(__dirname, '../../..');
  const staged = path.join(repo, 'dist/TheSimpsonsGame-Recompiled-macOS-arm64');
  if (fs.existsSync(path.join(staged, 'simpsons'))) return staged;
  return staged;
}

function createPaths(packageRoot = resolvePackageRoot()) {
  const root = path.resolve(packageRoot);
  const paths = {
    packageRoot: root,
    userData: path.join(os.homedir(), 'Library/Application Support/simpsons'),
    gameBin: path.join(root, 'simpsons'),
    extractXiso: path.join(root, 'extract-xiso'),
    ffmpeg: path.join(root, 'ffmpeg'),
    gameToml: path.join(root, 'simpsons.toml'),
    gamedata: path.join(root, 'gamedata'),
    art: path.join(root, 'art'),
    backups: path.join(root, 'backups'),
    diagnostics: path.join(root, 'diagnostics'),
    launcherConfig: path.join(root, 'launcher.json'),
    captureMarker: path.join(root, 'capture-armed'),
    versionFile: path.join(root, 'VERSION'),
  };
  for (const dir of [paths.art, paths.backups, paths.diagnostics, paths.userData]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

function versionString(paths) {
  try {
    const v = fs.readFileSync(paths.versionFile, 'utf8').trim();
    if (v) return v;
  } catch (_) {}
  return app.getVersion() || '0.1.0';
}

function engineReady(paths) {
  try {
    fs.accessSync(paths.gameBin, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function engineDate(paths) {
  try {
    const st = fs.statSync(paths.gameBin);
    return st.mtime.toISOString().replace('T', ' ').slice(0, 16);
  } catch (_) {
    return null;
  }
}

function looksLikeGameDirectory(dir) {
  try {
    if (fs.existsSync(path.join(dir, 'default.xex'))) return true;
    if (fs.existsSync(path.join(dir, 'movies'))) return true;
    const entries = fs.readdirSync(dir);
    return entries.some((e) => e.toLowerCase() === 'default.xex' || e.toLowerCase() === 'movies');
  } catch (_) {
    return false;
  }
}

function heroArtFiles(paths) {
  try {
    return fs
      .readdirSync(paths.art)
      .filter((f) => f.startsWith('hero') && f.toLowerCase().endsWith('.jpg'))
      .sort()
      .map((f) => path.join(paths.art, f));
  } catch (_) {
    return [];
  }
}

module.exports = {
  resolvePackageRoot,
  createPaths,
  versionString,
  engineReady,
  engineDate,
  looksLikeGameDirectory,
  heroArtFiles,
};
