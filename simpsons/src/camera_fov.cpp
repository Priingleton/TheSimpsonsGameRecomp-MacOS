// Player camera field-of-view scale.
//
// Every gameplay (and free-camera) pose is written through sub_8269D130 with
// the field of view in radians in f1. Scaling that value widens or tightens
// the player view without touching camera position. Free camera applies its
// own FOV via the original import so this scale does not stack on top of it.

#include <algorithm>
#include <cmath>

#include <rex/cvar.h>
#include <rex/ppc.h>

REXCVAR_DEFINE_DOUBLE(camera_fov, 1.0, "Camera",
                      "Player camera field of view scale. 1.0 is the game default; "
                      "lower is tighter, higher is wider.")
    .range(0.7, 1.4);

REX_EXTERN(__imp__sub_8269D130);

namespace {

constexpr double kMinScale = 0.7;
constexpr double kMaxScale = 1.4;

}  // namespace

extern "C" REX_FUNC(sub_8269D130) {
  double scale = REXCVAR_GET(camera_fov);
  if (std::isfinite(scale) && scale > 0.0) {
    scale = std::clamp(scale, kMinScale, kMaxScale);
    if (std::fabs(scale - 1.0) > 1e-4) {
      ctx.f1.f64 *= scale;
    }
  }
  __imp__sub_8269D130(ctx, base);
}
