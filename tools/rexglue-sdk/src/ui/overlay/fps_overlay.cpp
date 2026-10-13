/**
 * @file        ui/overlay/fps_overlay.cpp
 *
 * @brief       Lightweight top-right FPS counter. See fps_overlay.h.
 *
 * @copyright   Copyright (c) 2026 Tom Clay <tomc@tctechstuff.com>
 *              All rights reserved.
 *
 * @license     BSD 3-Clause License
 *              See LICENSE file in the project root for full license text.
 */
#include <rex/ui/overlay/fps_overlay.h>

#include <cstdio>

#include <imgui.h>

namespace rex::ui {

FpsOverlayDialog::FpsOverlayDialog(ImGuiDrawer* imgui_drawer, FrameStatsProvider stats_provider)
    : ImGuiDialog(imgui_drawer), stats_provider_(std::move(stats_provider)) {}

FpsOverlayDialog::~FpsOverlayDialog() = default;

void FpsOverlayDialog::OnDraw(ImGuiIO& io) {
  double fps = 0.0;
  if (stats_provider_) {
    const FrameStats stats = stats_provider_();
    fps = stats.fps;
  }

  char label[48];
  if (fps >= 100.0) {
    std::snprintf(label, sizeof(label), "%.0f FPS", fps);
  } else if (fps > 0.0) {
    std::snprintf(label, sizeof(label), "%.1f FPS", fps);
  } else {
    std::snprintf(label, sizeof(label), "-- FPS");
  }

  const ImVec2 text_size = ImGui::CalcTextSize(label);
  constexpr float kPad = 12.0f;
  ImGui::SetNextWindowPos(
      ImVec2(io.DisplaySize.x - text_size.x - kPad * 2.0f, kPad), ImGuiCond_Always);
  ImGui::SetNextWindowBgAlpha(0.40f);
  ImGui::SetNextWindowSize(ImVec2(0.0f, 0.0f));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(kPad * 0.75f, kPad * 0.5f));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
  if (ImGui::Begin("##fps_counter", nullptr,
                   ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoInputs |
                       ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoSavedSettings |
                       ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoFocusOnAppearing |
                       ImGuiWindowFlags_NoMove)) {
    ImGui::TextUnformatted(label);
  }
  ImGui::End();
  ImGui::PopStyleVar(2);
}

}  // namespace rex::ui
