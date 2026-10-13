/* global launcher */
'use strict';

const TABS = [
  { id: 'play', title: 'Play' },
  { id: 'install', title: 'Install' },
  { id: 'settings', title: 'Settings' },
  { id: 'patches', title: 'Patches' },
  { id: 'support', title: 'Support' },
  { id: 'about', title: 'About' },
];

const state = {
  tab: 'play',
  status: null,
  heroIndex: 0,
  toastTimer: null,
};

const el = {
  nav: document.getElementById('nav'),
  main: document.getElementById('main'),
  version: document.getElementById('version'),
  toast: document.getElementById('toast'),
};

function toast(msg) {
  if (!msg) return;
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3200);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setTab(id) {
  state.tab = id;
  renderNav();
  renderMain();
}

function renderNav() {
  el.nav.innerHTML = TABS.map(
    (t) =>
      `<button type="button" class="nav-btn${state.tab === t.id ? ' active' : ''}" data-tab="${t.id}">${esc(
        t.title
      )}</button>`
  ).join('');
  el.nav.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
}

function statusLine() {
  const s = state.status;
  if (!s) return 'Loading…';
  if (s.game?.running) return 'Game running';
  if (s.install?.running) return s.install.statusText || 'Installing…';
  if (s.install?.artRunning) return 'Refreshing artwork…';
  if (!s.engineReady) return 'Engine binary missing';
  if (!s.gamedataReady) return 'Install your ISO to play';
  return 'Ready to play';
}

function heroSrc() {
  const arts = state.status?.art || [];
  if (!arts.length) return '';
  return arts[state.heroIndex % arts.length];
}

function playLogText() {
  const log = (state.status?.game?.logLines || []).join('\n');
  return log || 'No log yet.';
}

function renderPlay() {
  const s = state.status;
  const running = !!s?.game?.running;
  const art = heroSrc();
  const engine = s?.engineReady
    ? s.engineDate
      ? `Ready · ${esc(s.engineDate)}`
      : 'Ready'
    : 'Missing';
  const data = s?.gamedataReady ? 'Installed' : 'Not installed';
  const controls = s?.settings?.mnk_mode ? 'Keyboard & mouse' : 'Controller';

  return `
    <div class="hero">
      ${art ? `<img id="heroImg" src="${esc(art)}" alt="" />` : ''}
      <div class="scrim"></div>
      <div class="copy">
        <h1>TSG Launcher</h1>
        <div class="status" id="playStatus">${esc(statusLine())}</div>
      </div>
    </div>
    <div class="row">
      <button type="button" class="btn primary" id="btnPlay" ${running || !s?.engineReady || !s?.gamedataReady ? 'disabled' : ''}>Play</button>
      <button type="button" class="btn" id="btnStop" ${running ? '' : 'disabled'}>Stop</button>
      <span class="grow"></span>
      <button type="button" class="btn" id="btnArt" ${s?.ffmpeg && s?.gamedataReady ? '' : 'disabled'}>Refresh art</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Engine</div><div class="v" id="statEngine">${engine}</div></div>
      <div class="stat"><div class="k">Game data</div><div class="v" id="statData">${data}</div></div>
      <div class="stat"><div class="k">Controls</div><div class="v" id="statControls">${controls}</div></div>
    </div>
    <div class="log" id="playLog">${esc(playLogText())}</div>
  `;
}

