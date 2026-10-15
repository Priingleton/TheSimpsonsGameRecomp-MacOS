// Native Options › GRAPHICS (Apt list row). The page body is drawn here to match
// the TV CRT look (Highlander yellow on tube blue). Stock Apt keeps the frame,
// title, and Back/Select prompts; we only fill the menu body.

#include "graphics_options.h"

#include "guest_memory.h"

#include <rex/cvar.h>
#include <rex/logging.h>
#include <rex/ppc.h>
#include <rex/ui/imgui_dialog.h>
#include <rex/ui/window.h>

#include <imgui.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr uint32_t kOptionsPage = 0x82D08DE0;
constexpr uint16_t kPadUp = 0x0001;
constexpr uint16_t kPadDown = 0x0002;
constexpr uint16_t kPadLeft = 0x0004;
constexpr uint16_t kPadRight = 0x0008;
constexpr uint16_t kPadA = 0x1000;
constexpr uint16_t kPadB = 0x2000;
constexpr int kStick = 16000;
constexpr const char* kSettingsEnd = "# <<< LAUNCHER SETTINGS <<<";

enum class Store { kBool, kInt, kFloat, kText };
enum class Screen { kOff, kSettings };

struct Choice {
  const char* label;
  const char* value;
};

struct Setting {
  const char* label;
  const char* key;
  const char* read_key;
  Store store;
  bool live;
  std::vector<Choice> choices;
  int index = 0;
  bool dirty = false;
};

rex::ui::Window* g_window = nullptr;
rex::ui::ImGuiDialog* g_dialog = nullptr;
std::filesystem::path g_config;
std::mutex g_mu;
std::vector<Setting> g_settings;
int g_settings_row = 0;
std::atomic<bool> g_ready{false};
std::atomic<Screen> g_screen{Screen::kOff};
bool g_synced = false;
bool g_wait_neutral = false;
uint16_t g_prev_buttons = 0;
int g_held = 0;
int64_t g_next_ns = 0;

int64_t NowNs() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

std::string Lower(std::string text) {
  for (char& c : text) {
    c = char(std::tolower(static_cast<unsigned char>(c)));
  }
  return text;
}

bool SameText(std::string a, std::string b) {
  if (!a.empty() && a.front() == '#') {
    a.erase(a.begin());
  }
  if (!b.empty() && b.front() == '#') {
    b.erase(b.begin());
  }
  return Lower(std::move(a)) == Lower(std::move(b));
}

int MatchChoice(const Setting& setting, const std::string& raw) {
  for (int i = 0; i < int(setting.choices.size()); ++i) {
    if (SameText(setting.choices[size_t(i)].value, raw)) {
      return i;
    }
  }
  char* end = nullptr;
  const double number = std::strtod(raw.c_str(), &end);
  if (end != raw.c_str()) {
    int best = 0;
    double best_distance = 1e9;
    for (int i = 0; i < int(setting.choices.size()); ++i) {
      char* choice_end = nullptr;
      const double choice = std::strtod(setting.choices[size_t(i)].value, &choice_end);
      if (choice_end == setting.choices[size_t(i)].value) {
        continue;
      }
      const double distance = std::fabs(choice - number);
      if (distance < best_distance) {
        best_distance = distance;
        best = i;
      }
    }
    if (best_distance <= 0.05) {
      return best;
    }
  }
  return 0;
}

const char* CurrentValue(const char* key) {
  for (const auto& setting : g_settings) {
    if (std::strcmp(setting.key, key) == 0 && !setting.choices.empty()) {
      return setting.choices[size_t(setting.index)].value;
    }
  }
  return "";
}

void SyncFromCvars() {
  for (auto& setting : g_settings) {
    const char* key = setting.read_key ? setting.read_key : setting.key;
    const std::string raw = rex::cvar::GetFlagByName(key);
    if (raw.empty() && std::strcmp(key, "resolution") != 0) {
      continue;
    }
    setting.index = MatchChoice(setting, raw);
    setting.dirty = false;
  }
}

