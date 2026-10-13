'use strict';

const https = require('https');
const { loadLauncherConfig } = require('./diagnostics');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'TSGLauncher', Accept: 'application/vnd.github+json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
  });
}

class UpdateService {
  constructor(paths) {
    this.paths = paths;
    this.message = 'Not checked yet';
    this.updateAvailable = false;
    this.latestTag = '';
    this.downloadUrl = null;
    this.applying = false;
    this.applyMessage = '';
  }

  async check() {
    const cfg = loadLauncherConfig(this.paths);
    const repo = cfg.github_repo || '';
    if (!repo) {
      this.message = 'No update feed configured for this build.';
      this.updateAvailable = false;
      return this.snapshot();
    }
    try {
      const json = await getJSON(`https://api.github.com/repos/${repo}/releases/latest`);
      this.latestTag = json.tag_name || '';
      this.downloadUrl = json.html_url || null;
      this.message = this.latestTag
        ? `Latest release: ${this.latestTag}`
        : 'No releases found.';
      this.updateAvailable = false;
    } catch (e) {
      this.message = `Update check failed: ${e.message}`;
      this.updateAvailable = false;
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      message: this.message,
      updateAvailable: this.updateAvailable,
      latestTag: this.latestTag,
      downloadUrl: this.downloadUrl,
      applying: this.applying,
      applyMessage: this.applyMessage,
    };
  }
}

module.exports = { UpdateService };
