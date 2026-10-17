'use strict';

const fs = require('fs');
const path = require('path');
const { compress, decompress } = require('./refpack');

const STAMP = '.tsg_options_ui_patched';
const STAMP_VERSION = 'options-ui-v8';

const APT_SIZE = 50362;
const DOWNLOADS_LIST = Buffer.from('-Downloads-\x00$FE_Downloads\x00\x00\x00\x00\x00\x00');
const CAMERA_PAD31 = Buffer.concat([Buffer.from('Camera'), Buffer.alloc(25)]);

const CONST_DOWNLOADS_SCREEN_ITEM = 1135;
const CONST_DOWNLOADS_SCREEN = Buffer.from('DownloadsScreen\x00');
const CONST_CAMERA_MENU = Buffer.from('CameraMenu\x00\x00\x00\x00\x00\x00');

const UIX_CONST_ITEM = 1276;
const UIX_CONST_OFF = 50416;
const UIX_CONST_ITEM_BASE = UIX_CONST_OFF + 0x20;

const APT_PATCHES = [
  [
    4852,
    [
      Buffer.from('-Video-\x00$FE_Video\x00\x00\x00\x00\x00\x00'),
      Buffer.from('-Graphics-\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'),
      Buffer.concat([Buffer.from('Graphics'), Buffer.alloc(15)]),
    ],
    Buffer.concat([Buffer.from('Graphics'), Buffer.alloc(15)]),
  ],
  [4948, [DOWNLOADS_LIST, CAMERA_PAD31], CAMERA_PAD31],
  [5912, [DOWNLOADS_LIST, CAMERA_PAD31], CAMERA_PAD31],
];

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

function findCi(dirPath, name) {
  const want = name.toLowerCase();
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const entry of entries) {
    if (entry.name.toLowerCase() === want) {
      return path.join(dirPath, entry.name);
    }
  }
  return null;
}

function findStr(gamedata, ...parts) {
  let cur = gamedata;
  for (const part of parts) {
    const nxt = findCi(cur, part);
    if (!nxt) return null;
    cur = nxt;
  }
  try {
    if (fs.statSync(cur).isFile()) return cur;
  } catch (_) {}
  return null;
}

function readU32BE(buf, off) {
  return buf.readUInt32BE(off);
}

function writeU32BE(buf, off, value) {
  buf.writeUInt32BE(value >>> 0, off);
}

function iterChunks(data) {
  if (data.length < 0x20 || data.subarray(0, 4).toString('binary') !== 'SToc') {
    throw new Error('not an SToc .str archive');
  }
  const files = (readU32BE(data, 8) >> 24) & 0xff;
  const info = readU32BE(data, 0x10);
  const chunks = [];
  let off = 0x800;
  for (let i = 0; i < files; i++) {
    const e = info + i * 24;
    const xs = readU32BE(data, e + 16);
    chunks.push({
      index: i,
      e,
      hhHi: data.readUInt32BE(e),
      hhLo: data.readUInt32BE(e + 4),
      sz: readU32BE(data, e + 8),
      ig: readU32BE(data, e + 12),
      xs,
      dm: readU32BE(data, e + 20),
      blob: data.subarray(off, off + xs),
    });
    off += xs;
  }
  return chunks;
}

function findOptionsUix(raw) {
  let idx = 0;
  while (true) {
    const j = raw.indexOf('uixf', idx);
    if (j < 0) return null;
    if (
      raw.subarray(j + 8, j + 12).toString('binary') === 'titl' &&
      raw.subarray(j + 16, j + 40).includes('options')
    ) {
      return j;
    }
    idx = j + 4;
  }
}

function applyAptPatches(apt) {
  const notes = [];
  if (apt.length < APT_SIZE) throw new Error(`options apt too small (${apt.length})`);
  if (apt.subarray(0, 11).toString('binary') !== 'Apt Data:74') {
    throw new Error('bad Apt magic');
  }

  for (const [off, expects, repl] of APT_PATCHES) {
    const cur = apt.subarray(off, off + repl.length);
    if (cur.equals(repl)) continue;
    if (!expects.some((e) => cur.equals(e))) {
      if (off === 4852 || off === 4948) {
        throw new Error(`unexpected bytes at apt+${off}: got ${cur.toString('hex')}`);
      }
      notes.push(`skip apt+${off} (already customized)`);
      continue;
    }
    repl.copy(apt, off);
    notes.push(`patched apt+${off}`);
  }
  if (
    apt.subarray(4852, 4860).equals(Buffer.from('Graphics')) &&
    apt.subarray(4948, 4954).equals(Buffer.from('Camera'))
  ) {
    notes.push('Graphics + Camera labels present');
  }
  return notes;
}

