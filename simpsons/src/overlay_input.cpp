#include "rex/ui/overlay_input.h"

#include <atomic>

namespace rex::ui {
namespace {

std::atomic<int> g_overlay_input_count{0};

}  // namespace

void AcquireOverlayInput() {
  g_overlay_input_count.fetch_add(1, std::memory_order_relaxed);
}

void ReleaseOverlayInput() {
  g_overlay_input_count.fetch_sub(1, std::memory_order_relaxed);
}

bool IsOverlayInputActive() {
  return g_overlay_input_count.load(std::memory_order_relaxed) > 0;
}

}  // namespace rex::ui
