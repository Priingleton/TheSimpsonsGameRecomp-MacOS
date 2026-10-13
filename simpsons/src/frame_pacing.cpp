// Menu / gameplay frame pacing. From TheSimpsonsGameRecomp (simpsons/src/frame_pacing.cpp).
//
// The game shipped at 30 fps: its frame scheduler waits two vblanks per frame.
// The 60 FPS patch (fps_unlock.cpp, "li r4,2" -> 1 in sub_82867A48) makes that
// one vblank everywhere. Gameplay copes, since its logic runs on real time and
// physics has its own fix, but the front end runs its logic once per frame:
// at 60 fps menus scroll and repeat inputs twice as fast as they were made
// for, and the title screen, which costs a little more than one 60 Hz frame,
// alternates 17 and 33 ms frames. While no level is simulating, this puts the
// frame scheduler back on the console's 30 fps cadence.
//
// On Mac, heavy levels often land around 35–45 host paints/s while unlocked at
// 60: that uneven cadence stutters video and audio. When the host cannot hold
// near 60, keep the level on a steady 30 fps guest wait instead of flipping
// between late 60 Hz frames.

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>

#include <rex/cvar.h>
#include <rex/logging.h>
#include <rex/ppc.h>

REXCVAR_DEFINE_INT32(menu_frame_rate, 30, "GPU",
                     "Frame rate of menus, the title screen and loading screens, where the game "
                     "runs its logic once per frame and was made for 30 fps (0 = same as gameplay)")
    .range(0, 240);

REXCVAR_DEFINE_BOOL(smooth_host_pacing, false, "GPU",
                    "During unlocked 60 FPS gameplay, drop to a steady 30 FPS guest wait when the "
                    "host cannot sustain near 60. Off by default — flipping 30↔60 mid-level made "
                    "camera look (right stick) feel broken");

// freecam.cpp: photo mode pause, and whether a level camera is still ticking.
bool FreecamWorldFrozen();
bool FreecamLevelCameraRecent();

// Steps the Havok world by f1 seconds of frame time. Runs every frame while a
// level is live and never in the front end.
REX_EXTERN(__imp__sub_827A55C0);
REX_EXTERN(sub_827A55C0);

// Returns the time until the frame scheduler's next deadline. r3 = the
// scheduler, which holds the frame's start timebase at +136 and its periods
// per frame at +144, read on every call. The period is the game's own fixed
// refresh rate (59.94 Hz), whatever rate the guest vblank runs at.
REX_EXTERN(__imp__sub_82718710);
REX_EXTERN(sub_82718710);

namespace {

constexpr uint32_t kSchedulerPeriodsPerFrame = 144;
// The refresh rate (float) the scheduler divides the timebase frequency by.
constexpr uint32_t kSchedulerRefreshHz = 0x82CF0404;
// Guest: simulation enabled while a level is loaded; camera manager singleton.
constexpr uint32_t kSimEnabled = 0x82CED760;
constexpr uint32_t kCameraManager = 0x82D08B10;

// Without a physics step for this long, and with no level loaded, treat as menu.
constexpr int64_t kMenuAfterNs = 2'000'000'000;
constexpr int kMenuConfirmFrames = 12;
// Host frame-time EMA: enter smooth-30 below ~50 fps, leave above ~55 fps.
constexpr double kHostSlowEnterS = 1.0 / 50.0;
constexpr double kHostSlowLeaveS = 1.0 / 55.0;
constexpr int kHostSlowConfirmFrames = 30;

std::atomic<int64_t> g_last_level_step_ns{0};

int64_t NowNs() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

uint32_t LoadBE32(const uint8_t* base, uint32_t address) {
  uint32_t value;
  std::memcpy(&value, base + address, sizeof(value));
  return rex::byte_swap(value);
}

void StoreBE32(uint8_t* base, uint32_t address, uint32_t value) {
  value = rex::byte_swap(value);
  std::memcpy(base + address, &value, sizeof(value));
}

bool LevelLoaded(const uint8_t* base) {
  return LoadBE32(base, kSimEnabled) != 0 || LoadBE32(base, kCameraManager) != 0;
}

}  // namespace

