'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const fs = require('fs');
const path = require('path');

// Prefer overlay scrollbars when Chromium supports them (before ready).
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,FluentOverlayScrollbar');

protocol.registerSchemesAsPrivileged([
  { scheme: 'art', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } },
]);

const {
  createPaths,
  versionString,
  engineReady,
  engineDate,
  looksLikeGameDirectory,
  heroArtFiles,
} = require('./paths');
const {
  readSettings,
  writeSettings,
  SCHEMA,
  CONTROLS,
  OVERLAYS,
  defaultPhotoShotsDir,
} = require('./settings');
const { GameService } = require('./game');
const { generateArt, ffmpegPath } = require('./art');
const { InstallService } = require('./install');
const patches = require('./patches');
const { applyOptionsUiPatches, isOptionsUiPatched } = require('./gamedata_patches');
const { DiagnosticsService } = require('./diagnostics');
const { UpdateService } = require('./updates');

let mainWindow = null;
let paths = null;
let game = null;
let install = null;
let diagnostics = null;
let updates = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#fff6d8',
    title: 'TSG Launcher',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function artUrl(filePath) {
  // Standard URL: host "local", pathname = absolute filesystem path.
  // (Putting the path in the host breaks image loads.)
  return 'art://local' + filePath.split(path.sep).map(encodeURIComponent).join('/');
}

function artPathFromUrl(url) {
  const u = new URL(url);
  // pathname is like /Users/.../hero0.jpg
  return decodeURIComponent(u.pathname);
}

function statusPayload() {
  const arts = heroArtFiles(paths);
  return {
    version: versionString(paths),
    engineReady: engineReady(paths),
    engineDate: engineDate(paths),
    gamedataReady: looksLikeGameDirectory(paths.gamedata),
    art: arts.map((p) => artUrl(p)),
    artCount: arts.length,
    ffmpeg: !!ffmpegPath(paths),
    game: game.snapshot(),
    install: install.snapshot(),
    settings: readSettings(paths.gameToml),
    settingsMeta: { controls: CONTROLS, overlays: OVERLAYS, schema: SCHEMA },
    patches: {
      skipIntro: patches.skipIntroState(paths),
      episode: patches.startEpisodeState(paths),
      episodes: patches.startEpisodeOptions(paths),
    },
    diagnostics: diagnostics.snapshot(),
    updates: updates.snapshot(),
  };
}

app.whenReady().then(() => {
  paths = createPaths();
  game = new GameService(paths);
  install = new InstallService(paths);
  diagnostics = new DiagnosticsService(paths);
  updates = new UpdateService(paths);

  game.onChange((snap) => broadcast('game:changed', snap));
  install.onChange((snap) => broadcast('install:changed', snap));

  protocol.registerFileProtocol('art', (request, callback) => {
    try {
      const filePath = artPathFromUrl(request.url);
      if (!filePath || !path.isAbsolute(filePath)) {
        callback({ error: -2 });
        return;
      }
      callback({ path: filePath });
    } catch (err) {
      callback({ error: -2 });
    }
  });

  createWindow();

  // Apply Options › GRAPHICS asset patches if gamedata is present but not stamped.
  if (looksLikeGameDirectory(paths.gamedata) && !isOptionsUiPatched(paths)) {
    setImmediate(() => {
      const r = applyOptionsUiPatches(paths, { force: false });
      if (!r.skipped) {
        install.append(r.ok ? r.message : `WARNING: ${r.message}`);
        for (const line of (r.log || []).slice(-8)) install.append(line);
        install.emit();
        broadcast('status', statusPayload());
      }
    });
  }

  // Auto-generate art if missing
  if (looksLikeGameDirectory(paths.gamedata) && heroArtFiles(paths).length === 0 && ffmpegPath(paths)) {
    setImmediate(() => {
      install.artRunning = true;
      install.emit();
      const r = generateArt(paths, { force: true });
      install.artRunning = false;
      install.emit();
      broadcast('art:done', r);
      broadcast('status', statusPayload());
    });
  }

  updates.check().then(() => broadcast('status', statusPayload()));
});

app.on('window-all-closed', () => app.quit());

ipcMain.handle('status:get', () => statusPayload());

ipcMain.handle('game:play', () => game.launch());
ipcMain.handle('game:stop', () => {
  game.stop();
  return game.refresh();
});

ipcMain.handle('install:pickIso', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Xbox 360 ISO',
    properties: ['openFile'],
    filters: [{ name: 'Disc images', extensions: ['iso', 'xiso', '360', 'img'] }],
  });
  if (res.canceled || !res.filePaths[0]) return install.snapshot();
  install.isoPath = res.filePaths[0];
  install.emit();
  return install.snapshot();
});

ipcMain.handle('install:start', async (_e, isoPath) => install.startInstall(isoPath));
ipcMain.handle('install:backup', () => install.backupSaves());
ipcMain.handle('install:restore', (_e, name) => install.restoreBackup(name));

ipcMain.handle('art:regenerate', async () => {
  install.artRunning = true;
  install.emit();
  const r = await new Promise((resolve) => {
    setImmediate(() => resolve(generateArt(paths, { force: true })));
  });
  install.artRunning = false;
  install.emit();
  broadcast('status', statusPayload());
  return r;
});

ipcMain.handle('settings:get', () => readSettings(paths.gameToml));
ipcMain.handle('settings:set', (_e, patch) => writeSettings(paths.gameToml, patch));

ipcMain.handle('settings:pickShotsDir', async () => {
  const current = readSettings(paths.gameToml).photo_shots_dir || defaultPhotoShotsDir();
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose screenshot folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current,
  });
  if (res.canceled || !res.filePaths[0]) {
    return readSettings(paths.gameToml);
  }
  return writeSettings(paths.gameToml, { photo_shots_dir: res.filePaths[0] });
});

ipcMain.handle('settings:resetShotsDir', () =>
  writeSettings(paths.gameToml, { photo_shots_dir: defaultPhotoShotsDir() })
);

ipcMain.handle('settings:openShotsDir', async () => {
  const dir = readSettings(paths.gameToml).photo_shots_dir || defaultPhotoShotsDir();
  fs.mkdirSync(dir, { recursive: true });
  const { shell } = require('electron');
  await shell.openPath(dir);
  return { ok: true, path: dir };
});

ipcMain.handle('patches:setSkipIntro', (_e, enabled) => {
  const r = patches.setSkipIntro(paths, enabled);
  return { ...r, state: patches.skipIntroState(paths) };
});
ipcMain.handle('patches:setEpisode', (_e, id) => {
  const r = patches.setStartEpisode(paths, id);
  return { ...r, state: patches.startEpisodeState(paths), episodes: patches.startEpisodeOptions(paths) };
});

ipcMain.handle('diagnostics:setEnabled', (_e, on) => {
  diagnostics.setEnabled(on);
  return diagnostics.snapshot();
});
ipcMain.handle('diagnostics:setCapture', (_e, on) => {
  diagnostics.setCaptureArmed(on);
  return diagnostics.snapshot();
});
ipcMain.handle('diagnostics:bundle', () => {
  diagnostics.createSupportBundle();
  return diagnostics.snapshot();
});
ipcMain.handle('diagnostics:refresh', () => diagnostics.snapshot());

ipcMain.handle('updates:check', async () => updates.check());
ipcMain.handle('updates:open', async () => {
  if (updates.downloadUrl) {
    const { shell } = require('electron');
    await shell.openExternal(updates.downloadUrl);
  }
  return updates.snapshot();
});

ipcMain.handle('shell:openExternal', async (_e, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
});
