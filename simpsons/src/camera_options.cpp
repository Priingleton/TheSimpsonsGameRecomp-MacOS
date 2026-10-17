// Native Options › CAMERA (replaces Downloads in the list; does not open
// DownloadsScreen). Apt keeps the frame; we draw a brightness-style FOV
// slider in the page body (Highlander yellow).

#include "camera_options.h"

#include <rex/cvar.h>
#include <rex/logging.h>
#include <rex/ui/imgui_dialog.h>

#include <imgui.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace {

constexpr const char* kSettingsEnd = "# <<< LAUNCHER SETTINGS <<<";
std::filesystem::path g_config;

constexpr uint16_t kPadUp = 0x0001;
constexpr uint16_t kPadDown = 0x0002;
constexpr uint16_t kPadLeft = 0x0004;
constexpr uint16_t kPadRight = 0x0008;
constexpr uint16_t kPadA = 0x1000;
constexpr uint16_t kPadB = 0x2000;
constexpr int kStick = 16000;

// Camera takes the old Downloads slot (Audio=1 … Video=2 … Controls=3 … Credits=4 … Camera=5).
constexpr uint32_t kCameraPage = 5;

constexpr double kFovMin = 0.7;
constexpr double kFovMax = 1.4;
constexpr double kFovDefault = 1.0;
constexpr double kFovStep = 0.05;

enum class Screen { kOff, kSettings };

rex::ui::ImGuiDialog* g_dialog = nullptr;
ImFont* g_menu_font = nullptr;
std::atomic<bool> g_ready{false};
std::atomic<Screen> g_screen{Screen::kOff};
bool g_wait_neutral = false;
uint16_t g_prev_buttons = 0;
int g_held = 0;
int64_t g_next_ns = 0;
double g_fov = kFovDefault;
bool g_dirty = false;

int64_t NowNs() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

double ClampFov(double value) {
  if (!std::isfinite(value)) {
    return kFovDefault;
  }
  return std::clamp(value, kFovMin, kFovMax);
}

double SnapFov(double value) {
  value = ClampFov(value);
  const double steps = std::round((value - kFovMin) / kFovStep);
  return ClampFov(kFovMin + steps * kFovStep);
}

void SyncFromCvar() {
  const std::string raw = rex::cvar::GetFlagByName("camera_fov");
  char* end = nullptr;
  const double parsed = raw.empty() ? kFovDefault : std::strtod(raw.c_str(), &end);
  g_fov = SnapFov(end != raw.c_str() ? parsed : kFovDefault);
  g_dirty = false;
}

bool LineIsKey(const std::string& line, const std::string& key) {
  size_t i = 0;
  while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) {
    ++i;
  }
  if (i >= line.size() || line[i] == '#') {
    return false;
  }
  if (line.compare(i, key.size(), key) != 0) {
    return false;
  }
  i += key.size();
  while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) {
    ++i;
  }
  return i < line.size() && line[i] == '=';
}

void WriteFovToml(const std::string& value) {
  if (g_config.empty()) {
    return;
  }
  std::vector<std::string> lines;
  {
    std::ifstream in(g_config);
    std::string line;
    while (std::getline(in, line)) {
      if (!line.empty() && line.back() == '\r') {
        line.pop_back();
      }
      lines.push_back(std::move(line));
    }
  }
  bool seen = false;
  const std::string updated = std::string("camera_fov = ") + value;
  for (auto& line : lines) {
    if (LineIsKey(line, "camera_fov")) {
      line = updated;
      seen = true;
    }
  }
  if (!seen) {
    const auto end = std::find_if(lines.begin(), lines.end(), [](const std::string& line) {
      size_t i = 0;
      while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) {
        ++i;
      }
      return line.compare(i, std::strlen(kSettingsEnd), kSettingsEnd) == 0;
    });
    lines.insert(end, updated);
  }
  const auto tmp = g_config.string() + ".camera-tmp";
  {
    std::ofstream out(tmp, std::ios::trunc);
    if (!out) {
      return;
    }
    for (const auto& line : lines) {
      out << line << '\n';
    }
  }
  std::error_code error;
  std::filesystem::rename(tmp, g_config, error);
}

void ApplyIfDirty() {
  if (!g_dirty) {
    return;
  }
  g_dirty = false;
  const double value = SnapFov(g_fov);
  g_fov = value;
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.2f", value);
  if (!rex::cvar::SetFlagByName("camera_fov", buf)) {
    REXLOG_WARN("Camera options: camera_fov = {} was not applied", buf);
  }
  WriteFovToml(buf);
}