function restoreDownloadsScreenName(raw, uix) {
  const cf = uix + UIX_CONST_OFF;
  const item = uix + UIX_CONST_ITEM_BASE + CONST_DOWNLOADS_SCREEN_ITEM * 8;
  const t = readU32BE(raw, item);
  const v = readU32BE(raw, item + 4);
  if (t !== 1) {
    throw new Error(`const ${CONST_DOWNLOADS_SCREEN_ITEM} type ${t}, expected string(1)`);
  }
  const sOff = cf + v;
  const cur = raw.subarray(sOff, sOff + 16);
  if (cur.equals(CONST_DOWNLOADS_SCREEN)) {
    return 'const 1135 already DownloadsScreen';
  }
  if (cur.equals(CONST_CAMERA_MENU) || cur.subarray(0, 11).equals(Buffer.from('CameraMenu\x00'))) {
    CONST_DOWNLOADS_SCREEN.copy(raw, sOff);
    return 'const 1135 CameraMenu→DownloadsScreen (fix black screen)';
  }
  return `skip const 1135 (got ${cur.toString('hex')})`;
}

function applyConstPatch(raw, uix) {
  const item = uix + UIX_CONST_ITEM_BASE + UIX_CONST_ITEM * 8;
  const t = readU32BE(raw, item);
  const v = readU32BE(raw, item + 4);
  if (t !== 8) {
    throw new Error(`const ${UIX_CONST_ITEM} type ${t}, expected Lookup(8)`);
  }
  if (v === 9) return 'const 1276 already Array';
  if (v !== 23) return `skip const 1276 (lookup ${v})`;
  writeU32BE(raw, item + 4, 9);
  return 'const 1276 Video→Array (keep Graphics row)';
}

function patchStrFile(filePath) {
  const data = Buffer.from(fs.readFileSync(filePath));
  const chunks = iterChunks(data);
  const notes = [];
  let changed = false;

  for (const chunk of chunks) {
    let raw;
    try {
      raw = Buffer.from(decompress(chunk.blob));
    } catch (_) {
      continue;
    }
    const uix = findOptionsUix(raw);
    if (uix == null) continue;
    const aptOff = raw.indexOf('Apt Data:74', uix);
    if (aptOff < 0) continue;

    const apt = Buffer.from(raw.subarray(aptOff, aptOff + APT_SIZE));
    for (const n of applyAptPatches(apt)) {
      notes.push(`${path.basename(filePath)}: ${n}`);
    }
    apt.copy(raw, aptOff);
    notes.push(`${path.basename(filePath)}: ${restoreDownloadsScreenName(raw, uix)}`);
    notes.push(`${path.basename(filePath)}: ${applyConstPatch(raw, uix)}`);

    const newBlob = compress(raw);
    chunk.sz = raw.length;
    chunk.xs = newBlob.length;
    chunk.blob = newBlob;
    changed = true;
    break;
  }

  if (!changed) throw new Error(`no options movie found in ${filePath}`);

  const header = Buffer.from(data.subarray(0, 0x800));
  for (const chunk of chunks) {
    writeU32BE(header, chunk.e, chunk.hhHi);
    writeU32BE(header, chunk.e + 4, chunk.hhLo);
    writeU32BE(header, chunk.e + 8, chunk.sz);
    writeU32BE(header, chunk.e + 12, chunk.ig);
    writeU32BE(header, chunk.e + 16, chunk.xs);
    writeU32BE(header, chunk.e + 20, chunk.dm);
  }
  fs.writeFileSync(filePath, Buffer.concat([header, ...chunks.map((c) => c.blob)]));
  notes.push(`${path.basename(filePath)}: wrote ${fs.statSync(filePath).size} bytes`);
  return notes;
}

function patchGamedata(gamedata) {
  const targets = [
    findStr(gamedata, 'frontend', 'frontend.str'),
    findStr(gamedata, 'simpsons_chars', 'simpsons_chars_global.str'),
  ];
  const missing = [];
  if (!targets[0]) missing.push('frontend.str');
  if (!targets[1]) missing.push('simpsons_chars_global.str');
  if (missing.length) throw new Error('missing ' + missing.join(', '));
  const notes = [];
  for (const filePath of targets) notes.push(...patchStrFile(filePath));
  fs.writeFileSync(path.join(gamedata, STAMP), `${STAMP_VERSION}\n`, 'utf8');
  notes.push(`stamp ${STAMP}`);
  return notes;
}

function applyOptionsUiPatches(paths, { force = false } = {}) {
  if (!fs.existsSync(paths.gamedata)) {
    return { ok: false, skipped: true, message: 'gamedata missing', log: [] };
  }
  if (!force && isOptionsUiPatched(paths)) {
    return { ok: true, skipped: true, message: 'Options UI patches already applied', log: [] };
  }
  try {
    const log = patchGamedata(paths.gamedata);
    return { ok: true, skipped: false, message: 'Options UI patches applied', log };
  } catch (err) {
    return { ok: false, skipped: false, message: `ERROR: ${err.message || err}`, log: [] };
  }
}

module.exports = {
  applyOptionsUiPatches,
  isOptionsUiPatched,
  STAMP_VERSION,
};
