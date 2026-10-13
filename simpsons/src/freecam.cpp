// Free camera and photo mode.
//
// The camera manager (a singleton at 0x82D08B10, built per level) applies the
// gameplay camera every frame: on the running tick, sub_8269D808 updates the
// camera directors and pushes viewport 0's pose through sub_8269D130, the one
// function that writes a pose and field of view into the viewport's RenderWare
// camera (and so into culling, LOD and the view and projection). After it, on
// the running and the paused tick alike, comes sub_8269D8F8: a developer fly
// camera that shipped but cannot be reached (enable flag at manager +264, pose
// at +268 and +280, field of view in degrees at +292, flown with controller
// 2). Overriding it gives one place, once per frame and after the gameplay
// camera, to apply our own pose. With the manager's enable flag set, the
// game's camera getters report our pose as well, as they did for the
// developers (freecam_game_follows).
//
// The photo mode pauses the level with the game's own pause (sub_826913A0,
// with a reason bit the game never uses): only the paused ticks run, so
// characters, AI, physics and the sequencer stop while the camera manager, the
// UI and rendering go on. The HUD and subtitles (the UI scene's draw callback)
// are left out meanwhile.
//
// While the free camera is on, the game reads a neutral, connected pad: its
// only controller read is the XInputGetState thunk sub_82B766A8. The
// keyboard's virtual pad is muted through the overlay-input lock, and the
// camera reads the keyboard from the window instead.
//
// Controller: L3+R3 free camera on/off, Y photo mode; left stick move, right
// stick look, triggers down/up, LB/RB zoom out/in, R3 resets the zoom, A
// faster (or takes a screenshot in photo mode), X slower. Keyboard: F6 free
// camera, F8 photo mode, Enter / F9 screenshot in photo mode; WASD move,
// arrows look, Q/E down/up, 1/3 zoom out/in, 2 resets the zoom, Shift faster,
// Ctrl slower. Screenshots land in <userdata>/shots as PNG.

#include "guest_memory.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <thread>
#include <vector>

#include <SDL3/SDL.h>

#include <rex/cvar.h>
#include <rex/logging.h>
#include <rex/platform.h>
#include <rex/ppc.h>
#include <rex/ui/keybinds.h>
#include <rex/ui/overlay_input.h>
#include <rex/ui/presenter.h>
#include <rex/ui/window.h>
#include <rex/ui/window_listener.h>

REXCVAR_DEFINE_DOUBLE(freecam_speed, 5.0, "Camera", "Free camera speed in metres per second")
    .range(0.5, 50.0);
REXCVAR_DEFINE_BOOL(freecam_hide_hud, true, "Camera",
                    "Hide the HUD and subtitles while the photo mode is on");
REXCVAR_DEFINE_BOOL(freecam_game_follows, true, "Camera",
                    "Let the game use the free camera as its camera (what it streams, culls and "
                    "hears from), as the developers' fly camera did");
REXCVAR_DEFINE_STRING(photo_shots_dir, "", "Camera",
                      "Folder for photo mode screenshots. Empty uses Pictures/The Simpsons Game "
                      "on Mac.")
    .lifecycle(rex::cvar::Lifecycle::kRequiresRestart);

// The camera manager's fly camera, which this file takes over.
REX_EXTERN(__imp__sub_8269D8F8);
REX_EXTERN(sub_8269D8F8);
// The pose -> RenderWare camera writer: r3 = manager, r4 = viewport, r5 =
// &position, r6 = &(pitch, yaw, roll), f1 = field of view in radians, r8/r9 =
// projection flags.
REX_EXTERN(sub_8269D130);
// The XInputGetState thunk (r3 = user, r4 = guest X_INPUT_STATE*), the game's
// only controller read.
REX_EXTERN(__imp__sub_82B766A8);
REX_EXTERN(sub_82B766A8);
// The simulation manager's tick, and its pause and unpause (r3 = reason bits).
REX_EXTERN(__imp__sub_82691540);
REX_EXTERN(sub_82691540);
REX_EXTERN(sub_826913A0);
REX_EXTERN(sub_82691368);
// SetSimEnabled (r3 = 0 when a level unloads or restarts).
REX_EXTERN(__imp__sub_82691530);
REX_EXTERN(sub_82691530);
// The UI scene's draw callback (HUD, subtitles); returns 1.
REX_EXTERN(__imp__sub_826D5CB0);
REX_EXTERN(sub_826D5CB0);

