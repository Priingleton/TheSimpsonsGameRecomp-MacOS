/**
 * @file        rex/ui/overlay_input.h
 * @brief       Whether an overlay currently takes the keyboard and mouse.
 *
 * Local shim for the Mac build: the shipped Apple/MoltenVK SDK tree does not
 * yet install this header. Same API as upstream ReXGlue.
 */
#pragma once

namespace rex::ui {

// Overlays that take keyboard and mouse input themselves (settings, console,
// free camera) hold this while open. Keyboard & mouse controller emulation
// pauses and lets go of the mouse meanwhile.
void AcquireOverlayInput();
void ReleaseOverlayInput();
bool IsOverlayInputActive();

}  // namespace rex::ui
