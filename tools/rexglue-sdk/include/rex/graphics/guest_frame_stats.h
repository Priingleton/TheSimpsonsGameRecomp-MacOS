/**
 * @file        rex/graphics/guest_frame_stats.h
 * @brief       Guest swap timing for FPS overlays (not host vsync paint rate).
 */
#pragma once

#include <cstdint>

namespace rex::graphics {

struct GuestSwapStats {
  double fps = 0.0;
  double frame_time_ms = 0.0;
  uint64_t swap_count = 0;
};

// Called once per guest Xenos swap on the command-processor thread.
void NoteGuestSwap();

// Snapshot for UI / overlays (safe from any thread).
GuestSwapStats GetGuestSwapStats();

}  // namespace rex::graphics
