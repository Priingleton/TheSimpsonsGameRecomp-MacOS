// The Simpsons Game — ReXGlue recompiled project (macOS)
//
// Game behaviour fixes come from YesterMester/TheSimpsonsGameRecomp (src/*.cpp
// beside this file). This class adds desktop macOS paths and MoltenVK-friendly
// defaults. Players install game data through TSG Launcher.

#pragma once

#include <rex/cvar.h>
#include <rex/cvar_defaults.h>
#include <rex/filesystem/devices/disc_image_device.h>
#include <rex/graphics/guest_frame_stats.h>
#include <rex/logging.h>
#include <rex/rex_app.h>
#include <rex/ui/style.h>

#include <imgui.h>

#include "graphics_options.h"
#include "test_harness.h"

#include <CoreFoundation/CoreFoundation.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <utility>
#include <vector>

namespace rex::ui {
class Presenter;
class Window;
}

namespace rex::memory {
class Memory;
}

void ApplyInkOutlineOptions(rex::memory::Memory* memory);
void ApplyEyeShadingOptions(rex::memory::Memory* memory);

void InitFreecam(rex::ui::Window* window, rex::ui::Presenter* presenter,
                 std::filesystem::path shots_dir);
void ShutdownFreecam(rex::ui::Window* window);

class SimpsonsApp : public rex::ReXApp {
 public:
  using rex::ReXApp::ReXApp;

  static std::unique_ptr<rex::ui::WindowedApp> Create(rex::ui::WindowedAppContext& ctx) {
    return std::unique_ptr<SimpsonsApp>(new SimpsonsApp(ctx, "simpsons", PPCImageConfig));
  }

 protected:
  // Paths come from TSG Launcher (--game_data_root / --user_data_root).
  void OnConfigurePaths(rex::PathConfig& paths) override {
    SetDefaults();
    WriteDefaultConfig(paths.config_path);
    config_path_ = paths.config_path;
    if (!paths.game_data_root.empty()) {
      SetLanguageDefault(paths.game_data_root);
    }
    if (const char* home = std::getenv("HOME"); home && *home) {
      shots_dir_ = std::filesystem::path(home) / "Pictures" / "The Simpsons Game";
    } else {
      shots_dir_ = paths.user_data_root / "shots";
    }
  }

  void OnCreateDialogs(rex::ui::ImGuiDrawer* drawer) override {
    InitGraphicsOptions(drawer, window(), config_path_);
    if (graphics_font_) {
      SetGraphicsOptionsFont(graphics_font_);
    }
  }

  void OnConfigureFonts(ImFontAtlas* atlas) override {
    if (!atlas) {
      return;
    }
    const char* kName = "Highlander ITC Std Bold.otf";
    std::vector<std::filesystem::path> candidates;
    if (const char* root = std::getenv("SIMPSONS_PACKAGE_ROOT"); root && *root) {
      candidates.emplace_back(std::filesystem::path(root) / "art" / "fonts" / kName);
    }
    candidates.emplace_back(std::filesystem::path("art") / "fonts" / kName);
    candidates.emplace_back(std::filesystem::path("simpsons") / "assets" / "fonts" / kName);
    candidates.emplace_back(std::filesystem::path("assets") / "fonts" / kName);
    // Dev tree: binary under out/build/... → repo root art/fonts or assets.
    candidates.emplace_back(std::filesystem::current_path() / "art" / "fonts" / kName);
    candidates.emplace_back(std::filesystem::current_path() / "assets" / "fonts" / kName);

    ImFontConfig cfg;
    cfg.OversampleH = 2;
    cfg.OversampleV = 2;
    cfg.PixelSnapH = false;
    for (const auto& path : candidates) {
      std::error_code error;
      if (!std::filesystem::is_regular_file(path, error)) {
        continue;
      }
      graphics_font_ = atlas->AddFontFromFileTTF(path.string().c_str(), 56.0f, &cfg);
      if (graphics_font_) {
        REXLOG_INFO("Graphics options font: {}", path.string());
        return;
      }
    }
    REXLOG_WARN("Graphics options: Highlander font not found (tried art/fonts/{})", kName);
  }

