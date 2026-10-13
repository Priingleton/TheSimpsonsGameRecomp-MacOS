'use strict';

const fs = require('fs');
const path = require('path');

const LOGO_MOVIES = ['ealogo', 'ealogo_sd', 'foxlogo', 'foxlogo_sd', 'gracielogo', 'gracielogo_sd'];
const GAMEFLOW_LUA = 'simpsons_gameflow.lua';

const EPISODE_NAMES = {
  SPR_HUB: 'Springfield (hub)',
  LAND_OF_CHOCOLATE: 'Land of Chocolate (original start)',
  BARTMAN_BEGINS: 'Bartman Begins',
  EIGHTY_BITES: 'Around the World in 80 Bites',
  TREEHUGGER: 'Lisa the Tree Hugger',
  MOB_RULES: 'Mob Rules',
  CHEATER: 'Enter the Cheatrix',
  DOLPHINS: 'Day of the Dolphins',
  COLOSSAL_DONUT: 'The Colossal Donut',
  SPRINGFIELD_STOOD_STILL: 'The Day the Earth Stood Stupid',
  BARGAIN_BIN: 'Bargain Bin',
  GAME_HUB: 'Video game world (hub)',
  NEVERQUEST: 'NeverQuest',
  GRAND_THEFT_SCRATCHY: 'Grand Theft Scratchy',
  MEDAL_OF_HOMER: 'Medal of Homer',
  BIG_SUPER: 'Big Super Happy Fun Fun Game',
  RHYMES_WITH_COMPLAINING: 'Rhymes with Complaining',
  MEET_THY_PLAYER: 'Meet Thy Player',
};

const EPISODE_RE = /^([ \t]*)episode\s*=\s*NewEpisode\(\s*game\s*,\s*"([A-Za-z0-9_]+)"/gm;
const SET_DEFAULT_RE = /^[ \t]*episode:SetDefault\(\)[^\r\n]*/gm;

function findCI(dir, name, { folder = false } = {}) {
  try {
    const want = name.toLowerCase();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.toLowerCase() !== want) continue;
      const p = path.join(dir, entry.name);
      if (folder && !entry.isDirectory()) continue;
      if (!folder && entry.isDirectory()) continue;
      return p;
    }
  } catch (_) {}
  return null;
}

function logoMovieFiles(paths, enabled) {
  const movies = findCI(paths.gamedata, 'movies', { folder: true });
  if (!movies) return [];
  const suffix = enabled ? '.vp6' : '.vp6.disabled';
  const names = new Set(LOGO_MOVIES.map((m) => (m + suffix).toLowerCase()));
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(movies, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(movies, d.name))
      .sort();
  } catch (_) {
    return [];
  }
  const out = [];
  for (const dir of dirs) {
    let files = [];
    try {
      files = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((f) => f.isFile())
        .map((f) => f.name)
        .sort();
    } catch (_) {
      continue;
    }
    for (const name of files) {
      if (names.has(name.toLowerCase())) out.push(path.join(dir, name));
    }
  }
  return out;
}

function skipIntroState(paths) {
  const present = logoMovieFiles(paths, true);
  const disabled = logoMovieFiles(paths, false);
  if (!present.length && !disabled.length) return 'unavailable';
  return disabled.length && !present.length ? 'on' : 'off';
}

function setSkipIntro(paths, enabled) {
  const files = logoMovieFiles(paths, enabled);
  if (!files.length && !logoMovieFiles(paths, !enabled).length) {
    return { ok: false, message: 'logo movies not installed' };
  }

  const moves = files.map((src) => {
    const dir = path.dirname(src);
    const name = path.basename(src);
    const dstName = enabled ? `${name}.disabled` : name.slice(0, -'.disabled'.length);
    return { src, dst: path.join(dir, dstName) };
  });

  for (const { src, dst } of moves) {
    if (findCI(path.dirname(dst), path.basename(dst)) !== null) {
      return { ok: false, message: `both enabled and disabled copies of ${path.basename(src)} exist` };
    }
  }

  const completed = [];
  try {
    for (const { src, dst } of moves) {
      fs.renameSync(src, dst);
      completed.push({ src, dst });
    }
  } catch (e) {
    for (const { src, dst } of completed.reverse()) {
      try {
        fs.renameSync(dst, src);
      } catch (_) {}
    }
    return { ok: false, message: String(e.message || e) };
  }
  return {
    ok: true,
    message: `${enabled ? 'skipped' : 'restored'} ${files.length} intro videos`,
  };
}

function gameflowFiles(paths) {
  const lua = findCI(paths.gamedata, GAMEFLOW_LUA);
  if (!lua) return { lua: null, backup: null };
  return { lua, backup: `${lua}.original` };
}

