"""Assemble desktop/src-tauri/icons/icon.ico from the per-size PNGs rendered
by gen-icons.mjs (small entries are 32-bit BGRA DIBs, 256 uses PNG)."""

import io
import os
import struct
import sys

from PIL import Image

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
ICONS_DIR = os.path.normpath(
    os.path.join(SCRIPTS, "..", "..", "..", "..", "desktop", "src-tauri", "icons")
)
SIZES = [16, 24, 32, 48, 64, 128, 256]


def dib_rgba(img):
    """32-bit BGRA bottom-up DIB with the doubled height for the AND mask."""
    w, h = img.size
    pixels = list(img.convert("RGBA").getdata())
    raw = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray()
        for x in range(w):
            r, g, b, a = pixels[y * w + x]
            row += bytes((b, g, r, a))
        row += b"\x00" * ((4 - len(row) % 4) % 4)
        raw += row
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(raw), 0, 0, 0, 0)
    return header + bytes(raw)


def main():
    entries = []
    blobs = []
    for size in SIZES:
        img = Image.open(os.path.join(ICONS_DIR, f".icon-{size}.png")).convert("RGBA")
        if size >= 256:
            buf = io.BytesIO()
            img.save(buf, "PNG")
            data = buf.getvalue()
            bitcount = 0
        else:
            data = dib_rgba(img)
            bitcount = 32
        blobs.append(data)
        w = 0 if size == 256 else size
        entries.append(struct.pack("<BBBBHHII", w, w, 0, 0, 1, bitcount, len(data), 0))

    offset = 6 + 16 * len(entries)
    out = bytearray(struct.pack("<HHH", 0, 1, len(entries)))
    for entry, blob in zip(entries, blobs):
        entry = bytearray(entry)
        struct.pack_into("<I", entry, 12, offset)
        out += entry
        offset += len(blob)
    for blob in blobs:
        out += blob

    with open(os.path.join(ICONS_DIR, "icon.ico"), "wb") as f:
        f.write(out)
    print(f"wrote icon.ico ({len(SIZES)} vector-rendered entries)")


if __name__ == "__main__":
    sys.exit(main())