  void OnConfigureStyle(ImGuiStyle& imgui_style, rex::ui::Style& ui_style) override {
    // Springfield yellow accents — same family as the Mac launcher.
    imgui_style.Colors[ImGuiCol_CheckMark] = ImVec4(0.11f, 0.11f, 0.11f, 1.00f);
    imgui_style.Colors[ImGuiCol_SliderGrab] = ImVec4(0.996f, 0.851f, 0.059f, 1.00f);
    imgui_style.Colors[ImGuiCol_SliderGrabActive] = ImVec4(0.79f, 0.64f, 0.00f, 1.00f);
    ui_style.settings.lifecycle_live = ImVec4(0.18f, 0.61f, 0.29f, 1.00f);
    ui_style.settings.lifecycle_restart = ImVec4(0.91f, 0.19f, 0.19f, 1.00f);
    ui_style.settings.warning = ImVec4(0.79f, 0.64f, 0.00f, 1.00f);
  }

  void OnPostLoadXexImage() override {
    ApplyInkOutlineOptions(runtime()->memory());
    ApplyEyeShadingOptions(runtime()->memory());
  }

  void OnPostSetup() override {
    if (auto* w = window()) {
      w->SetTitle("The Simpsons Game");
      // Hide the macOS pointer after a short idle (YouTube-style), reveal on move/click.
      w->SetCursorAutoHideDelayMs(2000);
      w->SetCursorVisibility(rex::ui::Window::CursorVisibility::kAutoHidden);
    }
    rex::ui::Presenter* presenter = nullptr;
    if (auto* graphics = runtime()->graphics_system()) {
      presenter = graphics->presenter();
    }
    InitFreecam(window(), presenter, shots_dir_);
    REXLOG_INFO("Photo mode screenshots: {}", shots_dir_.string());
    SetGuestFrameStats([this] { return SampleFrame(); });
    StartTestHarness();
  }

  void OnShutdown() override {
    ShutdownGraphicsOptions();
    ShutdownFreecam(window());
    shots_.Stop();
  }

 private:
  // Prefer a language folder that exists on the disc (European discs may omit English).
  static void SetLanguageDefault(const std::filesystem::path& game_root) {
    static const std::pair<const char*, int> kLanguages[] = {
        {"en", 1}, {"ja", 2}, {"de", 3}, {"fr", 4}, {"es", 5}, {"it", 6},
        {"ko", 7}, {"zh", 8}, {"pt", 9}, {"pl", 11}, {"ru", 12}, {"nl", 14},
    };
    std::vector<std::string> present;
    std::unique_ptr<rex::filesystem::DiscImageDevice> disc;
    if (std::filesystem::is_regular_file(game_root)) {
      disc = std::make_unique<rex::filesystem::DiscImageDevice>("language", game_root);
      if (!disc->Initialize()) return;
    }
    std::error_code ec;
    for (const char* dir : {"movies", "audiostreams"}) {
      if (disc) {
        for (const auto& [code, id] : kLanguages) {
          if (disc->ResolvePath(std::string(dir) + "\\" + code)) present.emplace_back(code);
        }
        if (!present.empty()) break;
        continue;
      }
      for (const auto& entry : std::filesystem::directory_iterator(game_root / dir, ec)) {
        if (entry.is_directory(ec) && entry.path().filename().string().size() == 2) {
          present.push_back(entry.path().filename().string());
        }
      }
      if (!present.empty()) {
        break;
      }
    }
    if (present.empty() ||
        std::find(present.begin(), present.end(), "en") != present.end()) {
      return;
    }
    std::string chosen;
    if (CFArrayRef preferred = CFLocaleCopyPreferredLanguages()) {
      for (CFIndex i = 0; i < CFArrayGetCount(preferred) && chosen.empty(); ++i) {
        char code[16] = {};
        auto language = static_cast<CFStringRef>(CFArrayGetValueAtIndex(preferred, i));
        if (CFStringGetCString(language, code, sizeof(code), kCFStringEncodingUTF8)) {
          std::string two(code, std::min<size_t>(2, std::strlen(code)));
          if (std::find(present.begin(), present.end(), two) != present.end()) {
            chosen = two;
          }
        }
      }
      CFRelease(preferred);
    }
    if (chosen.empty()) {
      std::sort(present.begin(), present.end());
      chosen = present.front();
    }
    for (const auto& [code, id] : kLanguages) {
      if (chosen == code) {
        rex::cvar::SetDefaultByName("user_language", std::to_string(id));
        REXLOG_INFO("Game language: {} (user_language {}), disc has {}", chosen, id,
                    present.size());
        return;
      }
    }
  }

