'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const STAMP = '.tsg_options_ui_patched';
const STAMP_VERSION = 'options-ui-v1';

function patcherScript(paths) {
  const candidates = [
    path.join(paths.packageRoot, 'tools', 'gamedata-patches', 'apply_options_ui.py'),
    path.join(__dirname, '..', '..', '..', 'tools', 'gamedata-patches', 'apply_options_ui.py'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function pythonBin() {
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return bin;
  }
  return null;
}

function stampPath(paths) {
  return path.join(paths.gamedata, STAMP);
}

function isOptionsUiPatched(paths) {
  try {
    const text = fs.readFileSync(stampPath(paths), 'utf8');
    return text.trim().startsWith(STAMP_VERSION);
  } catch (_) {
    return false;
  }
}

/**
 * Apply Options › GRAPHICS asset patches to extracted gamedata.
 * Returns { ok, skipped, message, log }.
 */
function applyOptionsUiPatches(paths, { force = false } = {}) {
  if (!fs.existsSync(paths.gamedata)) {
    return { ok: false, skipped: true, message: 'gamedata missing', log: [] };
  }
  if (!force && isOptionsUiPatched(paths)) {
    return { ok: true, skipped: true, message: 'Options UI patches already applied', log: [] };
  }

  const script = patcherScript(paths);
  if (!script) {
    return {
      ok: false,
      skipped: false,
      message: 'patch tool missing (tools/gamedata-patches/apply_options_ui.py)',
      log: [],
    };
  }
  const py = pythonBin();
  if (!py) {
    return {
      ok: false,
      skipped: false,
      message: 'python3 is required once after Install to apply Options UI patches',
      log: [],
    };
  }

  const r = spawnSync(py, [script, paths.gamedata], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const log = `${r.stdout || ''}${r.stderr || ''}`
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  if (r.status !== 0) {
    return {
      ok: false,
      skipped: false,
      message: log.find((l) => l.startsWith('ERROR:')) || 'Options UI patch failed',
      log,
    };
  }
  return { ok: true, skipped: false, message: 'Options UI patches applied', log };
}

module.exports = {
  applyOptionsUiPatches,
  isOptionsUiPatched,
  STAMP_VERSION,
};