namespace {

constexpr uint32_t kCameraManager = 0x82D08B10;
constexpr uint32_t kMgrDirectors = 16;  // pointer to the 0x1B8-byte directors
constexpr uint32_t kMgrFlyEnable = 264;
constexpr uint32_t kMgrFlyPosition = 268;  // x, y, z
constexpr uint32_t kMgrFlyAngles = 280;    // pitch, yaw, roll (radians)
constexpr uint32_t kMgrFlyFovDegrees = 292;
constexpr uint32_t kMgrViewportCount = 300;
constexpr uint32_t kMgrViewport0Director = 304;  // director index, -1 = none
constexpr uint32_t kDirectorSize = 440;
constexpr uint32_t kDirectorPosition = 0;
constexpr uint32_t kDirectorAngles = 24;
constexpr uint32_t kDirectorFov = 36;  // radians
constexpr uint32_t kDirectorFlags1 = 44;
constexpr uint32_t kDirectorFlags2 = 48;
constexpr uint32_t kSimEnabled = 0x82CED760;
constexpr uint32_t kPhotoPauseBit = 0x80000000;

constexpr uint16_t kPadL3 = 0x0040;
constexpr uint16_t kPadR3 = 0x0080;
constexpr uint16_t kPadLB = 0x0100;
constexpr uint16_t kPadRB = 0x0200;
constexpr uint16_t kPadA = 0x1000;
constexpr uint16_t kPadX = 0x4000;
constexpr uint16_t kPadY = 0x8000;

constexpr float kPi = 3.14159265f;
constexpr float kMinFov = 5.0f * kPi / 180.0f;
constexpr float kMaxFov = 120.0f * kPi / 180.0f;
constexpr float kZoomRate = 30.0f * kPi / 180.0f;  // per second
constexpr float kTurnRate = 1.5f;                  // radians per second
constexpr float kMaxPitch = 1.55f;

using simpsons::GuestToHost;
using simpsons::LoadGuestFloat;
using simpsons::LoadGuestU32;
using simpsons::StoreGuestFloat;
using simpsons::StoreGuestU32;

uint16_t LoadBE16(const uint8_t* p) {
  return uint16_t(p[0] << 8 | p[1]);
}
int16_t LoadBES16(const uint8_t* p) {
  return int16_t(LoadBE16(p));
}
void StoreBE16(uint8_t* p, uint16_t value) {
  p[0] = uint8_t(value >> 8);
  p[1] = uint8_t(value);
}
void StoreBES16(uint8_t* p, int16_t value) {
  StoreBE16(p, uint16_t(value));
}

int64_t NowNs() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

// Requests (any thread).
std::atomic<bool> g_want_freecam{false};
std::atomic<bool> g_want_photo{false};
std::atomic<bool> g_reset_fov{false};
std::atomic<bool> g_want_shot{false};
// Game-thread state, published for the frame pacing, the HUD draw and the
// UI-thread toggles.
std::atomic<bool> g_applied{false};
std::atomic<bool> g_frozen{false};
std::atomic<int64_t> g_last_camera_tick_ns{0};
std::atomic<bool> g_shot_busy{false};

rex::ui::Presenter* g_presenter = nullptr;
std::filesystem::path g_shots_dir;

// Keyboard (UI thread -> game thread).
std::array<std::atomic<bool>, 256> g_keys{};
std::atomic<bool> g_key_repeat{false};

// Pad of user 0, as the game would have read it (game thread only).
struct Pad {
  uint16_t buttons = 0;
  uint8_t lt = 0, rt = 0;
  int16_t lx = 0, ly = 0, rx = 0, ry = 0;
};
Pad g_pad;
bool g_chord_down = false;          // L3+R3 both held (chord in progress)
bool g_r3_tap = false;              // R3 pressed alone, a zoom reset on release
bool g_hold_until_neutral = false;  // after freecam: briefly mute sticks so look does not whip
int64_t g_hold_until_neutral_ns = 0;
int64_t g_chord_down_ns = 0;

// Accidental stick-clicks were toggling freecam and muting look for seconds.
constexpr int64_t kChordHoldNs = 400'000'000;       // 0.4s L3+R3 to toggle
constexpr int64_t kHoldUntilNeutralMaxNs = 250'000'000;  // never mute sticks longer than this

// The free camera (game thread only).
struct Camera {
  uint32_t manager = 0;
  float position[3] = {};
  float pitch = 0, yaw = 0, roll = 0;
  float fov = 1.0f, seed_fov = 1.0f;
  uint32_t flags1 = 1, flags2 = 2;
  int64_t last_ns = 0;
} g_cam;

bool CameraTicking() {
  const int64_t last = g_last_camera_tick_ns.load(std::memory_order_relaxed);
  return last && NowNs() - last < 500'000'000;
}

void ToggleFreecam() {
  if (g_want_freecam.load()) {
    g_want_freecam = false;
    g_want_photo = false;
    return;
  }
  if (!CameraTicking()) {
    REXLOG_INFO("[freecam] no level camera running; the free camera works in levels only");
    return;
  }
  g_want_freecam = true;
}

void TogglePhoto() {
  if (g_want_photo.load()) {
    g_want_photo = false;
    return;
  }
  if (!g_want_freecam.load()) {
    if (!CameraTicking()) {
      REXLOG_INFO("[freecam] no level camera running; the photo mode works in levels only");
      return;
    }
    g_want_freecam = true;
  }
  g_want_photo = true;
}

void RequestPhotoShot() {
  if (!g_frozen.load(std::memory_order_relaxed)) {
    REXLOG_INFO("[freecam] screenshots work in photo mode only (F8)");
    return;
  }
  if (!g_presenter || g_shots_dir.empty()) {
    REXLOG_WARN("[freecam] screenshot: no presenter or shots folder");
    return;
  }
  if (g_shot_busy.load(std::memory_order_relaxed)) {
    return;
  }
  g_want_shot.store(true, std::memory_order_relaxed);
}

bool WritePng(const std::filesystem::path& path, const rex::ui::RawImage& image) {
  if (!image.width || !image.height || image.data.empty()) {
    return false;
  }
  // Guest capture is R8 G8 B8 X8; drop X when building a tight RGBX surface.
  std::vector<uint8_t> rgba(size_t(image.width) * image.height * 4);
  for (uint32_t y = 0; y < image.height; ++y) {
    const uint8_t* src = image.data.data() + image.stride * y;
    uint8_t* dst = rgba.data() + size_t(y) * image.width * 4;
    for (uint32_t x = 0; x < image.width; ++x) {
      dst[x * 4 + 0] = src[x * 4 + 0];
      dst[x * 4 + 1] = src[x * 4 + 1];
      dst[x * 4 + 2] = src[x * 4 + 2];
      dst[x * 4 + 3] = 255;
    }
  }
  SDL_Surface* surface =
      SDL_CreateSurfaceFrom(int(image.width), int(image.height), SDL_PIXELFORMAT_RGBA32,
                            rgba.data(), int(image.width * 4));
  if (!surface) {
    return false;
  }
  const bool ok = SDL_SavePNG(surface, path.string().c_str());
  SDL_DestroySurface(surface);
  return ok;
}

void TakePhotoShot() {
  if (!g_want_shot.exchange(false, std::memory_order_relaxed)) {
    return;
  }
  if (!g_frozen.load(std::memory_order_relaxed) || !g_presenter || g_shots_dir.empty()) {
    return;
  }
  if (g_shot_busy.exchange(true, std::memory_order_acq_rel)) {
    return;
  }
  rex::ui::RawImage image;
  if (!g_presenter->CaptureGuestOutput(image) || !image.width || !image.height) {
    g_shot_busy.store(false, std::memory_order_release);
    REXLOG_WARN("[freecam] screenshot failed to capture the frame");
    return;
  }
  std::error_code ec;
  std::filesystem::create_directories(g_shots_dir, ec);
  const auto now = std::chrono::system_clock::now();
  const std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
#if defined(_WIN32)
  localtime_s(&tm, &t);
#else
  localtime_r(&t, &tm);
#endif
  char stamp[32];
  std::snprintf(stamp, sizeof(stamp), "photo_%04d%02d%02d_%02d%02d%02d", tm.tm_year + 1900,
                tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec);
  std::filesystem::path path = g_shots_dir / (std::string(stamp) + ".png");
  for (int n = 2; std::filesystem::exists(path, ec); ++n) {
    path = g_shots_dir / (std::string(stamp) + "_" + std::to_string(n) + ".png");
  }
  std::thread([image = std::move(image), path]() mutable {
    const bool ok = WritePng(path, image);
    if (ok) {
      REXLOG_INFO("[freecam] screenshot saved: {}", path.string());
    } else {
      REXLOG_WARN("[freecam] screenshot failed to write {}", path.string());
    }
    g_shot_busy.store(false, std::memory_order_release);
  }).detach();
}

float Axis(int16_t value, int dead_zone) {
  const float v = float(value);
  const float limit = 32767.0f - float(dead_zone);
  if (v > dead_zone)
    return std::min((v - dead_zone) / limit, 1.0f);
  if (v < -dead_zone)
    return std::max((v + dead_zone) / limit, -1.0f);
  return 0.0f;
}

bool Key(rex::ui::VirtualKey key) {
  return g_keys[size_t(key) & 0xFF].load(std::memory_order_relaxed);
}

bool ApplyPose(PPCContext& ctx, uint8_t* base, uint32_t manager, const float position[3],
               float pitch, float yaw, float roll, float fov, uint32_t flags1, uint32_t flags2) {
  StoreGuestFloat(base, manager + kMgrFlyPosition + 0, position[0]);
  StoreGuestFloat(base, manager + kMgrFlyPosition + 4, position[1]);
  StoreGuestFloat(base, manager + kMgrFlyPosition + 8, position[2]);
  StoreGuestFloat(base, manager + kMgrFlyAngles + 0, pitch);
  StoreGuestFloat(base, manager + kMgrFlyAngles + 4, yaw);
  StoreGuestFloat(base, manager + kMgrFlyAngles + 8, roll);
  StoreGuestFloat(base, manager + kMgrFlyFovDegrees, fov * 180.0f / kPi);
  ctx.r3.u64 = manager;
  ctx.r4.u64 = 0;
  ctx.r5.u64 = manager + kMgrFlyPosition;
  ctx.r6.u64 = manager + kMgrFlyAngles;
  ctx.r8.u64 = flags1;
  ctx.r9.u64 = flags2;
  ctx.f1.f64 = fov;
  sub_8269D130(ctx, base);
  return true;
}

// Viewport 0's camera director, or 0 when the manager has none.
uint32_t Director(const uint8_t* base, uint32_t manager) {
  if (!manager || LoadGuestU32(base, manager + kMgrViewportCount) == 0) {
    return 0;
  }
  const int32_t index = int32_t(LoadGuestU32(base, manager + kMgrViewport0Director));
  const uint32_t directors = LoadGuestU32(base, manager + kMgrDirectors);
  if (index < 0 || !directors) {
    return 0;
  }
  return directors + kDirectorSize * uint32_t(index);
}

void Disable(PPCContext& ctx, uint8_t* base, uint32_t manager) {
  if (manager == g_cam.manager) {
    StoreGuestU32(base, manager + kMgrFlyEnable, 0);
    // In the game's paused mode the gameplay camera is not applied again
    // this frame: put its pose back here.
    if (const uint32_t d = Director(base, manager)) {
      float position[3] = {LoadGuestFloat(base, d + kDirectorPosition + 0),
                           LoadGuestFloat(base, d + kDirectorPosition + 4),
                           LoadGuestFloat(base, d + kDirectorPosition + 8)};
      ApplyPose(ctx, base, manager, position, LoadGuestFloat(base, d + kDirectorAngles + 0),
                LoadGuestFloat(base, d + kDirectorAngles + 4),
                LoadGuestFloat(base, d + kDirectorAngles + 8),
                LoadGuestFloat(base, d + kDirectorFov), LoadGuestU32(base, d + kDirectorFlags1),
                LoadGuestU32(base, d + kDirectorFlags2));
    }
  }
  rex::ui::ReleaseOverlayInput();
  g_want_freecam = false;
  g_want_photo = false;
  g_applied = false;
  // Mute sticks briefly so freecam look does not whip the game camera — but
  // always time out so a resting stick / drift cannot leave look dead.
  g_hold_until_neutral = true;
  g_hold_until_neutral_ns = NowNs();
  REXLOG_INFO("[freecam] off");
}

bool Enable(const uint8_t* base, uint8_t* mutable_base, uint32_t manager) {
  const uint32_t d = Director(base, manager);
  if (!d) {
    return false;
  }
  g_cam.manager = manager;
  for (int i = 0; i < 3; ++i) {
    g_cam.position[i] = LoadGuestFloat(base, d + kDirectorPosition + 4 * i);
  }
  g_cam.pitch = LoadGuestFloat(base, d + kDirectorAngles + 0);
  g_cam.yaw = LoadGuestFloat(base, d + kDirectorAngles + 4);
  g_cam.roll = LoadGuestFloat(base, d + kDirectorAngles + 8);
  g_cam.fov = LoadGuestFloat(base, d + kDirectorFov);
  if (!(g_cam.fov > kMinFov && g_cam.fov < kMaxFov)) {
    g_cam.fov = 1.0472f;
  }
  g_cam.seed_fov = g_cam.fov;
  g_cam.flags1 = LoadGuestU32(base, d + kDirectorFlags1);
  g_cam.flags2 = LoadGuestU32(base, d + kDirectorFlags2);
  g_cam.last_ns = NowNs();
  rex::ui::AcquireOverlayInput();
  if (REXCVAR_GET(freecam_game_follows)) {
    StoreGuestU32(mutable_base, manager + kMgrFlyEnable, 1);
  }
  g_applied = true;
  REXLOG_INFO("[freecam] on at ({:.2f}, {:.2f}, {:.2f}), pitch {:.3f}, yaw {:.3f}, fov {:.1f} deg",
              g_cam.position[0], g_cam.position[1], g_cam.position[2], g_cam.pitch, g_cam.yaw,
              g_cam.fov * 180.0f / kPi);
  return true;
}

void Fly(float dt) {
  const Pad pad = g_pad;
  float move_x = Axis(pad.lx, 7849), move_z = Axis(pad.ly, 7849);
  float look_x = Axis(pad.rx, 8689), look_y = Axis(pad.ry, 8689);
  float rise = (pad.rt - pad.lt) / 255.0f;
  float zoom = (pad.buttons & kPadLB ? 1.0f : 0.0f) - (pad.buttons & kPadRB ? 1.0f : 0.0f);
  float speed = float(REXCVAR_GET(freecam_speed));
  // In photo mode A is the shutter; keep it as a speed boost otherwise.
  if ((pad.buttons & kPadA) && !g_frozen.load(std::memory_order_relaxed))
    speed *= 5.0f;
  if (pad.buttons & kPadX)
    speed *= 0.2f;

  using rex::ui::VirtualKey;
  if (Key(VirtualKey::kW))
    move_z += 1.0f;
  if (Key(VirtualKey::kS))
    move_z -= 1.0f;
  if (Key(VirtualKey::kD))
    move_x += 1.0f;
  if (Key(VirtualKey::kA))
    move_x -= 1.0f;
  if (Key(VirtualKey::kRight))
    look_x += 1.0f;
  if (Key(VirtualKey::kLeft))
    look_x -= 1.0f;
  if (Key(VirtualKey::kUp))
    look_y += 1.0f;
  if (Key(VirtualKey::kDown))
    look_y -= 1.0f;
  if (Key(VirtualKey::kE))
    rise += 1.0f;
  if (Key(VirtualKey::kQ))
    rise -= 1.0f;
  if (Key(VirtualKey::k1))
    zoom += 1.0f;
  if (Key(VirtualKey::k3))
    zoom -= 1.0f;
  if (Key(VirtualKey::k2))
    g_reset_fov = true;
  if (Key(VirtualKey::kShift) || Key(VirtualKey::kLShift))
    speed *= 5.0f;
  if (Key(VirtualKey::kControl) || Key(VirtualKey::kLControl))
    speed *= 0.2f;
  move_x = std::clamp(move_x, -1.0f, 1.0f);
  move_z = std::clamp(move_z, -1.0f, 1.0f);
  look_x = std::clamp(look_x, -1.0f, 1.0f);
  look_y = std::clamp(look_y, -1.0f, 1.0f);
  rise = std::clamp(rise, -1.0f, 1.0f);
  zoom = std::clamp(zoom, -1.0f, 1.0f);

  // D3DX YawPitchRoll as the game uses it: yaw about Y (0 looks along +Z,
  // positive turns left), pitch about X (positive looks down). Y is up.
  const float turn = kTurnRate * (g_cam.fov / g_cam.seed_fov);
  g_cam.yaw -= look_x * turn * dt;
  g_cam.pitch = std::clamp(g_cam.pitch - look_y * turn * dt, -kMaxPitch, kMaxPitch);
  const float sp = std::sin(g_cam.pitch), cp = std::cos(g_cam.pitch);
  const float sy = std::sin(g_cam.yaw), cy = std::cos(g_cam.yaw);
  const float at[3] = {cp * sy, -sp, cp * cy};
  const float right[3] = {-cy, 0.0f, sy};
  const float step = speed * dt;
  for (int i = 0; i < 3; ++i) {
    g_cam.position[i] += (at[i] * move_z + right[i] * move_x) * step;
  }
  g_cam.position[1] += rise * step;

  if (g_reset_fov.exchange(false)) {
    g_cam.fov = g_cam.seed_fov;
  }
  g_cam.fov = std::clamp(g_cam.fov + zoom * kZoomRate * dt, kMinFov, kMaxFov);
}

// Reads the keyboard for the camera. Runs before the runtime's own listener,
// so the F6/F8 binds can tell a key's auto-repeat from a new press.
class FreecamKeys : public rex::ui::WindowInputListener, public rex::ui::WindowListener {
 public:
  void OnKeyDown(rex::ui::KeyEvent& e) override {
    auto& key = g_keys[size_t(e.virtual_key()) & 0xFF];
    g_key_repeat = key.load();
    key = true;
  }
  void OnKeyUp(rex::ui::KeyEvent& e) override { g_keys[size_t(e.virtual_key()) & 0xFF] = false; }
  void OnLostFocus(rex::ui::UISetupEvent&) override {
    for (auto& key : g_keys) {
      key = false;
    }
  }
};
FreecamKeys g_key_listener;

}  // namespace