/** Update Play tab live fields without rebuilding the log (keeps scroll). */
function patchPlay() {
  if (state.tab !== 'play' || !document.getElementById('playLog')) return false;
  const s = state.status;
  const running = !!s?.game?.running;
  const status = document.getElementById('playStatus');
  if (status) status.textContent = statusLine();
  const play = document.getElementById('btnPlay');
  const stop = document.getElementById('btnStop');
  if (play) play.disabled = running || !s?.engineReady || !s?.gamedataReady;
  if (stop) stop.disabled = !running;
  const artBtn = document.getElementById('btnArt');
  if (artBtn) artBtn.disabled = !(s?.ffmpeg && s?.gamedataReady);
  const engine = document.getElementById('statEngine');
  if (engine) {
    engine.textContent = s?.engineReady
      ? s.engineDate
        ? `Ready · ${s.engineDate}`
        : 'Ready'
      : 'Missing';
  }
  const data = document.getElementById('statData');
  if (data) data.textContent = s?.gamedataReady ? 'Installed' : 'Not installed';
  const controls = document.getElementById('statControls');
  if (controls) controls.textContent = s?.settings?.mnk_mode ? 'Keyboard & mouse' : 'Controller';

  const logEl = document.getElementById('playLog');
  if (logEl) {
    const next = playLogText();
    if (logEl.textContent !== next) {
      const sel = window.getSelection();
      const selectingInLog =
        sel && !sel.isCollapsed && logEl.contains(sel.anchorNode) && logEl.contains(sel.focusNode);
      // Don't replace text while the user is highlighting — it clears the selection.
      if (!selectingInLog) {
        const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
        const prevTop = logEl.scrollTop;
        logEl.textContent = next;
        logEl.scrollTop = nearBottom ? logEl.scrollHeight : prevTop;
      }
    }
  }
  return true;
}

function renderInstall() {
  const i = state.status?.install || {};
  const backups = i.backups || [];
  return `
    <h1>Install</h1>
    <p class="lead">Extract your own Xbox 360 ISO into this package. Nothing is downloaded for you.</p>
    <div class="panel">
      <h2>Disc image</h2>
      <div class="row">
        <input type="text" class="grow" id="isoPath" readonly value="${esc(i.isoPath || '')}" placeholder="No ISO selected" />
        <button type="button" class="btn" id="btnPickIso" ${i.running ? 'disabled' : ''}>Choose ISO…</button>
        <button type="button" class="btn primary" id="btnInstall" ${i.running || !i.isoPath ? 'disabled' : ''}>Extract</button>
      </div>
      <div class="hint">${esc(i.statusText || '')}</div>
    </div>
    <div class="panel">
      <h2>Save backups</h2>
      <div class="row">
        <button type="button" class="btn" id="btnBackup" ${i.running ? 'disabled' : ''}>Back up saves</button>
      </div>
      <div class="hint">${esc(i.backupMessage || 'Zip copies of userdata go into backups/.')}</div>
      ${
        backups.length
          ? `<div class="stack" style="margin-top:10px">${backups
              .map(
                (b) =>
                  `<div class="row"><span class="grow">${esc(b.name)} · ${esc(b.date)} · ${b.sizeKB} KB</span>
                   <button type="button" class="btn" data-restore="${esc(b.name)}">Restore</button></div>`
              )
              .join('')}</div>`
          : ''
      }
    </div>
    <div class="panel">
      <h2>Log</h2>
      <textarea readonly>${esc((i.log || []).join('\n'))}</textarea>
    </div>
  `;
}

function select(key, options, value) {
  return `<select data-set="${esc(key)}">${options
    .map(([label, v]) => {
      const selected = String(v) === String(value) ? ' selected' : '';
      return `<option value="${esc(v)}"${selected}>${esc(label)}</option>`;
    })
    .join('')}</select>`;
}

function check(key, label, value) {
  return `<label class="check"><input type="checkbox" data-bool="${esc(key)}" ${value ? 'checked' : ''}/> ${esc(
    label
  )}</label>`;
}

function field(label, control, hint) {
  return `<label class="field"><span>${esc(label)}</span><div>${control}${
    hint ? `<div class="hint">${esc(hint)}</div>` : ''
  }</div></label>`;
}

function textField(key, value) {
  return `<input type="text" data-set="${esc(key)}" value="${esc(value)}" />`;
}

