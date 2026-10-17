#!/usr/bin/env python3
"""Apply Options › GRAPHICS / CAMERA UI patches to player-extracted game data.

Safe to run more than once. Does not ship any game assets — only rewrites the
player's own frontend.str / simpsons_chars_global.str after ISO extract.

Minimal boot-safe patches (same-size, inside options Apt Data:74):
  - Relabel Video → Graphics if still dashed
  - Relabel Downloads → Camera (list + page title)
  - Keep DownloadsScreen internal name (renaming it blacks out the game)
  - Keep the Graphics row (stop RemoveItems from dropping Video)
  - Do NOT blank marketplace body strings (that has also caused black boots)
  - Undo a bad CameraMenu retarget if present
"""

from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refpack import compress, decompress  # noqa: E402

APT_SIZE = 50362
STAMP_VERSION = "options-ui-v8"

DOWNLOADS_LIST = b"-Downloads-\x00$FE_Downloads\x00\x00\x00\x00\x00\x00"
CAMERA_PAD31 = b"Camera" + b"\x00" * 25

CONST_DOWNLOADS_SCREEN_ITEM = 1135
CONST_DOWNLOADS_SCREEN = b"DownloadsScreen\x00"
CONST_CAMERA_MENU = b"CameraMenu\x00\x00\x00\x00\x00\x00"

UIX_CONST_ITEM = 1276
UIX_CONST_OFF = 50416
UIX_CONST_ITEM_BASE = UIX_CONST_OFF + 0x20

APT_PATCHES: list[tuple[int, list[bytes], bytes]] = [
    (
        4852,
        [
            b"-Video-\x00$FE_Video\x00\x00\x00\x00\x00\x00",
            b"-Graphics-\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
            b"Graphics\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
        ],
        b"Graphics\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
    ),
    (
        4948,
        [DOWNLOADS_LIST, CAMERA_PAD31],
        CAMERA_PAD31,
    ),
    (
        5912,
        [DOWNLOADS_LIST, CAMERA_PAD31],
        CAMERA_PAD31,
    ),
]


def find_ci(dir_path: Path, name: str) -> Path | None:
    want = name.lower()
    try:
        for entry in dir_path.iterdir():
            if entry.name.lower() == want:
                return entry
    except OSError:
        return None
    return None


def find_str(gamedata: Path, *parts: str) -> Path | None:
    cur = gamedata
    for part in parts:
        nxt = find_ci(cur, part)
        if nxt is None:
            return None
        cur = nxt
    return cur if cur.is_file() else None


def iter_chunks(data: bytes):
    if len(data) < 0x20 or data[0:4] != b"SToc":
        raise ValueError("not an SToc .str archive")
    files = (struct.unpack_from(">I", data, 8)[0] >> 24) & 0xFF
    info = struct.unpack_from(">I", data, 0x10)[0]
    off = 0x800
    for i in range(files):
        e = info + i * 24
        hh, sz, ig, xs, dm = struct.unpack_from(">QIIII", data, e)
        yield {
            "index": i,
            "e": e,
            "hh": hh,
            "sz": sz,
            "ig": ig,
            "xs": xs,
            "dm": dm,
            "blob": data[off : off + xs],
        }
        off += xs


def find_options_uix(raw: bytes) -> int | None:
    idx = 0
    while True:
        j = raw.find(b"uixf", idx)
        if j < 0:
            return None
        if raw[j + 8 : j + 12] == b"titl" and b"options" in raw[j + 16 : j + 40]:
            return j
        idx = j + 4


def apply_apt_patches(apt: bytearray) -> list[str]:
    notes: list[str] = []
    if len(apt) < APT_SIZE:
        raise ValueError(f"options apt too small ({len(apt)})")
    if not apt.startswith(b"Apt Data:74"):
        raise ValueError("bad Apt magic")

    for off, expects, repl in APT_PATCHES:
        assert all(len(e) == len(repl) for e in expects)
        cur = bytes(apt[off : off + len(repl)])
        if cur == repl:
            continue
        if cur not in expects:
            if off in (4852, 4948):
                raise ValueError(
                    f"unexpected bytes at apt+{off}: got {cur!r}, want one of {expects!r}"
                )
            notes.append(f"skip apt+{off} (already customized)")
            continue
        apt[off : off + len(repl)] = repl
        notes.append(f"patched apt+{off}")
    if apt[4852:4860] == b"Graphics" and apt[4948:4954] == b"Camera":
        notes.append("Graphics + Camera labels present")
    return notes


