'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS_VERSION = 7;
const SETTINGS_VERSION_MARKER = '# settings_version =';
const SETTINGS_BEGIN = '# >>> LAUNCHER SETTINGS (managed block - do not edit by hand) >>>';
const SETTINGS_END = '# <<< LAUNCHER SETTINGS <<<';

// Only keys the Mac game binary + runtime actually register and apply.
const SCHEMA = {
  fullscreen: ['bool', false, true],
  resolution: ['str', '', true],
  window_width: ['int', 1280, true],
  window_height: ['int', 720, true],
  vsync: ['bool', true, true],
  present_letterbox: ['bool', true, false],
  resolution_scale: ['int', 1, true],
  anisotropic_override: ['int', 3, false],
  // Mac runtime builds without FidelityFX — bilinear only.
  present_effect: ['str', 'bilinear', true],
  swap_post_effect: ['str', 'fxaa', true],
  ink_outlines: ['str', 'original', true],
  ink_outline_strength: ['float', 0.6, true],
  ink_outline_color: ['str', '000000', true],
  eye_shading: ['str', 'clean', true],
  camera_fov: ['float', 1.0, false],
  frame_rate: ['int', 60, true],
  menu_frame_rate: ['int', 30, true],
  unlock_60fps: ['bool', true, true],
  mnk_mode: ['bool', false, true],
  mnk_sensitivity: ['float', 1.0, false],
  keybind_lstick_up: ['str', 'W', false],
  keybind_lstick_down: ['str', 'S', false],
  keybind_lstick_left: ['str', 'A', false],
  keybind_lstick_right: ['str', 'D', false],
  keybind_rstick_up: ['str', '', false],
  keybind_rstick_down: ['str', '', false],
  keybind_rstick_left: ['str', '', false],
  keybind_rstick_right: ['str', '', false],
  keybind_a: ['str', 'Space,Enter', false],
  keybind_x: ['str', 'LMB', false],
  keybind_b: ['str', 'RMB,Backspace', false],
  keybind_y: ['str', 'E', false],
  keybind_left_trigger: ['str', 'Shift', false],
  keybind_right_trigger: ['str', 'F', false],
  keybind_left_shoulder: ['str', 'Q', false],
  keybind_right_shoulder: ['str', 'R', false],
  keybind_dpad_up: ['str', '1,Up', false],
  keybind_dpad_right: ['str', '2,Right', false],
  keybind_dpad_down: ['str', '3,Down', false],
  keybind_dpad_left: ['str', '4,Left', false],
  keybind_back: ['str', 'Tab', false],
  keybind_start: ['str', 'Escape', false],
  keybind_lstick_press: ['str', 'C', false],
  keybind_rstick_press: ['str', 'MMB', false],
  bind_settings: ['str', 'F4', false],
  bind_debug_overlay: ['str', 'F3', false],
  bind_fps: ['str', 'F10', false],
  bind_console: ['str', 'Backtick', false],
  bind_freecam: ['str', 'F6', false],
  bind_photo_mode: ['str', 'F8', false],
  bind_photo_shot: ['str', 'F9', false],
  // Empty in SCHEMA; applyMacDefaults fills Pictures/The Simpsons Game.
  photo_shots_dir: ['str', '', true],
  show_fps: ['bool', false, false],
  user_language: ['int', 1, true],
  subtitles: ['bool', false, true],
  gpu: ['str', '', true],
  vulkan_device: ['str', '', true],
  render_target_path_vulkan: ['str', 'fbo', true],
  audio_mute: ['bool', false, false],
  audio_maxqframes: ['int', 32, true],
  audio_pace_callbacks: ['bool', true, true],
};

const RESOLUTION_SIZE = {
  '': [1280, 720],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
};

const CONTROLS = [
  ['keybind_lstick_up', 'Move forward', 'Left stick'],
  ['keybind_lstick_down', 'Move back', 'Left stick'],
  ['keybind_lstick_left', 'Move left', 'Left stick'],
  ['keybind_lstick_right', 'Move right', 'Left stick'],
  ['keybind_rstick_up', 'Look up', 'Right stick'],
  ['keybind_rstick_down', 'Look down', 'Right stick'],
  ['keybind_rstick_left', 'Look left', 'Right stick'],
  ['keybind_rstick_right', 'Look right', 'Right stick'],
  ['keybind_a', 'Jump / confirm', 'A'],
  ['keybind_x', 'Attack', 'X'],
  ['keybind_b', 'Special attack / back', 'B'],
  ['keybind_y', 'Action', 'Y'],
  ['keybind_left_trigger', 'Target (hold)', 'LT'],
  ['keybind_right_trigger', 'Right trigger', 'RT'],
  ['keybind_left_shoulder', 'Left bumper', 'LB'],
  ['keybind_right_shoulder', 'Right bumper', 'RB'],
  ['keybind_dpad_up', 'Switch character — up', 'D-pad'],
  ['keybind_dpad_right', 'Switch character — right', 'D-pad'],
  ['keybind_dpad_down', 'Switch character — down', 'D-pad'],
  ['keybind_dpad_left', 'Switch character — left', 'D-pad'],
  ['keybind_back', 'To-do list', 'Back'],
  ['keybind_start', 'Pause', 'Start'],
  ['keybind_lstick_press', 'Left stick click', 'LS'],
  ['keybind_rstick_press', 'Right stick click', 'RS'],
];