bool FreecamWorldFrozen() {
  return g_frozen.load(std::memory_order_relaxed);
}

// Mac frame pacing: a live level camera means "in gameplay", even if physics
// briefly pauses. Matches the camera tick already tracked for freecam gating.
bool FreecamLevelCameraRecent() {
  const int64_t last = g_last_camera_tick_ns.load(std::memory_order_relaxed);
  return last && NowNs() - last < 2'000'000'000;
}

void InitFreecam(rex::ui::Window* window, rex::ui::Presenter* presenter,
                 std::filesystem::path shots_dir) {
  g_presenter = presenter;
  // Launcher setting photo_shots_dir wins when set; otherwise use the app default
  // (Pictures/The Simpsons Game on Mac).
  {
    const std::string custom = REXCVAR_GET(photo_shots_dir);
    if (!custom.empty()) {
      g_shots_dir = std::filesystem::path(custom);
    } else {
      g_shots_dir = std::move(shots_dir);
    }
  }
  if (window) {
    window->AddInputListener(&g_key_listener, 32);
    window->AddListener(&g_key_listener);
  }
  rex::ui::RegisterBind("bind_freecam", "F6", "Free camera on/off", [] {
    if (!g_key_repeat.load()) {
      ToggleFreecam();
    }
  });
  rex::ui::RegisterBind("bind_photo_mode", "F8",
                        "Photo mode (free camera, world paused, HUD hidden)", [] {
                          if (!g_key_repeat.load()) {
                            TogglePhoto();
                          }
                        });
  // F9 is easier than Enter in freecam (Enter is easy to miss / conflict with UI).
  rex::ui::RegisterBind("bind_photo_shot", "F9",
                        "Take a screenshot while photo mode is on", [] {
                          if (!g_key_repeat.load()) {
                            RequestPhotoShot();
                          }
                        });
  if (!g_shots_dir.empty()) {
    REXLOG_INFO("[freecam] photo screenshots go to {}", g_shots_dir.string());
  }
}

