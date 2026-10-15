#!/usr/bin/env python3
"""Apply Options › GRAPHICS UI patches to player-extracted game data.

Safe to run more than once. Does not ship any game assets — only rewrites the
player's own frontend.str / simpsons_chars_global.str after ISO extract.

Patches (same-size, inside options Apt Data:74):
  - Relabel Video → Graphics on the Options list
  - Keep the Graphics row (stop RemoveItems from dropping Video)
  - Hide the unused brightness slider / color swatch (alpha 0)
  - Blank leftover Brightness strings on that page
"""

from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refpack import compress, decompress  # noqa: E402

APT_SIZE = 50362
PO_SLIDER = 14884
PO_REF = 14948

# Apt string / placeobject patches relative to "Apt Data:74" start.
APT_PATCHES = [
    # list label "-Video-" → "-Graphics-" (pad)
    (4853, b"Video-\x00$FE_Video", b"Graphics-\x00\x00\x00\x00\x00\x00\x00"),
    # edittext "Video" → "Graphics"
    (5636, b"Video\x00\x00\x00$FE_Video", b"Graphics\x00\x00\x00\x00\x00\x00\x00\x00\x00"),
    # blank Brightness seed / key (page body is host UI now)
    (5664, b"Brightness", b"\x00" * 10),
    (5676, b"$FE_Brightness", b"\x00" * 14),
]

# UIX-relative const pool: item 1276 Lookup(Video=23) → Lookup(Array=9)
UIX_CONST_ITEM = 1276
UIX_CONST_OFF = 50416
UIX_CONST_ITEM_BASE = UIX_CONST_OFF + 0x20


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


def options_already_patched(apt: bytes) -> bool:
    return apt[4853:4862] == b"Graphics-"


def apply_apt_patches(apt: bytearray) -> list[str]:
    notes: list[str] = []
    if len(apt) < APT_SIZE:
        raise ValueError(f"options apt too small ({len(apt)})")
    if not apt.startswith(b"Apt Data:74"):
        raise ValueError("bad Apt magic")

    for off, expect, repl in APT_PATCHES:
        cur = bytes(apt[off : off + len(expect)])
        if cur == repl:
            continue
        if cur != expect:
            # Already a different local edit — only hard-fail on the Video labels.
            if expect.startswith(b"Video"):
                raise ValueError(
                    f"unexpected bytes at apt+{off}: got {cur!r}, want {expect!r}"
                )
            notes.append(f"skip apt+{off} (already customized)")
            continue
        apt[off : off + len(repl)] = repl
        notes.append(f"patched apt+{off}")
    if options_already_patched(apt):
        notes.append("Graphics label present")

    # Hide brightness slider + colorref: keep matrices, alpha 0 + HasColorTransform.
    for po, label in ((PO_SLIDER, "slider"), (PO_REF, "colorref")):
        flags = struct.unpack_from(">I", apt, po + 4)[0]
        m00 = struct.unpack_from(">f", apt, po + 16)[0]
        if abs(m00) < 0.05:
            raise ValueError(f"{label} placeobject matrix looks broken (m00={m00})")
        new_flags = flags | 0x08
        struct.pack_into(">I", apt, po + 4, new_flags)
        struct.pack_into(">I", apt, po + 40, 0x00FFFFFF)
        notes.append(f"hid {label} (flags {flags:#x}->{new_flags:#x})")
    return notes


def apply_const_patch(raw: bytearray, uix: int) -> str:
    item = uix + UIX_CONST_ITEM_BASE + UIX_CONST_ITEM * 8
    t, v = struct.unpack_from(">II", raw, item)
    if t != 8:
        raise ValueError(f"const {UIX_CONST_ITEM} type {t}, expected Lookup(8)")
    if v == 9:
        return "const 1276 already Array"
    if v != 23:
        raise ValueError(f"const {UIX_CONST_ITEM} lookup {v}, expected Video(23)")
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
    missing = [name for name, p in (("frontend.str", targets[0]), ("simpsons_chars_global.str", targets[1])) if p is None]
    if missing:
        raise FileNotFoundError("missing " + ", ".join(missing))
    notes: list[str] = []
    for path in targets:
        notes.extend(patch_str_file(path))
    stamp = gamedata / ".tsg_options_ui_patched"
    stamp.write_text("options-ui-v1\n", encoding="utf-8")
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
    print("OK: Options › GRAPHICS patches applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