def restore_downloads_screen_name(raw: bytearray, uix: int) -> str:
    cf = uix + UIX_CONST_OFF
    item = uix + UIX_CONST_ITEM_BASE + CONST_DOWNLOADS_SCREEN_ITEM * 8
    t, v = struct.unpack_from(">II", raw, item)
    if t != 1:
        raise ValueError(f"const {CONST_DOWNLOADS_SCREEN_ITEM} type {t}, expected string(1)")
    s_off = cf + v
    cur = bytes(raw[s_off : s_off + 16])
    if cur == CONST_DOWNLOADS_SCREEN:
        return "const 1135 already DownloadsScreen"
    if cur == CONST_CAMERA_MENU or cur.startswith(b"CameraMenu\x00"):
        raw[s_off : s_off + 16] = CONST_DOWNLOADS_SCREEN
        return "const 1135 CameraMenu→DownloadsScreen (fix black screen)"
    # Leave other customizations alone.
    return f"skip const 1135 (got {cur!r})"


def apply_const_patch(raw: bytearray, uix: int) -> str:
    item = uix + UIX_CONST_ITEM_BASE + UIX_CONST_ITEM * 8
    t, v = struct.unpack_from(">II", raw, item)
    if t != 8:
        raise ValueError(f"const {UIX_CONST_ITEM} type {t}, expected Lookup(8)")
    if v == 9:
        return "const 1276 already Array"
    if v != 23:
        return f"skip const 1276 (lookup {v})"
    struct.pack_into(">I", raw, item + 4, 9)
    return "const 1276 Video→Array (keep Graphics row)"


def patch_str_file(path: Path) -> list[str]:
    data = bytearray(path.read_bytes())
    chunks = list(iter_chunks(data))
    notes: list[str] = []
    changed = False
    for chunk in chunks:
        try:
            raw = bytearray(decompress(chunk["blob"]))
        except Exception:
            continue
        uix = find_options_uix(raw)
        if uix is None:
            continue
        apt_off = raw.find(b"Apt Data:74", uix)
        if apt_off < 0:
            continue
        apt = bytearray(raw[apt_off : apt_off + APT_SIZE])
        notes.extend(f"{path.name}: {n}" for n in apply_apt_patches(apt))
        raw[apt_off : apt_off + APT_SIZE] = apt
        notes.append(f"{path.name}: {restore_downloads_screen_name(raw, uix)}")
        notes.append(f"{path.name}: {apply_const_patch(raw, uix)}")
        new_blob = compress(bytes(raw))
        chunk["sz"] = len(raw)
        chunk["xs"] = len(new_blob)
        chunk["blob"] = new_blob
        changed = True
        break
    if not changed:
        raise ValueError(f"no options movie found in {path}")

    out = bytearray(data[:0x800])
    for chunk in chunks:
        struct.pack_into(
            ">QIIII",
            out,
            chunk["e"],
            chunk["hh"],
            chunk["sz"],
            chunk["ig"],
            chunk["xs"],
            chunk["dm"],
        )
    for chunk in chunks:
        out.extend(chunk["blob"])
    path.write_bytes(out)
    notes.append(f"{path.name}: wrote {len(out)} bytes")
    return notes


def patch_gamedata(gamedata: Path) -> list[str]:
    targets = [
        find_str(gamedata, "frontend", "frontend.str"),
        find_str(gamedata, "simpsons_chars", "simpsons_chars_global.str"),
    ]
    missing = [
        name
        for name, p in (("frontend.str", targets[0]), ("simpsons_chars_global.str", targets[1]))
        if p is None
    ]
    if missing:
        raise FileNotFoundError("missing " + ", ".join(missing))
    notes: list[str] = []
    for path in targets:
        notes.extend(patch_str_file(path))
    stamp = gamedata / ".tsg_options_ui_patched"
    stamp.write_text(f"{STAMP_VERSION}\n", encoding="utf-8")
    notes.append(f"stamp {stamp.name}")
    return notes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "gamedata",
        type=Path,
        help="Path to extracted gamedata/ folder (contains frontend/, etc.)",
    )
    args = parser.parse_args()
    root = args.gamedata.expanduser().resolve()
    if not root.is_dir():
        print(f"ERROR: not a directory: {root}", file=sys.stderr)
        return 1
    try:
        for line in patch_gamedata(root):
            print(line)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print("OK: Options › GRAPHICS / CAMERA patches applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