void ShutdownFreecam(rex::ui::Window* window) {
  rex::ui::UnregisterBind("bind_freecam");
  rex::ui::UnregisterBind("bind_photo_mode");
  rex::ui::UnregisterBind("bind_photo_shot");
  if (window) {
    window->RemoveInputListener(&g_key_listener);
    window->RemoveListener(&g_key_listener);
  }
  if (g_applied.exchange(false)) {
    rex::ui::ReleaseOverlayInput();
  }
  g_presenter = nullptr;
  g_shots_dir.clear();
  g_want_shot = false;
}

REX_FUNC(sub_8269D8F8) {
  const uint32_t manager = ctx.r3.u32;
  // The handler that calls this serves the camera manager only, but its
  // pointer is checked against the singleton all the same.
  if (manager != LoadGuestU32(base, kCameraManager)) {
    __imp__sub_8269D8F8(ctx, base);
    return;
  }
  const int64_t now = NowNs();
  g_last_camera_tick_ns.store(now, std::memory_order_relaxed);
  const bool want = g_want_freecam.load();
  if (g_applied && (!want || manager != g_cam.manager)) {
    Disable(ctx, base, manager);
  }
  if (!g_applied && want && !Enable(base, base, manager)) {
    REXLOG_INFO("[freecam] no camera to start from in this view");
    g_want_freecam = false;
    g_want_photo = false;
  }
  if (!g_applied) {
    ctx.r3.u64 = manager;
    __imp__sub_8269D8F8(ctx, base);
    return;
  }
  const float dt = std::clamp(float(now - g_cam.last_ns) * 1e-9f, 0.0f, 0.1f);
  g_cam.last_ns = now;
  Fly(dt);
  ApplyPose(ctx, base, manager, g_cam.position, g_cam.pitch, g_cam.yaw, g_cam.roll, g_cam.fov,
            g_cam.flags1, g_cam.flags2);
  TakePhotoShot();
}

