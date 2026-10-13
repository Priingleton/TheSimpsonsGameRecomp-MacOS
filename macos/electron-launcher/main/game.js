'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { engineReady, looksLikeGameDirectory } = require('./paths');
const { writeSettings } = require('./settings');

class GameService {
  constructor(paths) {
    this.paths = paths;
    this.child = null;
    this.running = false;
    this.logLines = [];
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
      running: this.running || this.pgrep().length > 0,
      logLines: this.logLines.slice(-200),
    };
  }

  appendLog(line) {
    this.logLines.push(String(line));
    if (this.logLines.length > 400) this.logLines.splice(0, this.logLines.length - 400);
    this.emit();
  }

  pgrep() {
    try {
      const out = execFileSync('/usr/bin/pgrep', ['-f', this.paths.gameBin], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map((x) => parseInt(x, 10))
        .filter((n) => Number.isFinite(n));
    } catch (_) {
      return [];
    }
  }

  refresh() {
    this.running = !!(this.child && !this.child.killed) || this.pgrep().length > 0;
    this.emit();
    return this.snapshot();
  }

  buildEnv() {
    const env = { ...process.env, DISABLE_LSFG: '1' };
    const libs = [this.paths.packageRoot, path.join(this.paths.packageRoot, 'lib'), path.join(this.paths.packageRoot, 'vulkan/lib')]
      .filter((p) => fs.existsSync(p));
    if (env.DYLD_LIBRARY_PATH) libs.push(env.DYLD_LIBRARY_PATH);
    if (libs.length) env.DYLD_LIBRARY_PATH = libs.join(':');
    const icd = path.join(this.paths.packageRoot, 'vulkan/share/vulkan/icd.d/MoltenVK_icd.json');
    if (fs.existsSync(icd)) env.VK_ICD_FILENAMES = icd;
    return env;
  }

  launch() {
    this.refresh();
    if (this.running) return { ok: false, message: 'The game is already running.' };
    if (!engineReady(this.paths)) return { ok: false, message: `Game binary missing at ${this.paths.gameBin}` };
    if (!looksLikeGameDirectory(this.paths.gamedata)) {
      return { ok: false, message: 'Game data is not installed — use Install to extract your ISO.' };
    }

    writeSettings(this.paths.gameToml, {});

    const args = ['--game_data_root', this.paths.gamedata, '--user_data_root', this.paths.userData];
    const child = spawn(this.paths.gameBin, args, {
      cwd: this.paths.packageRoot,
      env: this.buildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.running = true;
    this.appendLog(`Launched game (pid ${child.pid})`);

    const onData = (buf) => {
      const text = buf.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) this.appendLog(line);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      this.running = false;
      this.child = null;
      this.appendLog(`Game exited (${code ?? '?'}).`);
      this.refresh();
    });
    this.emit();
    return { ok: true, message: 'Game started.' };
  }

  stop() {
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
      return;
    }
    for (const pid of this.pgrep()) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (_) {}
    }
    this.refresh();
  }
}

module.exports = { GameService };