function readLua(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeLuaAtomic(file, text) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeLuaExclusive(file, text) {
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function episodes(text) {
  const found = [];
  const re = new RegExp(EPISODE_RE.source, 'gm');
  let m;
  while ((m = re.exec(text)) !== null) {
    found.push({ id: m[2], indent: m[1], index: m.index, end: m.index + m[0].length });
  }
  return found.map((ep, i) => ({
    id: ep.id,
    indent: ep.indent,
    start: ep.index,
    end: i + 1 < found.length ? found[i + 1].index : text.length,
    matchEnd: ep.end,
  }));
}

function startEpisodeOf(text) {
  const setRe = new RegExp(SET_DEFAULT_RE.source, 'gm');
  for (const ep of episodes(text)) {
    setRe.lastIndex = 0;
    const slice = text.slice(ep.start, ep.end);
    if (setRe.test(slice)) return ep.id;
  }
  return null;
}

function countSetDefault(text) {
  const setRe = new RegExp(SET_DEFAULT_RE.source, 'gm');
  return (text.match(setRe) || []).length;
}

function episodeText(original, episodeId) {
  if (episodeId === startEpisodeOf(original)) return original;

  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original.replace(new RegExp(SET_DEFAULT_RE.source, 'm'), (line) => {
    return line.replace('episode:SetDefault()', '-- episode:SetDefault()') + '  -- start episode moved by the launcher';
  });

  const re = new RegExp(EPISODE_RE.source, 'gm');
  let match = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2] === episodeId) {
      match = m;
      break;
    }
  }
  if (!match) throw new Error('episode not found');

  let lineEnd = text.indexOf('\n', match.index + match[0].length);
  if (lineEnd < 0) {
    text += newline;
    lineEnd = text.length;
  } else {
    lineEnd += 1;
  }
  const insert = `${match[1]}episode:SetDefault()  -- start episode chosen in the launcher${newline}`;
  text = text.slice(0, lineEnd) + insert + text.slice(lineEnd);

  if (startEpisodeOf(text) !== episodeId || countSetDefault(text) !== 1) {
    throw new Error('could not move the start episode');
  }
  return text;
}

function titleCaseEpisode(id) {
  return id
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function startEpisodeState(paths) {
  const { lua } = gameflowFiles(paths);
  if (!lua) return 'unavailable';
  try {
    return startEpisodeOf(readLua(lua)) || 'unavailable';
  } catch (_) {
    return 'unavailable';
  }
}

function startEpisodeOptions(paths) {
  const { lua, backup } = gameflowFiles(paths);
  if (!lua) return [];
  try {
    const source = backup && fs.existsSync(backup) ? backup : lua;
    const text = readLua(source);
    return episodes(text).map((e) => ({
      id: e.id,
      name: EPISODE_NAMES[e.id] || titleCaseEpisode(e.id),
    }));
  } catch (_) {
    return [];
  }
}

function setStartEpisode(paths, episodeId) {
  const { lua, backup } = gameflowFiles(paths);
  if (!lua) return { ok: false, message: 'game data not installed' };

  try {
    const original = readLua(backup && fs.existsSync(backup) ? backup : lua);
    const found = episodes(original);
    const episodeSet = new Set(found.map((e) => e.id));
    const originalStart = startEpisodeOf(original);

    if (!episodeSet.has(episodeId) || originalStart == null) {
      return { ok: false, message: `unknown episode '${episodeId}'` };
    }
    if (episodeSet.size !== found.length || countSetDefault(original) !== 1) {
      return {
        ok: false,
        message: 'unexpected simpsons_gameflow.lua (expected unique episodes and one default)',
      };
    }

    if (backup && fs.existsSync(backup)) {
      const current = readLua(lua);
      const selected = startEpisodeOf(current);
      if (!selected || !episodeSet.has(selected) || current !== episodeText(original, selected)) {
        return {
          ok: false,
          message: 'gameflow was edited outside the launcher; original backup kept',
        };
      }
    }

    const text = episodeText(original, episodeId);
    if (episodeId === originalStart) {
      if (backup && fs.existsSync(backup)) {
        writeLuaAtomic(lua, original);
        fs.unlinkSync(backup);
      }
    } else {
      if (backup && !fs.existsSync(backup)) {
        writeLuaExclusive(backup, original);
      }
      writeLuaAtomic(lua, text);
    }

    const name = EPISODE_NAMES[episodeId] || episodeId;
    return { ok: true, message: `new games start in ${name}` };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

module.exports = {
  skipIntroState,
  setSkipIntro,
  startEpisodeOptions,
  startEpisodeState,
  setStartEpisode,
  EPISODE_NAMES,
};