std::string TomlValue(Store store, const std::string& value) {
  if (store != Store::kText) {
    return value;
  }
  std::string out = "\"";
  for (char c : value) {
    if (c == '\\' || c == '"') {
      out.push_back('\\');
    }
    out.push_back(c);
  }
  out.push_back('"');
  return out;
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

void WriteToml(const std::vector<std::pair<std::string, std::string>>& updates) {
  if (g_config.empty() || updates.empty()) {
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
  std::vector<bool> seen(updates.size(), false);
  for (auto& line : lines) {
    for (size_t i = 0; i < updates.size(); ++i) {
      if (LineIsKey(line, updates[i].first)) {
        line = updates[i].first + " = " + updates[i].second;
        seen[i] = true;
      }
    }
  }
  std::vector<std::string> extra;
  for (size_t i = 0; i < updates.size(); ++i) {
    if (!seen[i]) {
      extra.push_back(updates[i].first + " = " + updates[i].second);
    }
  }
  if (!extra.empty()) {
    const auto end = std::find_if(lines.begin(), lines.end(), [](const std::string& line) {
      size_t i = 0;
      while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) {
        ++i;
      }
      return line.compare(i, std::strlen(kSettingsEnd), kSettingsEnd) == 0;
    });
    lines.insert(end, extra.begin(), extra.end());
  }
  const auto tmp = g_config.string() + ".graphics-tmp";
  {
    std::ofstream out(tmp, std::ios::trunc);
    if (!out) {
      REXLOG_ERROR("Graphics options: could not write {}", g_config.string());
      return;
    }
    for (const auto& line : lines) {
      out << line << '\n';
    }
  }
  std::error_code error;
  std::filesystem::rename(tmp, g_config, error);
  if (error) {
    REXLOG_ERROR("Graphics options: could not save {} ({})", g_config.string(), error.message());
  }
}

bool SetFlag(const char* key, const std::string& value) {
  if (rex::cvar::SetFlagByName(key, value)) {
    return true;
  }
  REXLOG_WARN("Graphics options: {} = {} was not applied", key, value);
  return false;
}

void AddToml(std::vector<std::pair<std::string, std::string>>& toml, const char* key, Store store,
             const std::string& value) {
  toml.emplace_back(key, TomlValue(store, value));
}

void ApplyPending() {
  struct Pending {
    std::string key;
    std::string value;
  };
  std::vector<Pending> pending;
  bool set_fullscreen = false;
  bool fullscreen = false;
  bool write_present = false;
  bool immediate = false;
  {
    std::lock_guard lock(g_mu);
    bool present = false;
    for (auto& setting : g_settings) {
      if (!setting.dirty) {
        continue;
      }
      setting.dirty = false;
      pending.push_back({setting.key, setting.choices[size_t(setting.index)].value});
      if (std::strcmp(setting.key, "vsync") == 0 || std::strcmp(setting.key, "frame_rate") == 0) {
        present = true;
      }
    }
    if (present) {
      write_present = true;
      const int fps = std::atoi(CurrentValue("frame_rate"));
      immediate = fps == 0 || std::strcmp(CurrentValue("vsync"), "true") != 0;
    }
    for (const auto& item : pending) {
      if (item.key == "fullscreen") {
        set_fullscreen = true;
        fullscreen = item.value == "true";
      }
    }
  }
  if (pending.empty()) {
    return;
  }

  std::vector<std::pair<std::string, std::string>> toml;
  for (const auto& item : pending) {
    if (item.key == "fullscreen") {
      SetFlag("fullscreen", item.value);
      AddToml(toml, "fullscreen", Store::kBool, item.value);
    } else if (item.key == "resolution") {
      SetFlag("resolution", item.value);
      AddToml(toml, "resolution", Store::kText, item.value);
      const char* ids[] = {"", "720p", "1080p", "1440p", "4k"};
      const int sizes[][2] = {{1280, 720}, {1280, 720}, {1920, 1080}, {2560, 1440}, {3840, 2160}};
      int width = 1280;
      int height = 720;
      for (int i = 0; i < 5; ++i) {
        if (SameText(ids[i], item.value)) {
          width = sizes[i][0];
          height = sizes[i][1];
        }
      }
      const std::string w = std::to_string(width);
      const std::string h = std::to_string(height);
      SetFlag("window_width", w);
      SetFlag("window_height", h);
      SetFlag("video_mode_width", w);
      SetFlag("video_mode_height", h);
      AddToml(toml, "window_width", Store::kInt, w);
      AddToml(toml, "window_height", Store::kInt, h);
      AddToml(toml, "video_mode_width", Store::kInt, w);
      AddToml(toml, "video_mode_height", Store::kInt, h);
    } else if (item.key == "render_target_path_vulkan") {
      AddToml(toml, "render_target_path_vulkan", Store::kText, item.value);
    } else if (item.key == "vsync") {
      SetFlag("vsync", item.value);
      AddToml(toml, "vsync", Store::kBool, item.value);
    } else if (item.key == "present_letterbox") {
      SetFlag("present_letterbox", item.value);
      AddToml(toml, "present_letterbox", Store::kBool, item.value);
    } else if (item.key == "resolution_scale") {
      SetFlag("resolution_scale", item.value);
      AddToml(toml, "resolution_scale", Store::kInt, item.value);
    } else if (item.key == "swap_post_effect") {
      SetFlag("swap_post_effect", item.value);
      AddToml(toml, "swap_post_effect", Store::kText, item.value);
    } else if (item.key == "eye_shading") {
      SetFlag("eye_shading", item.value);
      AddToml(toml, "eye_shading", Store::kText, item.value);
    } else if (item.key == "anisotropic_override") {
      SetFlag("anisotropic_override", item.value);
      AddToml(toml, "anisotropic_override", Store::kInt, item.value);
    } else if (item.key == "ink_outlines") {
      SetFlag("ink_outlines", item.value);
      AddToml(toml, "ink_outlines", Store::kText, item.value);
    } else if (item.key == "ink_outline_strength") {
      SetFlag("ink_outline_strength", item.value);
      AddToml(toml, "ink_outline_strength", Store::kFloat, item.value);
    } else if (item.key == "ink_outline_color") {
      SetFlag("ink_outline_color", item.value);
      AddToml(toml, "ink_outline_color", Store::kText, item.value);
    } else if (item.key == "frame_rate") {
      const bool sixty = item.value != "30";
      SetFlag("framerate_limit", item.value);
      SetFlag("unlock_60fps", sixty ? "true" : "false");
      AddToml(toml, "frame_rate", Store::kInt, item.value);
      AddToml(toml, "framerate_limit", Store::kInt, item.value);
      AddToml(toml, "unlock_60fps", Store::kBool, sixty ? "true" : "false");
    } else if (item.key == "menu_frame_rate") {
      SetFlag("menu_frame_rate", item.value);
      AddToml(toml, "menu_frame_rate", Store::kInt, item.value);
    }
  }
  if (write_present) {
    const char* value = immediate ? "true" : "false";
    SetFlag("vulkan_allow_present_mode_immediate", value);
    AddToml(toml, "vulkan_allow_present_mode_immediate", Store::kBool, value);
  }
  if (set_fullscreen && g_window) {
    g_window->SetFullscreen(fullscreen);
  }
  WriteToml(toml);
}

ImFont* g_menu_font = nullptr;

void StepSettingsRow(int delta) {
  if (g_settings.empty()) {
    return;
  }
  const int count = int(g_settings.size());
  g_settings_row = (g_settings_row + delta + count) % count;
}

void StepSettingsValue(int delta) {
  if (g_settings.empty()) {
    return;
  }
  auto& setting = g_settings[size_t(g_settings_row)];
  const int count = int(setting.choices.size());
  if (count <= 0) {
    return;
  }
  setting.index = (setting.index + delta + count) % count;
  setting.dirty = true;
}

void OpenSettings(uint8_t* /*base*/) {
  if (g_screen.load(std::memory_order_relaxed) == Screen::kSettings) {
    return;
  }
  if (!g_synced) {
    SyncFromCvars();
    g_synced = true;
  }
  g_settings_row = 0;
  g_wait_neutral = true;
  g_held = 0;
  g_prev_buttons = 0;
  g_screen.store(Screen::kSettings, std::memory_order_relaxed);
  REXLOG_INFO("Graphics options: open");
}

void CloseAll() {
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

void DrawSettings(ImGuiIO& io) {
  std::lock_guard lock(g_mu);
  if (g_settings.empty()) {
    return;
  }

  // Text only — no panel fill, so the stock Apt CRT blue shows through.
  const float panel_w = io.DisplaySize.x * 0.40f;
  const float panel_h = io.DisplaySize.y * 0.50f;
  const ImVec2 origin((io.DisplaySize.x - panel_w) * 0.5f, io.DisplaySize.y * 0.22f);
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
  if (ImGui::Begin("##graphics-settings", nullptr, flags)) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    ImFont* font = g_menu_font ? g_menu_font : ImGui::GetFont();
    const float scale = std::clamp(io.DisplaySize.y / 720.0f, 0.85f, 2.2f);
    const float label_size = 38.0f * scale;
    const float value_size = 38.0f * scale;
    const float block_h = 88.0f * scale;
    float y = origin.y + 16.0f * scale;
    // Match Apt list selection: selected row is a deeper gold, not a lighter one.
    const ImU32 yellow = IM_COL32(255, 220, 0, 255);
    const ImU32 yellow_sel = IM_COL32(196, 120, 0, 255);

    for (int i = 0; i < int(g_settings.size()); ++i) {
      const auto& setting = g_settings[size_t(i)];
      const bool selected = i == g_settings_row;
      const ImU32 color = selected ? yellow_sel : yellow;
      const char* value = setting.choices[size_t(setting.index)].label;
      char value_text[64];
      std::snprintf(value_text, sizeof(value_text), "< %s >", value);

      const ImVec2 label_sz = font->CalcTextSizeA(label_size, FLT_MAX, 0.0f, setting.label);
      const ImVec2 value_sz = font->CalcTextSizeA(value_size, FLT_MAX, 0.0f, value_text);
      DrawOutlined(draw, font, label_size,
                   ImVec2(origin.x + (panel_w - label_sz.x) * 0.5f, y), setting.label, color);
      DrawOutlined(draw, font, value_size,
                   ImVec2(origin.x + (panel_w - value_sz.x) * 0.5f, y + label_size * 1.05f),
                   value_text, color);
      y += block_h;
    }
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
    ApplyPending();
    if (g_screen.load(std::memory_order_relaxed) != Screen::kOff) {
      DrawSettings(io);
    }
  }
};

bool Neutral(uint16_t buttons, int16_t stick_x, int16_t stick_y) {
  return buttons == 0 && std::abs(stick_x) < 8000 && std::abs(stick_y) < 8000;
}

int Direction(uint16_t buttons, int16_t stick_x, int16_t stick_y) {
  if ((buttons & kPadUp) || stick_y > kStick) {
    return 1;
  }
  if ((buttons & kPadDown) || stick_y < -kStick) {
    return 2;
  }
  if ((buttons & kPadLeft) || stick_x < -kStick) {
    return 3;
  }
  if ((buttons & kPadRight) || stick_x > kStick) {
    return 4;
  }
  return 0;
}

void ActSettings(int direction) {
  if (direction == 1) {
    StepSettingsRow(-1);
  } else if (direction == 2) {
    StepSettingsRow(1);
  } else if (direction == 3) {
    StepSettingsValue(-1);
  } else if (direction == 4) {
    StepSettingsValue(1);
  }
}

Setting Make(const char* label, const char* key, const char* read_key, Store store, bool live,
             std::initializer_list<Choice> choices, int index) {
  Setting setting;
  setting.label = label;
  setting.key = key;
  setting.read_key = read_key;
  setting.store = store;
  setting.live = live;
  setting.choices.assign(choices.begin(), choices.end());
  setting.index = index;
  return setting;
}

}  // namespace

