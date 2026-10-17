#pragma once

#include <cstdint>
#include <filesystem>

#include <rex/ppc/context.h>

namespace rex::ui {
class ImGuiDrawer;
}  // namespace rex::ui

struct ImFont;

// Native Options › CAMERA (Apt list row). Brightness-style FOV slider.
void InitCameraOptions(rex::ui::ImGuiDrawer* drawer, std::filesystem::path config_path);
void ShutdownCameraOptions();
void ShowCameraOptions();
void HideCameraOptions();
bool IsCameraOptionsVisible();
bool CameraOptionsEatsPad();
bool CameraOptionsConsumePad(PPCContext& ctx, uint8_t* base, uint16_t buttons,
                             int16_t stick_x, int16_t stick_y, uint16_t* pass_button);
void SetCameraOptionsFont(ImFont* font);
void CameraOptionsOnPage(uint32_t page);