const OVERLAYS = [
  ['bind_settings', 'Settings'],
  ['bind_debug_overlay', 'Full debug overlay'],
  ['bind_fps', 'FPS counter on/off'],
  ['bind_console', 'Console'],
  ['bind_freecam', 'Free camera on/off (controller: L3+R3)'],
  ['bind_photo_mode', 'Photo mode: world paused, HUD hidden (controller: Y with free camera on)'],
  ['bind_photo_shot', 'Photo mode screenshot (F9 / controller A while photo mode is on)'],
];

function defaultPhotoShotsDir() {
  return path.join(os.homedir(), 'Pictures', 'The Simpsons Game');
}

function fmt(v, typ) {
  if (typ === 'bool') return v ? 'true' : 'false';
  if (typ === 'str') return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return String(v);
}

function parse(raw, typ) {
  raw = String(raw).trim();
  if (typ === 'bool') return raw.toLowerCase() === 'true';
  if (typ === 'str') return raw.replace(/^"|"$/g, '');
  if (typ === 'float') return parseFloat(raw);
  return parseInt(raw, 10);
}

function defaults() {
  const out = {};
  for (const [k, [, d]] of Object.entries(SCHEMA)) out[k] = d;
  return out;
}

function applyMacDefaults(values) {
  if (!values.window_width) {
    values.window_width = 1280;
    values.window_height = 720;
  }
  if (values.frame_rate === undefined || values.frame_rate === null || values.frame_rate === '') {
    values.frame_rate = 60;
  }
  // 30 FPS levels = original cadence; 60+ / unlimited = community unlock.
  values.unlock_60fps = Number(values.frame_rate) !== 30;
  values.audio_maxqframes = values.audio_maxqframes || 32;
  if (values.audio_pace_callbacks === undefined || values.audio_pace_callbacks === null) {
    values.audio_pace_callbacks = true;
  }
  if (!values.render_target_path_vulkan) {
    values.render_target_path_vulkan = 'fbo';
  }
  // Mac is Vulkan/MoltenVK only.
  if (values.gpu === 'd3d12' || values.gpu === 'd3d11') values.gpu = '';
  values.vulkan_device = '';
  values.present_effect = 'bilinear';
  if (!values.photo_shots_dir || !String(values.photo_shots_dir).trim()) {
    values.photo_shots_dir = defaultPhotoShotsDir();
  }
  return values;
}

function syncResolutionWindow(values) {
  const size = RESOLUTION_SIZE[values.resolution || ''];
  if (size) {
    values.window_width = size[0];
    values.window_height = size[1];
  }
}

function readSettings(tomlPath) {
  const values = defaults();
  if (!fs.existsSync(tomlPath)) return applyMacDefaults(values);
  const text = fs.readFileSync(tomlPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    const key = s.slice(0, i).trim();
    const raw = s.slice(i + 1);
    if (!SCHEMA[key]) continue;
    try {
      values[key] = parse(raw, SCHEMA[key][0]);
    } catch (_) {}
  }
  return applyMacDefaults(values);
}

function writeSettings(tomlPath, patch) {
  const values = readSettings(tomlPath);
  for (const [k, v] of Object.entries(patch || {})) {
    if (!SCHEMA[k]) continue;
    const typ = SCHEMA[k][0];
    values[k] = typ === 'bool' ? !!v : typ === 'str' ? String(v) : typ === 'float' ? Number(v) : parseInt(v, 10);
  }

  let preamble = [];
  if (fs.existsSync(tomlPath)) {
    const text = fs.readFileSync(tomlPath, 'utf8');
    let inBlock = false;
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (s === SETTINGS_BEGIN) {
        inBlock = true;
        continue;
      }
      if (s === SETTINGS_END) {
        inBlock = false;
        continue;
      }
      if (inBlock) continue;
      if (s.startsWith(SETTINGS_VERSION_MARKER)) continue;
      // Drop obsolete keys from older launchers so the game does not warn.
      const key = s.includes('=') && !s.startsWith('#') ? s.split('=')[0].trim() : '';
      if (
        key &&
        [
          'native_rt_original_resolution_targets',
          'present_fsr_sharpness_reduction',
          'character_tessellation',
          'color_vibrance',
          'color_saturation',
          'color_contrast',
          'color_brightness',
          'mnk_invert_y',
          'bind_controls',
          'keybind_walk',
        ].includes(key)
      ) {
        continue;
      }
      preamble.push(line);
    }
    while (preamble.length && preamble[preamble.length - 1] === '') preamble.pop();
  }

  values.unlock_60fps = Number(values.frame_rate) !== 30;
  values.present_effect = 'bilinear';
  syncResolutionWindow(values);
  const fps = Number(values.frame_rate);

  const block = [`${SETTINGS_VERSION_MARKER}${SETTINGS_VERSION}`, SETTINGS_BEGIN];
  for (const [key, [typ, def]] of Object.entries(SCHEMA)) {
    const val = values[key];
    const omit =
      (key.startsWith('keybind_') || key.startsWith('bind_')) && val === def;
    if (omit) continue;
    block.push(`${key} = ${fmt(val, typ)}`);
  }
  // Immediate present when vsync is off or unlimited FPS is requested.
  block.push(`vulkan_allow_present_mode_immediate = ${fps === 0 || !values.vsync ? 'true' : 'false'}`);
  block.push('vulkan_allow_present_mode_fifo_relaxed = false');
  // Always write the host paint cap from the Frame rate control (0 = unlimited).
  block.push(`framerate_limit = ${fps}`);
  block.push(SETTINGS_END);

  const out = [...preamble, '', ...block, ''].join('\n');
  fs.writeFileSync(tomlPath, out, 'utf8');
  return values;
}

module.exports = {
  SCHEMA,
  CONTROLS,
  OVERLAYS,
  readSettings,
  writeSettings,
  defaults,
  defaultPhotoShotsDir,
};
