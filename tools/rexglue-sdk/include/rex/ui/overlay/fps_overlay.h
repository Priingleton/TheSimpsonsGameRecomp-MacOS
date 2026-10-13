/**
 * @file        rex/ui/overlay/fps_overlay.h
 *
 * @brief       Lightweight top-right FPS counter overlay.
 *
 * @copyright   Copyright (c) 2026 Tom Clay <tomc@tctechstuff.com>
 *              All rights reserved.
 *
 * @license     BSD 3-Clause License
 *              See LICENSE file in the project root for full license text.
 */
#pragma once

#include <rex/ui/imgui_dialog.h>
#include <rex/ui/overlay/debug_overlay.h>

#include <functional>

namespace rex::ui {

class FpsOverlayDialog : public ImGuiDialog {
 public:
  using FrameStatsProvider = DebugOverlayDialog::FrameStatsProvider;

  explicit FpsOverlayDialog(ImGuiDrawer* imgui_drawer, FrameStatsProvider stats_provider = {});
  ~FpsOverlayDialog() override;

  void SetStatsProvider(FrameStatsProvider provider) { stats_provider_ = std::move(provider); }

 protected:
  void OnDraw(ImGuiIO& io) override;

 private:
  FrameStatsProvider stats_provider_;
};

}  // namespace rex::ui