  static void WriteDefaultConfig(const std::filesystem::path& path) {
    if (std::filesystem::exists(path)) {
      return;
    }
    std::ofstream out(path);
    if (!out) {
      return;
    }
    out << "# The Simpsons Game — macOS defaults. Prefer TSG Launcher for changes.\n"
           "gpu_plugin = \"xenos\"\n"
           "fullscreen = false\n"
           "window_width = 1280\n"
           "window_height = 720\n"
           "vsync = true\n"
           "present_letterbox = true\n"
           "unlock_60fps = true\n"
           "frame_rate = 60\n"
           "menu_frame_rate = 30\n"
           "framerate_limit = 60\n"
           "audio_maxqframes = 32\n"
           "audio_pace_callbacks = true\n"
           "subtitles = false\n"
           "vulkan_allow_present_mode_immediate = false\n"
           "vulkan_allow_present_mode_mailbox = false\n"
           "vulkan_allow_present_mode_fifo_relaxed = false\n";
  }

  static void SetDefaults() {
    using rex::cvar::SetDefaultByName;
    SetDefaultByName("gpu_plugin", "xenos");
    SetDefaultByName("vulkan_log_debug_messages", "false");
    SetDefaultByName("fullscreen", "false");
    SetDefaultByName("window_width", "1280");
    SetDefaultByName("window_height", "720");
    SetDefaultByName("present_letterbox", "true");
    SetDefaultByName("vsync", "true");
    SetDefaultByName("unlock_60fps", "true");
    SetDefaultByName("frame_rate", "60");
    SetDefaultByName("menu_frame_rate", "30");
    SetDefaultByName("signin_all_user_slots", "true");
    SetDefaultByName("fsi_sample_mask_from_sample_id", "true");
    SetDefaultByName("render_target_path_vulkan", "fbo");
    SetDefaultByName("clear_memory_page_state", "false");
    SetDefaultByName("vulkan_submit_on_primary_buffer_end", "false");
    SetDefaultByName("vulkan_allow_present_mode_immediate", "false");
    SetDefaultByName("vulkan_allow_present_mode_mailbox", "false");
    SetDefaultByName("vulkan_allow_present_mode_fifo_relaxed", "false");
    SetDefaultByName("framerate_limit", "0");
    SetDefaultByName("vulkan_moltenvk_async_submits", "true");
    SetDefaultByName("execute_unclipped_draw_vs_on_cpu", "true");
    SetDefaultByName("vulkan_batch_dirty_uploads", "true");
    SetDefaultByName("vulkan_tight_render_area", "true");
    SetDefaultByName("vulkan_shared_memory_direct_upload", "true");
    SetDefaultByName("vulkan_defer_cpu_uploads", "true");
    SetDefaultByName("audio_maxqframes", "32");
    SetDefaultByName("shared_memory_invalidation_widen_kb", "16");
    SetDefaultByName("vulkan_msaa_as_single_sample", "true");
    SetDefaultByName("audio_pace_callbacks", "true");
  }

  rex::ui::FrameStats SampleFrame() {
    const auto guest = rex::graphics::GetGuestSwapStats();
    stats_.fps = guest.fps;
    stats_.frame_time_ms = guest.frame_time_ms;
    stats_.frame_count = guest.swap_count;
    return stats_;
  }

  void StartTestHarness() {
    simpsons::AutoplayInputDriver::InstallFromEnvironment(runtime()->input_system());
    if (auto* graphics = runtime()->graphics_system()) {
      shots_.StartFromEnvironment(graphics->presenter(), shots_dir_);
    }
  }

  simpsons::ShotTaker shots_;
  std::filesystem::path shots_dir_;
  std::filesystem::path config_path_;
  ImFont* graphics_font_ = nullptr;
  rex::ui::FrameStats stats_{};
};