void OpenSettings() {
  if (g_screen.load(std::memory_order_relaxed) == Screen::kSettings) {
    return;
  }
  SyncFromCvar();
  g_wait_neutral = true;
  g_held = 0;
  g_prev_buttons = 0;
  g_screen.store(Screen::kSettings, std::memory_order_relaxed);
  REXLOG_INFO("Camera options: open");
}

void CloseAll() {
  ApplyIfDirty();
  g_screen.store(Screen::kOff, std::memory_order_relaxed);
  g_held = 0;
}

void DrawOutlined(ImDrawList* draw, ImFont* font, float size, ImVec2 pos, const char* text,
                  ImU32 fill) {
  const ImU32 outline = IM_COL32(0, 0, 0, 255);
  const float o = std::max(2.0f, size * 0.08f);
  for (int dy = -2; dy <= 2; ++dy) {
    for (int dx = -2; dx <= 2; ++dx) {
      if (dx == 0 && dy == 0) {
        continue;
      }
      if (std::abs(dx) + std::abs(dy) > 3) {
        continue;
      }
      draw->AddText(font, size, ImVec2(pos.x + float(dx) * o * 0.5f, pos.y + float(dy) * o * 0.5f),
                    outline, text);
    }
  }
  draw->AddText(font, size, pos, fill, text);
}

void NudgeFov(int delta_steps) {
  g_fov = SnapFov(g_fov + double(delta_steps) * kFovStep);
  g_dirty = true;
}

void DrawSettings(ImGuiIO& io) {
  ApplyIfDirty();

  const float panel_w = io.DisplaySize.x * 0.50f;
  const float panel_h = io.DisplaySize.y * 0.36f;
  const ImVec2 origin((io.DisplaySize.x - panel_w) * 0.5f, io.DisplaySize.y * 0.30f);
  ImGui::SetNextWindowPos(origin, ImGuiCond_Always);
  ImGui::SetNextWindowSize(ImVec2(panel_w, panel_h), ImGuiCond_Always);
  ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
  const ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoNav |
                                 ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                 ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_NoInputs |
                                 ImGuiWindowFlags_NoBackground;
  if (ImGui::Begin("##camera-settings", nullptr, flags)) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    ImFont* font = g_menu_font ? g_menu_font : ImGui::GetFont();
    const float scale = std::clamp(io.DisplaySize.y / 720.0f, 0.85f, 2.2f);
    const float label_size = 38.0f * scale;
    const ImU32 yellow = IM_COL32(255, 220, 0, 255);
    const ImU32 yellow_dim = IM_COL32(196, 120, 0, 255);
    const ImU32 track = IM_COL32(20, 40, 80, 220);
    const ImU32 fill = IM_COL32(255, 220, 0, 255);

    const char* title = "Field of View";
    const ImVec2 title_sz = font->CalcTextSizeA(label_size, FLT_MAX, 0.0f, title);
    DrawOutlined(draw, font, label_size,
                 ImVec2(origin.x + (panel_w - title_sz.x) * 0.5f, origin.y + 8.0f * scale), title,
                 yellow);

    const float bar_w = panel_w * 0.72f;
    const float bar_h = 28.0f * scale;
    const float bar_x = origin.x + (panel_w - bar_w) * 0.5f;
    const float bar_y = origin.y + label_size * 1.55f + 24.0f * scale;
    draw->AddRectFilled(ImVec2(bar_x, bar_y), ImVec2(bar_x + bar_w, bar_y + bar_h), track, 0.0f);

    const float t =
        float((SnapFov(g_fov) - kFovMin) / (kFovMax - kFovMin));
    const float thumb_w = 18.0f * scale;
    const float thumb_x = bar_x + t * (bar_w - thumb_w);
    draw->AddRectFilled(ImVec2(bar_x, bar_y), ImVec2(thumb_x + thumb_w * 0.5f, bar_y + bar_h),
                        fill, 0.0f);
    draw->AddRectFilled(ImVec2(thumb_x, bar_y - 4.0f * scale),
                        ImVec2(thumb_x + thumb_w, bar_y + bar_h + 4.0f * scale), yellow, 0.0f);

    // Default mark in the middle.
    const float mid_x = bar_x + 0.5f * bar_w;
    draw->AddRectFilled(ImVec2(mid_x - 1.5f * scale, bar_y - 8.0f * scale),
                        ImVec2(mid_x + 1.5f * scale, bar_y + bar_h + 8.0f * scale), yellow_dim,
                        0.0f);

    char value_text[32];
    const int pct = int(std::lround(SnapFov(g_fov) * 100.0));
    std::snprintf(value_text, sizeof(value_text), "%d%%", pct);
    const float value_size = 34.0f * scale;
    const ImVec2 value_sz = font->CalcTextSizeA(value_size, FLT_MAX, 0.0f, value_text);
    DrawOutlined(draw, font, value_size,
                 ImVec2(origin.x + (panel_w - value_sz.x) * 0.5f, bar_y + bar_h + 18.0f * scale),
                 value_text, yellow);

    const char* hint = "< tighter          wider >";
    const float hint_size = 22.0f * scale;
    const ImVec2 hint_sz = font->CalcTextSizeA(hint_size, FLT_MAX, 0.0f, hint);
    DrawOutlined(draw, font, hint_size,
                 ImVec2(origin.x + (panel_w - hint_sz.x) * 0.5f, bar_y + bar_h + 56.0f * scale),
                 hint, yellow_dim);
  }
  ImGui::End();
  ImGui::PopStyleVar(3);
  ImGui::PopStyleColor();
}

