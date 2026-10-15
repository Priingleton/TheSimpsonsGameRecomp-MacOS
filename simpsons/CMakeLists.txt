# The Simpsons Game - ReXGlue Recompiled Project (macOS).
#
# Runtime and generated sources come from the Apple/MoltenVK port used by
# DevZer0D4Y/TheSimpsonsGame-iOS. This tree targets native macOS (Apple Silicon)
# with SDL3 + Vulkan via MoltenVK. SDK boilerplate lives in generated/rexglue.cmake.

cmake_minimum_required(VERSION 3.25)
project(simpsons VERSION 0.2.2 LANGUAGES CXX)

if(NOT APPLE)
  message(FATAL_ERROR "This fork builds on macOS only (Apple Silicon / MoltenVK).")
endif()
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  message(FATAL_ERROR "iOS builds were removed from this macOS-only fork.")
endif()

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Keep build-machine paths (they contain the user name) out of the binary:
# source file names end up in log and assert messages.
add_compile_options("-ffile-prefix-map=${CMAKE_CURRENT_SOURCE_DIR}=simpsons")

include(generated/rexglue.cmake)

set(SIMPSONS_SOURCES
    src/main.cpp
    src/eye_shading.cpp
    src/fps_unlock.cpp
    src/frame_pacing.cpp
    src/freecam.cpp
    src/graphics_options.cpp
    src/ink_outlines.cpp
    src/overlay_input.cpp
    src/ring_wait.cpp
    src/subtitles.cpp
)

add_executable(simpsons ${SIMPSONS_SOURCES})

# simpsons_register.cpp is one flat function of ~76k function-pointer
# registrations, run once at startup, in a single basic block. LLVM is
# quadratic on it: -O1 takes over 20 minutes on an M1, and so does -O0 on
# arm64, where GlobalISel's Localizer pass walks the whole block for every
# constant. -O0 with the classic instruction selector compiles it quickly. The
# -O3 precompiled header cannot be used at -O0, so it is skipped here.
set_source_files_properties(
    ${CMAKE_CURRENT_SOURCE_DIR}/generated/default/simpsons_register.cpp
    PROPERTIES COMPILE_OPTIONS "-O0;-mllvm;-global-isel=0" SKIP_PRECOMPILE_HEADERS ON)

# CFLocale, for the game language default (src/simpsons_app.h).
target_link_libraries(simpsons PRIVATE "-framework CoreFoundation")

rexglue_setup_target(simpsons GPU_PLUGINS xenos)

# Highlander menu font for Options › GRAPHICS (host CRT body).
add_custom_command(
  TARGET simpsons
  POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:simpsons>/art/fonts"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "${CMAKE_CURRENT_SOURCE_DIR}/assets/fonts/Highlander ITC Std Bold.otf"
          "$<TARGET_FILE_DIR:simpsons>/art/fonts/Highlander ITC Std Bold.otf"
  COMMENT "Copy Highlander menu font next to simpsons")

