/**
 ******************************************************************************
 * Xenia : Xbox 360 Emulator Research Project                                 *
 ******************************************************************************
 * Copyright 2021 Ben Vanik. All rights reserved.                             *
 * Released under the BSD license - see LICENSE in the root for more details. *
 ******************************************************************************
 *
 * @modified    Rien Gupta, 2026 - Adapted for ReXGlue runtime
 */

#include <rex/ui/surface_mac.h>

#import <QuartzCore/CAMetalLayer.h>

#include <SDL3/SDL_metal.h>
#include <SDL3/SDL_video.h>

namespace rex {
namespace ui {

CAMetalLayerSurface::~CAMetalLayerSurface() {
  if (metal_view_) {
    SDL_Metal_DestroyView(static_cast<SDL_MetalView>(metal_view_));
    metal_view_ = nullptr;
  }
}

bool CAMetalLayerSurface::GetSizeImpl(uint32_t& width_out, uint32_t& height_out) const {
  // Prefer the Metal layer's own bounds (backing pixels) so swapchain size
  // matches what will actually present after Spaces fullscreen / notch.
  if (layer_) {
    CAMetalLayer* metal_layer = (__bridge CAMetalLayer*)layer_;
    if ([metal_layer isKindOfClass:[CAMetalLayer class]]) {
      const CGFloat scale = metal_layer.contentsScale > 0.0 ? metal_layer.contentsScale : 1.0;
      const CGSize bounds = metal_layer.bounds.size;
      const uint32_t w = uint32_t(bounds.width * scale + 0.5);
      const uint32_t h = uint32_t(bounds.height * scale + 0.5);
      if (w > 0 && h > 0) {
        width_out = w;
        height_out = h;
        return true;
      }
      // Fall back to drawableSize if bounds are not ready yet.
      const CGSize drawable = metal_layer.drawableSize;
      if (drawable.width >= 2.0 && drawable.height >= 2.0) {
        width_out = uint32_t(drawable.width + 0.5);
        height_out = uint32_t(drawable.height + 0.5);
        return true;
      }
    }
  }

  int pixel_width = 0;
  int pixel_height = 0;
  if (!SDL_GetWindowSizeInPixels(window_, &pixel_width, &pixel_height)) {
    return false;
  }
  width_out = uint32_t(pixel_width);
  height_out = uint32_t(pixel_height);
  return true;
}

double CAMetalLayerSurface::GetBackingScale() const {
  if (layer_) {
    CAMetalLayer* metal_layer = (__bridge CAMetalLayer*)layer_;
    if ([metal_layer isKindOfClass:[CAMetalLayer class]] && metal_layer.contentsScale > 0.0) {
      return double(metal_layer.contentsScale);
    }
  }
  const float density = SDL_GetWindowPixelDensity(window_);
  return density > 0.0f ? double(density) : 1.0;
}

void CAMetalLayerSurface::ConfigureMetalLayer(uint32_t drawable_width, uint32_t drawable_height,
                                              double contents_scale) const {
  if (!layer_ || !drawable_width || !drawable_height) {
    return;
  }
  CAMetalLayer* metal_layer = (__bridge CAMetalLayer*)layer_;
  if (![metal_layer isKindOfClass:[CAMetalLayer class]]) {
    return;
  }
  metal_layer.contentsScale = contents_scale > 0.0 ? contents_scale : 1.0;
  metal_layer.drawableSize = CGSizeMake(drawable_width, drawable_height);
}

}  // namespace ui
}  // namespace rex