class MenuDialog final : public rex::ui::ImGuiDialog {
 public:
  explicit MenuDialog(rex::ui::ImGuiDrawer* drawer) : ImGuiDialog(drawer) {}

  bool WantsContinuousPaint() const override {
    return g_screen.load(std::memory_order_relaxed) != Screen::kOff;
  }

  void OnDraw(ImGuiIO& io) override {
    if (g_screen.load(std::memory_order_relaxed) != Screen::kOff) {
      DrawSettings(io);
    }
  }
};

bool Neutral(uint16_t buttons, int16_t stick_x, int16_t stick_y) {
  return buttons == 0 && std::abs(stick_x) < 8000 && std::abs(stick_y) < 8000;
}

int Direction(uint16_t buttons, int16_t stick_x, int16_t stick_y) {
  if ((buttons & kPadLeft) || stick_x < -kStick) {
    return 3;
  }
  if ((buttons & kPadRight) || stick_x > kStick) {
    return 4;
  }
  if ((buttons & kPadUp) || stick_y > kStick) {
    return 1;
  }
  if ((buttons & kPadDown) || stick_y < -kStick) {
    return 2;
  }
  return 0;
}

}  // namespace

void InitCameraOptions(rex::ui::ImGuiDrawer* drawer, std::filesystem::path config_path) {
  g_config = std::move(config_path);
  SyncFromCvar();
  if (drawer && !g_dialog) {
    g_dialog = new MenuDialog(drawer);
  }
  g_ready.store(true, std::memory_order_relaxed);
  REXLOG_INFO("Camera options: ready");
}

void ShutdownCameraOptions() {
  g_ready.store(false, std::memory_order_relaxed);
  CloseAll();
  if (g_dialog) {
    delete g_dialog;
    g_dialog = nullptr;
  }
}

void ShowCameraOptions() { OpenSettings(); }

void HideCameraOptions() { CloseAll(); }

bool IsCameraOptionsVisible() {
  return g_screen.load(std::memory_order_relaxed) != Screen::kOff;
}

bool CameraOptionsEatsPad() {
  return g_screen.load(std::memory_order_relaxed) != Screen::kOff;
}

bool CameraOptionsConsumePad(PPCContext& /*ctx*/, uint8_t* /*base*/, uint16_t buttons,
                             int16_t stick_x, int16_t stick_y, uint16_t* pass_button) {
  if (pass_button) {
    *pass_button = 0;
  }
  if (g_screen.load(std::memory_order_relaxed) == Screen::kOff) {
    g_prev_buttons = 0;
    g_held = 0;
    return false;
  }

  const uint16_t pressed = buttons & ~g_prev_buttons;
  g_prev_buttons = buttons;

  if (pressed & kPadB) {
    CloseAll();
    if (pass_button) {
      *pass_button = kPadB;
    }
    return true;
  }

  if (g_wait_neutral) {
    if (Neutral(buttons, stick_x, stick_y)) {
      g_wait_neutral = false;
    }
    return true;
  }

  const int direction = Direction(buttons, stick_x, stick_y);
  const int64_t now = NowNs();
  auto act = [&](int dir) {
    if (dir == 3) {
      NudgeFov(-1);
    } else if (dir == 4) {
      NudgeFov(1);
    }
  };
  if (direction == 0) {
    g_held = 0;
  } else if (direction != g_held) {
    g_held = direction;
    g_next_ns = now + 280'000'000;
    act(direction);
  } else if (now >= g_next_ns) {
    g_next_ns = now + 90'000'000;
    act(direction);
  }

  if ((pressed & kPadA) && direction == 0) {
    g_fov = kFovDefault;
    g_dirty = true;
  }
  return true;
}

void SetCameraOptionsFont(ImFont* font) { g_menu_font = font; }

void CameraOptionsOnPage(uint32_t page) {
  if (!g_ready.load(std::memory_order_relaxed)) {
    return;
  }
  if (page == kCameraPage) {
    OpenSettings();
  } else {
    CloseAll();
  }
}
