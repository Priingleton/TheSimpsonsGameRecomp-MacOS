/**
 * @file        rex/filesystem/file_open_listener.h
 * @brief       Optional callback when the guest opens a virtual path.
 *
 * Titles can watch for UI assets (for example the Options menu) without
 * wrapping every NtCreateFile call themselves.
 */
#pragma once

#include <functional>
#include <string_view>

namespace rex::filesystem {

using FileOpenListener = std::function<void(std::string_view path)>;

void SetFileOpenListener(FileOpenListener listener);
void NotifyFileOpened(std::string_view path);

}  // namespace rex::filesystem