REX_FUNC(sub_82B766A8) {
  const uint32_t user = ctx.r3.u32;
  const uint32_t state = ctx.r4.u32;
  __imp__sub_82B766A8(ctx, base);
  if (ctx.r3.u32 != 0 || !state) {
    if (user == 0) {
      // A disconnected controller must not leave the camera moving forever.
      g_pad = {};
      g_chord_down = g_r3_tap = false;
    }
    return;
  }
  uint8_t* gamepad = GuestToHost(base, state + 4);
  Pad pad;
  pad.buttons = LoadBE16(gamepad + 0);
  pad.lt = gamepad[2];
  pad.rt = gamepad[3];
  pad.lx = LoadBES16(gamepad + 4);
  pad.ly = LoadBES16(gamepad + 6);
  pad.rx = LoadBES16(gamepad + 8);
  pad.ry = LoadBES16(gamepad + 10);

  if (user == 0) {
    const uint16_t pressed = pad.buttons & ~g_pad.buttons;
    const uint16_t released = g_pad.buttons & ~pad.buttons;
    const bool chord = (pad.buttons & (kPadL3 | kPadR3)) == (kPadL3 | kPadR3);
    const int64_t now = NowNs();
    if (chord) {
      if (!g_chord_down) {
        g_chord_down = true;
        g_chord_down_ns = now;
        g_r3_tap = false;
      } else if (now - g_chord_down_ns >= kChordHoldNs) {
        // Fire once per hold: mark as consumed by pushing the timer far ahead.
        g_chord_down_ns = now + 365LL * 24 * 3600 * 1'000'000'000;
        ToggleFreecam();
      }
    } else {
      g_chord_down = false;
      g_chord_down_ns = 0;
    }
    if ((pressed & kPadR3) && !(pad.buttons & kPadL3)) {
      g_r3_tap = true;
    }
    if (pad.buttons & kPadL3) {
      g_r3_tap = false;
    }
    if ((released & kPadR3) && g_r3_tap) {
      g_r3_tap = false;
      if (g_applied) {
        g_reset_fov = true;
      }
    }
    if ((pressed & kPadY) && g_applied) {
      TogglePhoto();
    }
    if ((pressed & kPadA) && g_frozen.load(std::memory_order_relaxed)) {
      RequestPhotoShot();
    }
    g_pad = pad;
    if (g_hold_until_neutral && !g_applied) {
      const bool rested = pad.buttons == 0 && pad.lt < 30 && pad.rt < 30 &&
                          Axis(pad.lx, 7849) == 0 && Axis(pad.ly, 7849) == 0 &&
                          Axis(pad.rx, 8689) == 0 && Axis(pad.ry, 8689) == 0;
      if (rested || now - g_hold_until_neutral_ns >= kHoldUntilNeutralMaxNs) {
        g_hold_until_neutral = false;
      }
    }
  }

  if (g_applied) {
    // Freecam owns the pad: game must not see movement or buttons.
    std::memset(gamepad, 0, 12);
  } else if (g_hold_until_neutral) {
    // After exit: keep buttons/triggers, only zero sticks briefly so look does
    // not whip — never blank the whole pad (that made right stick feel dead).
    StoreBES16(gamepad + 4, 0);
    StoreBES16(gamepad + 6, 0);
    StoreBES16(gamepad + 8, 0);
    StoreBES16(gamepad + 10, 0);
    if (g_chord_down) {
      StoreBE16(gamepad, pad.buttons & ~(kPadL3 | kPadR3));
    }
  } else if (g_chord_down) {
    // The clicks that toggle the free camera are not the game's.
    StoreBE16(gamepad, pad.buttons & ~(kPadL3 | kPadR3));
  }
}

