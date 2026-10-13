'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  play: () => ipcRenderer.invoke('game:play'),
  stop: () => ipcRenderer.invoke('game:stop'),
  pickIso: () => ipcRenderer.invoke('install:pickIso'),
  startInstall: (isoPath) => ipcRenderer.invoke('install:start', isoPath),
  backupSaves: () => ipcRenderer.invoke('install:backup'),
  restoreBackup: (name) => ipcRenderer.invoke('install:restore', name),
  regenerateArt: () => ipcRenderer.invoke('art:regenerate'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickShotsDir: () => ipcRenderer.invoke('settings:pickShotsDir'),
  resetShotsDir: () => ipcRenderer.invoke('settings:resetShotsDir'),
  openShotsDir: () => ipcRenderer.invoke('settings:openShotsDir'),
  setSkipIntro: (enabled) => ipcRenderer.invoke('patches:setSkipIntro', enabled),
  setEpisode: (id) => ipcRenderer.invoke('patches:setEpisode', id),
  setDiagnosticsEnabled: (on) => ipcRenderer.invoke('diagnostics:setEnabled', on),
  setCapture: (on) => ipcRenderer.invoke('diagnostics:setCapture', on),
  createBundle: () => ipcRenderer.invoke('diagnostics:bundle'),
  refreshDiagnostics: () => ipcRenderer.invoke('diagnostics:refresh'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  openUpdate: () => ipcRenderer.invoke('updates:open'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  on: (channel, fn) => {
    const allowed = new Set(['game:changed', 'install:changed', 'art:done', 'status']);
    if (!allowed.has(channel)) return () => {};
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
