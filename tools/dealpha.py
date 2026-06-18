#!/usr/bin/env python3
"""Key a baked-in white/checkerboard background out of a sprite sheet into alpha.

The art tool renders the "transparent" background as actual light pixels (white,
or a light-gray checkerboard) instead of real alpha. We mark light low-saturation
pixels CONNECTED TO THE BORDER (flood fill) as background, so interior highlights
on the character survive. Edges get a soft alpha ramp to kill the fringe.

Two modes:
  default  — tolerant (mn>=200, sat<=22): checkerboard + dark/colored characters.
  light    — tight  (mn>=247, sat<=8):  pale/white-robed characters on pure white,
             where a tolerant key would eat the costume. Pass as a 3rd arg.

Usage: python3 tools/dealpha.py <in.png> <out.png> [light]
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "default"
LIGHT_MIN, SAT_MAX, FRINGE_MIN = (247, 8, 235) if mode == "light" else (200, 22, 200)

im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.int16)
r, g, b = a[..., 0], a[..., 1], a[..., 2]

mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
light = mn >= LIGHT_MIN       # all channels bright
gray = (mx - mn) <= SAT_MAX   # near-neutral (white / checker)
bgcolor = light & gray        # candidate background pixels

# only remove background connected to the border (keeps interior highlights)
lbl, n = ndimage.label(bgcolor)
border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
border.discard(0)
bg = np.isin(lbl, list(border))

alpha = np.where(bg, 0, 255).astype(np.uint8)
# soften the 1px fringe: pixels adjacent to bg that are still lightish get partial alpha
fringe = ndimage.binary_dilation(bg, iterations=1) & ~bg & (mn >= FRINGE_MIN)
alpha[fringe] = 130

out = np.dstack([np.asarray(im), alpha]).astype(np.uint8)
Image.fromarray(out, "RGBA").save(dst)
removed = bg.mean() * 100
print(f"wrote {dst}  ({im.size[0]}x{im.size[1]})  background removed: {removed:.1f}%")
