#!/usr/bin/env python3
"""Pack a cut RGBA sprite sheet into the game's 3x2 atlas (768x512, square cells).

Slices the source by its 3x2 grid and rescales each WHOLE cell (uniform per
sheet, so the 6 frames stay perfectly consistent) to fit a 256x256 cell while
PRESERVING aspect — which de-distorts the 4:3 source sheets. Cells are centred
horizontally and bottom-aligned (feet toward the baseline). Soft alpha is kept
intact (no quantize), so the meticulous watercolor edges survive.

Usage: python3 tools/pack_atlas.py in.png out.png
"""
import sys, os
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
COLS, ROWS, CW, CH = 3, 2, 256, 256

im = Image.open(src).convert("RGBA")
W, H = im.size
cw, ch = W / COLS, H / ROWS
atlas = Image.new("RGBA", (COLS * CW, ROWS * CH), (0, 0, 0, 0))
for r in range(ROWS):
    for c in range(COLS):
        cell = im.crop((round(c * cw), round(r * ch), round((c + 1) * cw), round((r + 1) * ch)))
        s = min(CW / cell.width, CH / cell.height)
        nw, nh = max(1, round(cell.width * s)), max(1, round(cell.height * s))
        cell = cell.resize((nw, nh), Image.LANCZOS)
        px = c * CW + (CW - nw) // 2     # centre horizontally
        py = r * CH + (CH - nh)          # bottom-align (feet to baseline)
        atlas.alpha_composite(cell, (px, py))

# Clean the RGB under (near-)transparent pixels: invisible, but it turns the big
# transparent regions into a flat colour so PNG compresses them away. Big win,
# zero visible change. (Keeps full soft alpha — we never quantize it.)
import numpy as np
arr = np.asarray(atlas).copy()
arr[arr[..., 3] < 8, :3] = 0
atlas = Image.fromarray(arr, "RGBA")

atlas.save(dst, optimize=True)
kb = os.path.getsize(dst) / 1024
# Keep full 768x512 resolution + soft alpha (no quantize) for consistency; the
# few dense smoky sheets land slightly over 500 KB and that's fine (lazy-cached).
print(f"{os.path.basename(dst):22s} {atlas.size}  {kb:.0f} KB")