void InitGraphicsOptions(rex::ui::ImGuiDrawer* drawer, rex::ui::Window* window,
                         std::filesystem::path config_path) {
  g_window = window;
  g_config = std::move(config_path);
  {
    std::lock_guard lock(g_mu);
    g_settings.clear();
    g_settings.push_back(Make("Display Mode", "fullscreen", nullptr, Store::kBool, true,
                              {{"Windowed", "false"}, {"Fullscreen", "true"}}, 0));
    g_settings.push_back(Make("Video Mode", "resolution", nullptr, Store::kText, false,
                              {{"Automatic", ""},
                               {"720p", "720p"},
                               {"1080p", "1080p"},
                               {"1440p", "1440p"},
                               {"4K", "4k"}},
                              0));
    g_settings.push_back(Make("Render Resolution", "resolution_scale", nullptr, Store::kInt, false,
                              {{"1x", "1"}, {"2x", "2"}, {"3x", "3"}}, 0));
    g_settings.push_back(Make(
        "FPS", "frame_rate", "framerate_limit", Store::kInt, true,
        {{"30", "30"}, {"60", "60"}, {"90", "90"}, {"120", "120"}, {"Unlimited", "0"}}, 1));
    g_settings_row = 0;
    g_synced = false;
  }
  if (drawer && !g_dialog) {
    g_dialog = new MenuDialog(drawer);
  }
  g_ready.store(true, std::memory_order_relaxed);
  REXLOG_INFO("Graphics options: ready");
}

