"""Generate PWA PNG icons without third-party deps."""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).parent


def png(path, w, h, pixels):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(pixels[y]) for y in range(h))
    data = b"\x89PNG\r\n\x1a\n"
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9))
    data += chunk(b"IEND", b"")
    path.write_bytes(data)


def lerp(a, b, t):
    return int(a + (b - a) * t)


def rgb_at(x, y, s):
    nx, ny = x / (s - 1), y / (s - 1)
    cx, cy = 0.5, 0.48
    dx, dy = nx - cx, ny - cy
    r = math.hypot(dx, dy)

    # felt background
    g = 18 + int(10 * math.sin(nx * 40) * math.cos(ny * 36))
    color = (12 + g, 72 + g, 48 + g // 2)

    # rounded square mask via distance to rounded rect
    # inner gold ring / card
    if r < 0.42:
        # cream card
        shade = 8 if (int(nx * 18) + int(ny * 18)) % 2 == 0 else 0
        color = (246 - shade, 236 - shade, 214 - shade)
        # top-left suit-ish diamond
        if abs(dx) + abs(dy + 0.08) < 0.16:
            color = (176, 32, 42)
        # gold crown bar
        if 0.18 < ny < 0.26 and abs(dx) < 0.18:
            color = (212, 168, 64)
        # letter-like verticals for "C" using annulus
        ang = math.atan2(dy - 0.06, dx)
        cr = math.hypot(dx, dy - 0.06)
        if 0.14 < cr < 0.22 and not (-0.55 < ang < 0.55):
            color = (20, 90, 58)

    # outer gold rim
    if 0.44 < r < 0.48:
        color = (212, 168, 64)
    # vignette
    if r > 0.48:
        t = min(1.0, (r - 0.48) / 0.22)
        color = tuple(lerp(c, 8, t) for c in color)
    return color


def make(size, name):
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            row.extend(rgb_at(x, y, size))
        rows.append(row)
    png(OUT / name, size, size, rows)
    print("wrote", name)


if __name__ == "__main__":
    make(192, "icon-192.png")
    make(512, "icon-512.png")
    make(180, "apple-touch-icon.png")
