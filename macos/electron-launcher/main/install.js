'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { looksLikeGameDirectory } = require('./paths');
const { generateArt } = require('./art');

class InstallService {
  constructor(paths) {
    this.paths = paths;
    this.running = false;
    this.artRunning = false;
    this.log = [];
    this.ok = null;
    this.isoPath = '';
    this.backupMessage = '';
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.snapshot());
  }

  snapshot() {
    return {
      running: this.running,
      artRunning: this.artRunning,
      log: this.log.slice(-80),
      ok: this.ok,
      isoPath: this.isoPath,
      statusText: this.statusText(),
      backupMessage: this.backupMessage,
      backups: this.listBackups(),
      gamedataReady: looksLikeGameDirectory(this.paths.gamedata),
    };
  }

  statusText() {
    if (this.running) return 'Extracting…';
    if (this.artRunning) return 'Refreshing artwork…';
    if (looksLikeGameDirectory(this.paths.gamedata)) return 'Game data installed';
    return 'No game data yet — choose an ISO';
  }

  append(line) {
    this.log.push(line);
    this.emit();
  }

  listBackups() {
    try {
      return fs
        .readdirSync(this.paths.backups)
        .filter((f) => f.startsWith('saves-') && f.endsWith('.zip'))
        .map((name) => {
          const p = path.join(this.paths.backups, name);
          const st = fs.statSync(p);
          return {
            name,
            sizeKB: Math.round(st.size / 1024),
            date: st.mtime.toISOString().slice(0, 16).replace('T', ' '),
          };
        })
        .sort((a, b) => (a.name < b.name ? 1 : -1));
    } catch (_) {
      return [];
    }
  }

  backupSaves() {
    fs.mkdirSync(this.paths.backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const dest = path.join(this.paths.backups, `saves-${stamp}.zip`);
    const { spawnSync } = require('child_process');
    if (!fs.existsSync(this.paths.userData)) {
      this.backupMessage = 'No save data yet';
      this.emit();
      return this.snapshot();
    }
    const r = spawnSync('/usr/bin/zip', ['-r', dest, '.'], {
      cwd: this.paths.userData,
      stdio: 'ignore',
    });
    this.backupMessage = r.status === 0 ? `Backed up ${path.basename(dest)}` : 'Backup failed';
    this.emit();
    return this.snapshot();
  }

  restoreBackup(name) {
    const src = path.join(this.paths.backups, path.basename(name));
    if (!fs.existsSync(src)) {
      this.backupMessage = 'Backup not found';
      this.emit();
      return this.snapshot();
    }
    fs.mkdirSync(this.paths.userData, { recursive: true });
    const { spawnSync } = require('child_process');
    const r = spawnSync('/usr/bin/unzip', ['-o', src, '-d', this.paths.userData], { stdio: 'ignore' });
    this.backupMessage = r.status === 0 ? `Restored ${name}` : 'Restore failed';
    this.emit();
    return this.snapshot();
  }

  async startInstall(isoPath) {
    if (this.running) return this.snapshot();
    this.isoPath = isoPath || this.isoPath;
    if (!this.isoPath || !fs.existsSync(this.isoPath)) {
      this.append('ERROR: ISO path missing');
      this.ok = false;
      this.emit();
      return this.snapshot();
    }
    if (!fs.existsSync(this.paths.extractXiso)) {
      this.append(`ERROR: extract-xiso missing at ${this.paths.extractXiso}`);
      this.ok = false;
      this.emit();
      return this.snapshot();
    }

    this.running = true;
    this.ok = null;
    this.log = [];
    this.append(`Extracting ${this.isoPath}`);
    this.emit();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simpsons-xiso-'));
    try {
      await new Promise((resolve, reject) => {
        // macOS getopt stops at the first non-option, so -d MUST come before the ISO path.
        // Otherwise extract-xiso creates a folder named after the ISO in cwd (often the
        // .app bundle → "Read-only file system").
        const child = spawn(
          this.paths.extractXiso,
          ['-x', '-d', tmp, this.isoPath],
          {
            cwd: tmp,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );
        child.stdout.on('data', (b) => this.append(b.toString('utf8').trimEnd()));
        child.stderr.on('data', (b) => this.append(b.toString('utf8').trimEnd()));
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`extract-xiso exited ${code}`))));
      });

      // Find game directory containing default.xex
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        if (entries.some((e) => e.name.toLowerCase() === 'default.xex')) return dir;
        for (const e of entries) {
          if (e.isDirectory()) {
            const hit = walk(path.join(dir, e.name));
            if (hit) return hit;
          }
        }
        return null;
      };
      const gameDir = walk(tmp);
      if (!gameDir) throw new Error('Could not find default.xex in extracted ISO');

      this.append('Installing game data…');
      if (fs.existsSync(this.paths.gamedata)) {
        const prev = path.join(this.paths.packageRoot, 'gamedata_previous');
        try {
          fs.rmSync(prev, { recursive: true, force: true });
        } catch (_) {}
        fs.renameSync(this.paths.gamedata, prev);
        this.append('(previous game data kept as gamedata_previous)');
      }
      fs.renameSync(gameDir, this.paths.gamedata);

      this.append('Generating launcher artwork…');
      this.artRunning = true;
      this.emit();
      const art = generateArt(this.paths, { force: true });
      this.artRunning = false;
      if (art.result === 'success') this.append(`Launcher artwork ready (${art.count} pictures).`);
      else if (art.result === 'missingFFmpeg') this.append('Skipped artwork — ffmpeg missing.');
      else this.append('Artwork generation did not produce pictures.');

      this.append('DONE! The game is installed and ready to play.');
      this.ok = true;
    } catch (err) {
      this.append(`ERROR: ${err.message || err}`);
      this.ok = false;
    } finally {
      this.running = false;
      this.artRunning = false;
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch (_) {}
      this.emit();
    }
    return this.snapshot();
  }
}

module.exports = { InstallService };