function renderSettings() {
  const s = state.status?.settings || {};
  const meta = state.status?.settingsMeta || {};
  const controls = meta.controls || [];
  const overlays = meta.overlays || [];

  const display = `
    <div class="panel"><h2>Display</h2>
      ${field(
        'Display mode',
        select('fullscreen', [
          ['Windowed', false],
          ['Fullscreen', true],
        ], s.fullscreen)
      )}
      ${field(
        'Game video mode',
        select(
          'resolution',
          [
            ['Automatic (recommended)', ''],
            ['720p', '720p'],
            ['1080p', '1080p'],
            ['1440p', '1440p'],
            ['4K', '4k'],
          ],
          s.resolution
        ),
        'Restart needed. Sets the game TV size and the starting window size.'
      )}
      ${field(
        'Renderer',
        select(
          'render_target_path_vulkan',
          [
            ['FBO (recommended on Mac)', 'fbo'],
            ['Native (GPU render targets)', 'native'],
            ['Legacy (Xbox EDRAM emulation)', 'fsi'],
          ],
          s.render_target_path_vulkan
        ),
        'Restart needed. FBO is the usual Mac pick; Native and Legacy are fine if you prefer them.'
      )}
      ${check('vsync', 'VSync', s.vsync)}
      ${check('present_letterbox', 'Letterbox non-native aspect ratios', s.present_letterbox)}
    </div>`;

  const quality = `
    <div class="panel"><h2>Quality</h2>
      ${field(
        'Render resolution',
        select(
          'resolution_scale',
          [
            ['1× — 720p', 1],
            ['2× — 1440p', 2],
            ['3× — 4K', 3],
          ],
          s.resolution_scale
        ),
        'Restart needed. How many pixels the game draws.'
      )}
      ${field(
        'Anti-aliasing',
        select(
          'swap_post_effect',
          [
            ['Off', 'none'],
            ['FXAA', 'fxaa'],
            ['FXAA Extreme', 'fxaa_extreme'],
          ],
          s.swap_post_effect
        ),
        'Restart needed.'
      )}
      ${field(
        "Characters' eyes",
        select(
          'eye_shading',
          [
            ['Clean', 'clean'],
            ['Original', 'original'],
          ],
          s.eye_shading
        ),
        'Restart needed.'
      )}
      ${field(
        'Texture filtering',
        select(
          'anisotropic_override',
          [
            ['Off', 0],
            ['2×', 2],
            ['4× (default)', 3],
            ['8×', 4],
            ['16×', 5],
          ],
          s.anisotropic_override
        )
      )}
    </div>`;

  const ink = `
    <div class="panel"><h2>Ink outlines</h2>
      ${field(
        'Outlines',
        select(
          'ink_outlines',
          [
            ['Hard (original)', 'original'],
            ['Soft', 'soft'],
            ['Off', 'off'],
          ],
          s.ink_outlines
        ),
        'Restart needed.'
      )}
      ${field(
        'Soft line strength',
        `<input type="range" min="0.1" max="1" step="0.05" data-float="ink_outline_strength" value="${esc(
          s.ink_outline_strength ?? 0.6
        )}" />`,
        'Only used when Outlines is Soft. Restart needed.'
      )}
      ${field('Line colour (RRGGBB)', textField('ink_outline_color', s.ink_outline_color), 'Restart needed.')}
    </div>`;

  const fps = `
    <div class="panel"><h2>Frame rate</h2>
      ${field(
        'Frame rate in levels',
        select(
          'frame_rate',
          [
            ['30 FPS', 30],
            ['60 FPS (default)', 60],
            ['90 FPS', 90],
            ['120 FPS', 120],
            ['Unlimited', 0],
          ],
          s.frame_rate
        ),
        'Restart needed. Turn VSync off to go above your display refresh rate.'
      )}
      ${field(
        'Frame rate in menus',
        select(
          'menu_frame_rate',
          [
            ['30 FPS — as made', 30],
            ['Same as in levels', 0],
          ],
          s.menu_frame_rate
        ),
        'Restart needed.'
      )}
    </div>`;

  const input = `
    <div class="panel"><h2>Keyboard & mouse</h2>
      ${check('mnk_mode', 'Play with keyboard & mouse', s.mnk_mode)}
      ${field(
        'Mouse sensitivity',
        `<input type="range" min="0.2" max="3" step="0.1" data-float="mnk_sensitivity" value="${esc(
          s.mnk_sensitivity ?? 1
        )}" />`
      )}
      ${controls
        .map(([key, label]) => field(label, textField(key, s[key] ?? '')))
        .join('')}
      <button type="button" class="btn" id="btnResetControls">Reset all controls</button>
    </div>`;

  const overlay = `
    <div class="panel"><h2>In-game overlays</h2>
      ${check('show_fps', 'Show FPS counter (top right)', s.show_fps)}
      <p class="hint">Toggle in-game with the FPS key below (default F10).</p>
      ${overlays.map(([key, label]) => field(label, textField(key, s[key] ?? ''))).join('')}
    </div>`;

  const game = `
    <div class="panel"><h2>Game</h2>
      ${field(
        'Language',
        select(
          'user_language',
          [
            ['English', 1],
            ['日本語', 2],
            ['Deutsch', 3],
            ['Français', 4],
            ['Español', 5],
            ['Italiano', 6],
          ],
          s.user_language
        )
      )}
      ${check('subtitles', 'Always show subtitles', s.subtitles)}
    </div>`;

  const shots = `
    <div class="panel"><h2>Photo screenshots</h2>
      ${field(
        'Save folder',
        `<div class="path-row">
          <input type="text" class="grow" data-set="photo_shots_dir" value="${esc(
            s.photo_shots_dir || ''
          )}" />
          <button type="button" class="btn" id="btnPickShotsDir">Browse…</button>
          <button type="button" class="btn" id="btnResetShotsDir">Default</button>
          <button type="button" class="btn" id="btnOpenShotsDir">Open</button>
        </div>`,
        'Restart needed. Default is Pictures/The Simpsons Game. Photo mode: F8, then F9 or controller A.'
      )}
    </div>`;

  const audio = `
    <div class="panel"><h2>Audio</h2>
      ${check('audio_mute', 'Mute all audio', s.audio_mute)}
      ${field(
        'Audio buffer',
        select(
          'audio_maxqframes',
          [
            ['Small — lowest latency', 16],
            ['Normal (recommended)', 32],
            ['Large — most stutter-resistant', 64],
          ],
          s.audio_maxqframes
        ),
        'Restart needed.'
      )}
      ${check('audio_pace_callbacks', 'Pace audio callbacks (recommended on Mac)', s.audio_pace_callbacks)}
    </div>`;

  return `
    <h1>Settings</h1>
    <p class="lead">Changes save as you make them. Restart the game for options that say so.</p>
    ${display}${quality}${ink}${fps}${input}${overlay}${game}${shots}${audio}
  `;
}

function renderPatches() {
  const p = state.status?.patches || {};
  const skip = p.skipIntro;
  const episode = p.episode;
  const episodes = p.episodes || [];
  const skipDisabled = skip === 'unavailable';
  const epDisabled = episode === 'unavailable';

  return `
    <h1>Patches</h1>
    <p class="lead">Optional tweaks that edit installed game data on disk.</p>
    <div class="panel">
      <h2>Skip intro logos</h2>
      <div class="row">
        <button type="button" class="btn ${skip === 'on' ? 'primary' : ''}" id="btnSkipOn" ${
          skipDisabled ? 'disabled' : ''
        }>On</button>
        <button type="button" class="btn ${skip === 'off' ? 'primary' : ''}" id="btnSkipOff" ${
          skipDisabled ? 'disabled' : ''
        }>Off</button>
      </div>
      <div class="hint">${
        skipDisabled
          ? 'Install game data first (logo movies live under movies/).'
          : skip === 'on'
            ? 'Intro logos are skipped.'
            : 'Intro logos play normally.'
      }</div>
    </div>
    <div class="panel">
      <h2>Start episode</h2>
      <label class="field"><span>Episode</span>
        <select id="episodeSelect" ${epDisabled ? 'disabled' : ''}>
          ${episodes
            .map(
              (e) =>
                `<option value="${esc(e.id)}" ${e.id === episode ? 'selected' : ''}>${esc(e.name)}</option>`
            )
            .join('')}
        </select>
      </label>
      <div class="hint">${
        epDisabled
          ? 'Install game data first (needs simpsons_gameflow.lua).'
          : 'Changes which episode loads from a new game / hub start.'
      }</div>
    </div>
  `;
}

function renderSupport() {
  const d = state.status?.diagnostics || {};
  const summary = d.lastSummary
    ? JSON.stringify(d.lastSummary, null, 2)
    : 'No last session summary yet.';
  return `
    <h1>Support</h1>
    <p class="lead">Optional logging for troubleshooting. Off by default.</p>
    <div class="panel">
      <h2>Diagnostics</h2>
      ${check('__diag_enabled', 'Enable diagnostic logging', d.enabled)}
      <div class="hint">${esc(d.statusMessage || '')}</div>
      ${check('__diag_capture', 'Arm performance capture for next Play', d.captureArmed)}
      <div class="hint">${esc(d.captureMessage || '')}</div>
      <div class="row" style="margin-top:10px">
        <button type="button" class="btn" id="btnBundle">Create support bundle</button>
        <button type="button" class="btn" id="btnRefreshDiag">Refresh</button>
      </div>
      <div class="hint">${esc(d.bundleMessage || '')}</div>
    </div>
    <div class="panel">
      <h2>Last session</h2>
      <textarea readonly>${esc(summary)}</textarea>
    </div>
    <div class="panel">
      <h2>Log tail</h2>
      <textarea readonly>${esc((d.logTail || []).join('\n'))}</textarea>
    </div>
  `;
}

function renderAbout() {
  const s = state.status;
  const u = s?.updates || {};
  return `
    <h1>About</h1>
    <div class="panel">
      <h2>Updates</h2>
      <div class="row">
        <button type="button" class="btn" id="btnCheckUpdates">Check for updates</button>
        <button type="button" class="btn primary ${u.updateAvailable ? '' : 'hidden'}" id="btnOpenUpdate">Update now</button>
      </div>
      <div class="hint">${esc(u.applying ? u.applyMessage : u.message)}</div>
    </div>
    <div class="panel">
      <h2>TSG Launcher</h2>
      <p><b>TSG</b> = The Simpsons Game. This is the macOS Apple Silicon launcher for the recompiled Xbox 360 game. PowerPC code is statically recompiled to arm64 and runs through ReXGlue, with Vulkan on Metal (MoltenVK) and SDL3. No original game assets ship with this package.</p>
      <div class="hint">Version ${esc(s?.version || '')}</div>
    </div>
    <div class="panel">
      <h2>This build</h2>
      <div class="hint">Platform  ·  macOS Apple Silicon</div>
      <div class="hint">Graphics  ·  Vulkan via MoltenVK</div>
    </div>
    <div class="panel">
      <h2>Lineage</h2>
      <p>This macOS project is a new fork built on top of the desktop recomp and the iOS Apple/MoltenVK work — not a rebrand of either upstream.</p>
      <div class="hint">Desktop recomp (upstream)</div>
      <a class="link" data-url="https://github.com/YesterMester/TheSimpsonsGameRecomp">https://github.com/YesterMester/TheSimpsonsGameRecomp</a>
      <div class="hint" style="margin-top:8px">iOS port (Apple / MoltenVK path)</div>
      <a class="link" data-url="https://github.com/DevZer0D4Y/TheSimpsonsGame-iOS">https://github.com/DevZer0D4Y/TheSimpsonsGame-iOS</a>
    </div>
    <div class="panel">
      <h2>Credits</h2>
      <p>YesterMester and contributors — TheSimpsonsGameRecomp.</p>
      <p>DevZer0D4Y — TheSimpsonsGame-iOS (working Apple Silicon / MoltenVK path this Mac build follows).</p>
      <p>tronuo — 60 FPS patch and Havok physics fix.</p>
      <p>Tom Clay — ReXGlue. The Xenia project — GPU/kernel foundations.</p>
      <p>Static recompilation approach in the spirit of XenonRecomp.</p>
      <p>MoltenVK, SDL3, Dear ImGui, glslang / SPIRV-Tools, FFmpeg, spdlog, fmt, Tracy, and other vendored libraries — their authors; each keeps its own license.</p>
    </div>
    <div class="panel">
      <h2>Legal</h2>
      <p>The Simpsons Game © 2007 Electronic Arts / Fox. Unofficial fan project, unaffiliated with EA, Fox, Disney, or Microsoft. Contains no original game assets; it only reads data from a copy you legally own. No warranty.</p>
    </div>
  `;
}

function renderMain() {
  const renderers = {
    play: renderPlay,
    install: renderInstall,
    settings: renderSettings,
    patches: renderPatches,
    support: renderSupport,
    about: renderAbout,
  };
  el.main.innerHTML = (renderers[state.tab] || renderPlay)();
  wireMain();
}

function coerce(schema, key, raw) {
  const typ = schema?.[key]?.[0];
  if (typ === 'bool') return raw === true || raw === 'true';
  if (typ === 'int') return parseInt(raw, 10);
  if (typ === 'float') return parseFloat(raw);
  return String(raw);
}

async function patchSettings(patch) {
  const next = await launcher.setSettings(patch);
  if (state.status) state.status.settings = next;
  toast('Saved');
}

function wireMain() {
  const s = state.status;
  const schema = s?.settingsMeta?.schema;

  if (state.tab === 'play') {
    document.getElementById('btnPlay')?.addEventListener('click', async () => {
      const r = await launcher.play();
      if (r?.message) toast(r.message);
      await refresh();
    });
    document.getElementById('btnStop')?.addEventListener('click', async () => {
      await launcher.stop();
      await refresh();
    });
    document.getElementById('btnArt')?.addEventListener('click', async () => {
      toast('Refreshing artwork…');
      const r = await launcher.regenerateArt();
      toast(r?.ok ? `Art ready (${r.count || 0})` : r?.message || 'Art refresh failed');
      await refresh();
    });
  }

  if (state.tab === 'install') {
    document.getElementById('btnPickIso')?.addEventListener('click', async () => {
      const snap = await launcher.pickIso();
      if (state.status) state.status.install = snap;
      renderMain();
    });
    document.getElementById('btnInstall')?.addEventListener('click', async () => {
      const iso = state.status?.install?.isoPath;
      if (!iso) return;
      toast('Extracting…');
      await launcher.startInstall(iso);
      await refresh();
    });
    document.getElementById('btnBackup')?.addEventListener('click', async () => {
      const snap = await launcher.backupSaves();
      if (state.status) state.status.install = snap;
      toast(snap.backupMessage || 'Backup done');
      renderMain();
    });
    el.main.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const snap = await launcher.restoreBackup(btn.dataset.restore);
        if (state.status) state.status.install = snap;
        toast(snap.backupMessage || 'Restored');
        renderMain();
      });
    });
  }

  if (state.tab === 'settings') {
    el.main.querySelectorAll('[data-set]').forEach((node) => {
      const key = node.dataset.set;
      const apply = async () => {
        let val = node.value;
        if (key === 'fullscreen') val = val === 'true';
        else val = coerce(schema, key, val);
        await patchSettings({ [key]: val });
      };
      node.addEventListener('change', apply);
      if (node.tagName === 'INPUT' && node.type === 'text') {
        node.addEventListener('blur', apply);
      }
    });
    el.main.querySelectorAll('[data-bool]').forEach((node) => {
      node.addEventListener('change', async () => {
        await patchSettings({ [node.dataset.bool]: node.checked });
      });
    });
    el.main.querySelectorAll('[data-float]').forEach((node) => {
      node.addEventListener('change', async () => {
        await patchSettings({ [node.dataset.float]: parseFloat(node.value) });
      });
    });
    document.getElementById('btnResetControls')?.addEventListener('click', async () => {
      const defaults = {};
      for (const [key, [, def]] of Object.entries(schema || {})) {
        if (key.startsWith('keybind_') || key.startsWith('bind_') || key === 'mnk_sensitivity') {
          defaults[key] = def;
        }
      }
      defaults.mnk_mode = false;
      await patchSettings(defaults);
      await refresh();
    });
    document.getElementById('btnPickShotsDir')?.addEventListener('click', async () => {
      const next = await launcher.pickShotsDir();
      if (state.status) state.status.settings = next;
      toast('Saved');
      renderMain();
    });
    document.getElementById('btnResetShotsDir')?.addEventListener('click', async () => {
      const next = await launcher.resetShotsDir();
      if (state.status) state.status.settings = next;
      toast('Saved');
      renderMain();
    });
    document.getElementById('btnOpenShotsDir')?.addEventListener('click', async () => {
      const r = await launcher.openShotsDir();
      if (r?.path) toast(r.path);
    });
  }

  if (state.tab === 'patches') {
    document.getElementById('btnSkipOn')?.addEventListener('click', async () => {
      const r = await launcher.setSkipIntro(true);
      toast(r.message);
      await refresh();
    });
    document.getElementById('btnSkipOff')?.addEventListener('click', async () => {
      const r = await launcher.setSkipIntro(false);
      toast(r.message);
      await refresh();
    });
    document.getElementById('episodeSelect')?.addEventListener('change', async (e) => {
      const r = await launcher.setEpisode(e.target.value);
      toast(r.message);
      await refresh();
    });
  }

  if (state.tab === 'support') {
    el.main.querySelector('[data-bool="__diag_enabled"]')?.addEventListener('change', async (e) => {
      const snap = await launcher.setDiagnosticsEnabled(e.target.checked);
      if (state.status) state.status.diagnostics = snap;
      renderMain();
    });
    el.main.querySelector('[data-bool="__diag_capture"]')?.addEventListener('change', async (e) => {
      const snap = await launcher.setCapture(e.target.checked);
      if (state.status) state.status.diagnostics = snap;
      toast(snap.captureMessage);
      renderMain();
    });
    document.getElementById('btnBundle')?.addEventListener('click', async () => {
      const snap = await launcher.createBundle();
      if (state.status) state.status.diagnostics = snap;
      toast(snap.bundleMessage || 'Bundle created');
      renderMain();
    });
    document.getElementById('btnRefreshDiag')?.addEventListener('click', async () => {
      const snap = await launcher.refreshDiagnostics();
      if (state.status) state.status.diagnostics = snap;
      renderMain();
    });
  }

  if (state.tab === 'about') {
    document.getElementById('btnCheckUpdates')?.addEventListener('click', async () => {
      const snap = await launcher.checkUpdates();
      if (state.status) state.status.updates = snap;
      toast(snap.message);
      renderMain();
    });
    document.getElementById('btnOpenUpdate')?.addEventListener('click', async () => {
      await launcher.openUpdate();
    });
    el.main.querySelectorAll('[data-url]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        launcher.openExternal(a.dataset.url);
      });
    });
  }
}

async function refresh() {
  state.status = await launcher.getStatus();
  el.version.textContent = state.status.version || '';
  if (state.tab === 'play') {
    if (!patchPlay()) renderMain();
  } else if (state.tab === 'install' || state.tab === 'about' || state.tab === 'support' || state.tab === 'patches') {
    renderMain();
  } else if (state.tab === 'settings') {
    // keep form focus; only update version strip
  } else {
    renderMain();
  }
}

function startHeroRotate() {
  setInterval(() => {
    const arts = state.status?.art || [];
    if (arts.length < 2 || state.tab !== 'play') return;
    state.heroIndex = (state.heroIndex + 1) % arts.length;
    const img = document.getElementById('heroImg');
    if (img) img.src = arts[state.heroIndex];
  }, 8000);
}

async function boot() {
  renderNav();
  state.status = await launcher.getStatus();
  el.version.textContent = state.status.version || '';
  renderMain();
  startHeroRotate();

  launcher.on('game:changed', (snap) => {
    if (state.status) state.status.game = snap;
    if (state.tab === 'play') patchPlay();
  });
  launcher.on('install:changed', (snap) => {
    if (state.status) state.status.install = snap;
    if (state.tab === 'install') renderMain();
    else if (state.tab === 'play') patchPlay();
  });
  launcher.on('art:done', (r) => {
    toast(r?.ok ? `Art ready (${r.count || 0})` : r?.message || 'Art refresh finished');
  });
  launcher.on('status', (payload) => {
    state.status = payload;
    el.version.textContent = payload.version || '';
    if (state.tab === 'play') patchPlay();
    else if (state.tab !== 'settings') renderMain();
  });

  setInterval(async () => {
    if (state.tab !== 'play') return;
    const snap = await launcher.getStatus();
    if (state.status) {
      state.status.game = snap.game;
      state.status.art = snap.art;
      state.status.gamedataReady = snap.gamedataReady;
      state.status.engineReady = snap.engineReady;
      state.status.engineDate = snap.engineDate;
      state.status.ffmpeg = snap.ffmpeg;
      state.status.settings = snap.settings;
    }
    patchPlay();
  }, 2000);
}

boot();
