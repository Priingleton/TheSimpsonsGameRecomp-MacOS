/**
 * @file        core/guest_frame_stats.cpp
 * @brief       Guest swap timing for FPS overlays (not host vsync paint rate).
 */
#include <rex/graphics/guest_frame_stats.h>

#include <atomic>
#include <chrono>
#include <cstring>

namespace rex::graphics {
namespace {

std::atomic<uint64_t> g_guest_swap_count{0};
std::atomic<uint64_t> g_guest_fps_bits{0};
std::atomic<uint64_t> g_guest_frame_ms_bits{0};

uint64_t DoubleBits(double value) {
  uint64_t bits = 0;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  return bits;
}

double DoubleFromBits(uint64_t bits) {
  double value = 0.0;
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

}  // namespace

void NoteGuestSwap() {
  // Command-processor thread only: EMA of time between guest Xenos swaps.
  static int64_t last_ns = 0;
  static double ema_ms = 0.0;
  const int64_t now = std::chrono::duration_cast<std::chrono::nanoseconds>(
                          std::chrono::steady_clock::now().time_since_epoch())
                          .count();
  g_guest_swap_count.fetch_add(1, std::memory_order_relaxed);
  if (last_ns) {
    const double dt_ms = double(now - last_ns) * 1e-6;
    if (dt_ms > 0.1 && dt_ms < 1000.0) {
      ema_ms = ema_ms <= 0.0 ? dt_ms : ema_ms * 0.90 + dt_ms * 0.10;
      g_guest_frame_ms_bits.store(DoubleBits(ema_ms), std::memory_order_relaxed);
      g_guest_fps_bits.store(DoubleBits(ema_ms > 0.0 ? 1000.0 / ema_ms : 0.0),
                             std::memory_order_relaxed);
    }
  }
  last_ns = now;
}

GuestSwapStats GetGuestSwapStats() {
  GuestSwapStats stats;
  stats.swap_count = g_guest_swap_count.load(std::memory_order_relaxed);
  stats.frame_time_ms = DoubleFromBits(g_guest_frame_ms_bits.load(std::memory_order_relaxed));
  stats.fps = DoubleFromBits(g_guest_fps_bits.load(std::memory_order_relaxed));
  return stats;
}

}  // namespace rex::graphics
