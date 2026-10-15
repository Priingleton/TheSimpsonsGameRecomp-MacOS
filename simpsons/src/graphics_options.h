#pragma once

#include <cstdint>
#include <filesystem>

#include <rex/ppc/context.h>

namespace rex::ui {
class ImGuiDrawer;
class Window;
}  // namespace rex::ui

struct ImFont;

// Native Options › GRAPHICS (Apt row). Page body uses Highlander CRT styling.
void InitGraphicsOptions(rex::ui::ImGuiDrawer* drawer, rex::ui::Window* window,
                         std::filesystem::path config_path);
void ShutdownGraphicsOptions();
void ShowGraphicsOptions();
void HideGraphicsOptions();
bool IsGraphicsOptionsVisible();
bool GraphicsOptionsEatsPad();
bool GraphicsOptionsConsumePad(PPCContext& ctx, uint8_t* base, uint16_t buttons,
                               int16_t stick_x, int16_t stick_y, uint16_t* pass_button);
void SetGraphicsOptionsFont(ImFont* font);