extern "C" REX_FUNC(sub_827A55C0) {
  g_last_level_step_ns.store(NowNs(), std::memory_order_relaxed);
  __imp__sub_827A55C0(ctx, base);
}

extern "C" REX_FUNC(sub_82718710) {
  // Only the game's main thread runs the scheduler.
  static uint32_t game_periods = 0;
  static uint32_t applied_periods = 0;
  static bool in_menu = false;
  static bool host_limited = false;
  static int menu_confirm = 0;
  static int host_slow_confirm = 0;
  static int64_t last_sched_ns = 0;
  static double ema_frame_s = 1.0 / 60.0;

  int32_t menu_rate = REXCVAR_GET(menu_frame_rate);
  uint32_t scheduler = ctx.r3.u32;
  if (menu_rate > 0 && scheduler) {
    uint32_t address = scheduler + kSchedulerPeriodsPerFrame;
    uint32_t current = LoadBE32(base, address);
    // Whatever the game itself set, unless it is still the menu value.
    if (!game_periods || current != applied_periods) {
      game_periods = std::max<uint32_t>(current, 1);
    }

    const int64_t now = NowNs();
    if (last_sched_ns) {
      const double dt = double(now - last_sched_ns) * 1e-9;
      if (dt > 0.001 && dt < 0.25) {
        ema_frame_s = ema_frame_s * 0.90 + dt * 0.10;
      }
    }
    last_sched_ns = now;

    const int64_t last_step = g_last_level_step_ns.load(std::memory_order_relaxed);
    const bool level_live =
        LevelLoaded(base) || FreecamWorldFrozen() || FreecamLevelCameraRecent();
    // A loaded level (or live camera) is never "menu", even if physics pauses
    // for a cutscene or a hitchy GPU frame.
    const bool want_menu =
        !level_live && (!last_step || now - last_step > kMenuAfterNs);
    if (want_menu) {
      menu_confirm = std::min(menu_confirm + 1, kMenuConfirmFrames * 4);
    } else {
      menu_confirm = 0;
    }
    const bool menu = menu_confirm >= kMenuConfirmFrames;

    uint32_t refresh_bits = LoadBE32(base, kSchedulerRefreshHz);
    float refresh_hz;
    std::memcpy(&refresh_hz, &refresh_bits, sizeof(refresh_hz));
    if (!(refresh_hz >= 20.0f && refresh_hz <= 240.0f)) {
      refresh_hz = 59.94f;
    }
    const uint32_t menu_periods =
        std::max(game_periods, uint32_t(std::lround(double(refresh_hz) / double(menu_rate))));

    // Optional: unlocked 60 FPS on a slow host → steady 30 for the rest of the
    // level. Off by default; when on, do not bounce back to 60 mid-mission
    // (that made right-stick look feel dead — see upstream issue #45).
    if (!menu && REXCVAR_GET(smooth_host_pacing) && menu_rate > 0 && game_periods < menu_periods) {
      if (ema_frame_s >= kHostSlowEnterS) {
        host_slow_confirm = std::min(host_slow_confirm + 1, kHostSlowConfirmFrames * 4);
      } else {
        host_slow_confirm = 0;
      }
      if (!host_limited && host_slow_confirm >= kHostSlowConfirmFrames) {
        host_limited = true;
        REXLOG_INFO("Frame pacing: host ~{:.0f} fps — steady {} fps in level (was {:.0f})",
                    1.0 / ema_frame_s, menu_rate, double(refresh_hz) / double(game_periods));
      }
    } else {
      host_slow_confirm = 0;
      if (menu) {
        host_limited = false;
      }
    }

    const uint32_t wanted = menu || host_limited ? menu_periods : game_periods;
    if (wanted != current) {
      StoreBE32(base, address, wanted);
    }
    applied_periods = wanted;
    if (menu != in_menu) {
      in_menu = menu;
      REXLOG_INFO("Frame pacing: {:.2f} fps, {}", double(refresh_hz) / double(wanted),
                  menu ? "no level running (menus)" : "level running");
    }
  }
  __imp__sub_82718710(ctx, base);
}
