'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function loadLauncherConfig(paths) {
  const defaults = {
    diagnostics_enabled: false,
    github_repo: 'YesterMester/TheSimpsonsGameRecomp',
  };
  try {
    if (fs.existsSync(paths.launcherConfig)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(paths.launcherConfig, 'utf8')) };
    }
  } catch (_) {}
  return defaults;
}

function saveLauncherConfig(paths, cfg) {
  fs.writeFileSync(paths.launcherConfig, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

class DiagnosticsService {
  constructor(paths) {
    this.paths = paths;
    this.cfg = loadLauncherConfig(paths);
    this.bundleMessage = '';
    this.captureMessage = '';
  }

  get isEnabled() {
    return !!this.cfg.diagnostics_enabled;
  }

  setEnabled(on) {
    this.cfg.diagnostics_enabled = !!on;
    saveLauncherConfig(this.paths, this.cfg);
  }

  get captureArmed() {
    return fs.existsSync(this.paths.captureMarker);
  }

  setCaptureArmed(on) {
    const dir = path.join(this.paths.diagnostics, 'capture');
    if (on) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.paths.captureMarker, '');
      this.captureMessage = 'Armed — next Play session will capture performance samples.';
    } else {
      try {
        fs.unlinkSync(this.paths.captureMarker);
      } catch (_) {}
      this.captureMessage = 'Capture disarmed.';
    }
  }

  statusMessage() {
    return this.isEnabled
      ? `Logging to ${this.paths.diagnostics}`
      : 'Diagnostic logging is off.';
  }

  lastSummary() {
    const summary = path.join(this.paths.diagnostics, 'last_session.json');
    try {
      return JSON.parse(fs.readFileSync(summary, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  logTail() {
    const log = path.join(this.paths.diagnostics, 'latest.log');
    try {
      return fs.readFileSync(log, 'utf8').split(/\r?\n/).slice(-80);
    } catch (_) {
      return [];
    }
  }

  createSupportBundle() {
    fs.mkdirSync(this.paths.diagnostics, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const zip = path.join(this.paths.diagnostics, `support-${stamp}.zip`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simpsons-support-'));
    try {
      const meta = {
        version: fs.existsSync(this.paths.versionFile)
          ? fs.readFileSync(this.paths.versionFile, 'utf8').trim()
          : '',
        platform: `${os.platform()} ${os.arch()}`,
        release: os.release(),
        when: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(tmp, 'system.json'), JSON.stringify(meta, null, 2));
      if (fs.existsSync(this.paths.gameToml)) {
        fs.copyFileSync(this.paths.gameToml, path.join(tmp, 'simpsons.toml'));
      }
      if (fs.existsSync(this.paths.diagnostics)) {
        for (const f of fs.readdirSync(this.paths.diagnostics)) {
          const src = path.join(this.paths.diagnostics, f);
          if (fs.statSync(src).isFile() && !f.endsWith('.zip')) {
            fs.copyFileSync(src, path.join(tmp, f));
          }
        }
      }
      const r = spawnSync('/usr/bin/zip', ['-r', zip, '.'], { cwd: tmp, stdio: 'ignore' });
      this.bundleMessage =
        r.status === 0 ? `Created ${zip}` : 'Failed to create support bundle';
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch (_) {}
    }
    return this.bundleMessage;
  }

  snapshot() {
    return {
      enabled: this.isEnabled,
      statusMessage: this.statusMessage(),
      lastSummary: this.lastSummary(),
      logTail: this.logTail(),
      captureArmed: this.captureArmed,
      captureMessage: this.captureMessage,
      bundleMessage: this.bundleMessage,
      diagnosticsDirectoryPath: this.paths.diagnostics,
    };
  }
}

module.exports = { DiagnosticsService, loadLauncherConfig, saveLauncherConfig };
