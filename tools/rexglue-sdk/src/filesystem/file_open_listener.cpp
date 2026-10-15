/**
 * @file        filesystem/file_open_listener.cpp
 * @brief       Guest file-open listener used by title-specific UI hooks.
 */
#include <rex/filesystem/file_open_listener.h>

#include <mutex>

namespace rex::filesystem {
namespace {

std::mutex g_mutex;
FileOpenListener g_listener;

}  // namespace

void SetFileOpenListener(FileOpenListener listener) {
  std::lock_guard lock(g_mutex);
  g_listener = std::move(listener);
}

void NotifyFileOpened(std::string_view path) {
  FileOpenListener listener;
  {
    std::lock_guard lock(g_mutex);
    listener = g_listener;
  }
  if (listener) {
    listener(path);
  }
}

}  // namespace rex::filesystem