void ShutdownGraphicsOptions() {
  g_ready.store(false, std::memory_order_relaxed);
  CloseAll();
  if (g_dialog) {
    delete g_dialog;
    g_dialog = nullptr;
  }
  g_window = nullptr;
}

void ShowGraphicsOptions() { OpenSettings(nullptr); }

void HideGraphicsOptions() { CloseAll(); }

bool IsGraphicsOptionsVisible() {
  return g_screen.load(std::memory_order_relaxed) != Screen::kOff;
}

bool GraphicsOptionsEatsPad() {
  return g_screen.load(std::memory_order_relaxed) != Screen::kOff;
}

bool GraphicsOptionsConsumePad(PPCContext& ctx, uint8_t* base, uint16_t buttons, int16_t stick_x,
                               int16_t stick_y, uint16_t* pass_button) {
  if (pass_button) {
    *pass_button = 0;
  }
  const Screen screen = g_screen.load(std::memory_order_relaxed);
  if (screen == Screen::kOff) {
    g_prev_buttons = 0;
    g_held = 0;
    return false;
  }
  std::lock_guard lock(g_mu);
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

  (void)base;
  const int direction = Direction(buttons, stick_x, stick_y);
  const int64_t now = NowNs();
  if (direction == 0) {
    g_held = 0;
  } else if (direction != g_held) {
    g_held = direction;
    g_next_ns = now + 280'000'000;
    ActSettings(direction);
  } else if (now >= g_next_ns) {
    g_next_ns = now + 90'000'000;
    ActSettings(direction);
  }

  if ((pressed & kPadA) && direction == 0) {
    StepSettingsValue(1);
  }
  return true;
}

void SetGraphicsOptionsFont(ImFont* font) { g_menu_font = font; }

constexpr uint32_t kGraphicsPage = 2;

REX_EXTERN(__imp__sub_823A4C90);
REX_EXTERN(sub_823A4C90);

extern "C" REX_FUNC(sub_823A4C90) {
  __imp__sub_823A4C90(ctx, base);
  if (!g_ready.load(std::memory_order_relaxed)) {
    return;
  }
  const uint32_t page = simpsons::LoadGuestU32(base, kOptionsPage);
  if (page == kGraphicsPage) {
    OpenSettings(base);
  } else {
    CloseAll();
  }
}
