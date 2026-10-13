'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { looksLikeGameDirectory, heroArtFiles } = require('./paths');

function ffmpegPath(paths) {
  const candidates = [
    paths.ffmpeg,
    path.join(paths.packageRoot, 'tools/ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch (_) {}
  }
  return null;
}

function extractFrame(ffmpeg, movie, ts, out) {
  const r = spawnSync(
    ffmpeg,
    ['-loglevel', 'error', '-y', '-i', movie, '-ss', ts, '-frames:v', '1', '-q:v', '3', out],
    { timeout: 60000, stdio: 'ignore' }
  );
  try {
    return fs.existsSync(out) && fs.statSync(out).size > 0;
  } catch (_) {
    return false;
  }
}

function generateArt(paths, { force = false } = {}) {
  if (!looksLikeGameDirectory(paths.gamedata)) return { result: 'noGameData' };
  const ffmpeg = ffmpegPath(paths);
  if (!ffmpeg) return { result: 'missingFFmpeg' };

  fs.mkdirSync(paths.art, { recursive: true });
  const marker = path.join(paths.art, '.attempted-v2');
  if (!force && fs.existsSync(marker)) {
    const n = heroArtFiles(paths).length;
    return n > 0 ? { result: 'success', count: n } : { result: 'failed' };
  }

  const moviesRoot = path.join(paths.gamedata, 'movies');
  let movieDir = path.join(moviesRoot, 'en');
  if (!fs.existsSync(movieDir) || !fs.statSync(movieDir).isDirectory()) {
    let langs = [];
    try {
      langs = fs
        .readdirSync(moviesRoot)
        .map((n) => path.join(moviesRoot, n))
        .filter((p) => fs.statSync(p).isDirectory())
        .sort();
    } catch (_) {}
    if (!langs.length) {
      fs.writeFileSync(marker, 'made=0 attempts=0 reason=no-movies\n');
      return { result: 'noMovies' };
    }
    movieDir = langs[0];
  }

  let allVP6 = [];
  try {
    allVP6 = fs.readdirSync(movieDir).filter((f) => f.toLowerCase().endsWith('.vp6'));
  } catch (_) {}
  if (!allVP6.length) {
    fs.writeFileSync(marker, 'made=0 attempts=0 reason=empty-movies\n');
    return { result: 'noMovies' };
  }

  const igc = allVP6
    .filter((n) => n.toLowerCase().includes('_igc') && !n.toLowerCase().includes('_sd'))
    .sort();
  const rest = allVP6
    .filter((n) => {
      const l = n.toLowerCase();
      return !l.includes('_sd') && !l.includes('logo') && !igc.includes(n);
    })
    .sort();
  const candidates = [...igc, ...rest].map((n) => path.join(movieDir, n));

  for (const f of fs.readdirSync(paths.art)) {
    if (f.startsWith('.new') || f.startsWith('.fb')) {
      try {
        fs.unlinkSync(path.join(paths.art, f));
      } catch (_) {}
    }
  }

  const made = [];
  const seen = new Set();
  let attempts = 0;
  for (const mv of candidates) {
    if (made.length >= 24 || attempts >= 48) break;
    for (const ts of ['3.0', '8.0', '14.0']) {
      if (made.length >= 24 || attempts >= 48) break;
      attempts += 1;
      const out = path.join(paths.art, `.new${attempts}.jpg`);
      if (!extractFrame(ffmpeg, mv, ts, out)) {
        try {
          fs.unlinkSync(out);
        } catch (_) {}
        continue;
      }
      const data = fs.readFileSync(out);
      const digest = crypto.createHash('sha1').update(data).digest('hex');
      if (seen.has(digest)) {
        fs.unlinkSync(out);
        continue;
      }
      seen.add(digest);
      if (data.length > 45000) made.push(out);
      else if (data.length > 12000) fs.renameSync(out, path.join(paths.art, `.fb${attempts}.jpg`));
      else fs.unlinkSync(out);
    }
  }

  let frames = made;
  if (!frames.length) {
    frames = fs
      .readdirSync(paths.art)
      .filter((f) => f.startsWith('.fb'))
      .map((f) => path.join(paths.art, f))
      .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
      .slice(0, 8);
  }

  if (frames.length) {
    for (const f of fs.readdirSync(paths.art)) {
      if (f.startsWith('hero') && f.endsWith('.jpg')) {
        try {
          fs.unlinkSync(path.join(paths.art, f));
        } catch (_) {}
      }
    }
    frames.forEach((frame, i) => {
      const dest = path.join(paths.art, `hero${i}.jpg`);
      try {
        fs.renameSync(frame, dest);
      } catch (_) {
        fs.copyFileSync(frame, dest);
        try {
          fs.unlinkSync(frame);
        } catch (_) {}
      }
    });
  }

  for (const f of fs.readdirSync(paths.art)) {
    if (f.startsWith('.new') || f.startsWith('.fb')) {
      try {
        fs.unlinkSync(path.join(paths.art, f));
      } catch (_) {}
    }
  }
  const count = heroArtFiles(paths).length;
  fs.writeFileSync(marker, `made=${count} attempts=${attempts}\n`);
  return count > 0 ? { result: 'success', count } : { result: 'failed' };
}

module.exports = { generateArt, ffmpegPath };