REX_FUNC(sub_82691540) {
  const bool want = g_want_photo.load() && g_applied.load() &&
                    LoadGuestU32(base, kCameraManager) != 0 && LoadGuestU32(base, kSimEnabled) != 0;
  if (want != g_frozen.load()) {
    const uint64_t r3 = ctx.r3.u64, r4 = ctx.r4.u64;
    ctx.r3.u64 = kPhotoPauseBit;
    if (want) {
      sub_826913A0(ctx, base);
    } else {
      sub_82691368(ctx, base);
    }
    ctx.r3.u64 = r3;
    ctx.r4.u64 = r4;
    g_frozen = want;
    REXLOG_INFO("[freecam] photo mode {}", want ? "on: level paused" : "off");
  }
  __imp__sub_82691540(ctx, base);
}

REX_FUNC(sub_82691530) {
  if (ctx.r3.u32 == 0) {
    // The level unloads or restarts: never leave it paused or the camera free.
    g_want_photo = false;
    g_want_freecam = false;
    g_reset_fov = false;
    g_last_camera_tick_ns = 0;
    // The camera may never tick again after unloading. Release the input
    // lock here, without accessing the camera manager that is being freed.
    if (g_applied.exchange(false)) {
      rex::ui::ReleaseOverlayInput();
      // Do not carry stick-mute into the next level — that made look feel dead
      // for a few seconds after some loads.
      g_hold_until_neutral = false;
      g_hold_until_neutral_ns = 0;
      REXLOG_INFO("[freecam] off: level unloading");
    }
    if (g_frozen.load()) {
      const uint64_t r3 = ctx.r3.u64;
      ctx.r3.u64 = kPhotoPauseBit;
      sub_82691368(ctx, base);
      ctx.r3.u64 = r3;
      g_frozen = false;
      REXLOG_INFO("[freecam] photo mode off: level unloading");
    }
  }
  __imp__sub_82691530(ctx, base);
}

REX_FUNC(sub_826D5CB0) {
  if (g_frozen.load(std::memory_order_relaxed) && REXCVAR_GET(freecam_hide_hud)) {
    ctx.r3.u64 = 1;
    return;
  }
  __imp__sub_826D5CB0(ctx, base);
}
