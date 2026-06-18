#!/usr/bin/env python3
"""Key the baked-in light checkerboard out of a sprite sheet into real alpha.

The art tool rendered a transparency-checkerboard as actual light pixels (white +
light gray) instead of true alpha. Background = light, low-saturation pixels that
are connected to the image border (flood fill), so interior light highlights on
the character are preserved. Edges get a soft alpha ramp to avoid a checker halo.

Usage: python3 tools/dealpha.py <in.png> <out.png>
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.int16)
r, g, b = a[..., 0], a[..., 1], a[..., 2]

mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
light = mn >= 200            # all channels bright
gray = (mx - mn) <= 22       # near-neutral (checker is white/gray)
bgcolor = light & gray       # candidate background pixels

# only remove background connected to the border (keeps interior highlights)
lbl, n = ndimage.label(bgcolor)
border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
border.discard(0)
bg = np.isin(lbl, list(border))

alpha = np.where(bg, 0, 255).astype(np.uint8)
# soften the 1px fringe: pixels adjacent to bg that are still lightish get partial alpha
fringe = ndimage.binary_dilation(bg, iterations=1) & ~bg & light
alpha[fringe] = 120

out = np.dstack([np.asarray(im), alpha]).astype(np.uint8)
Image.fromarray(out, "RGBA").save(dst)
removed = bg.mean() * 100
print(f"wrote {dst}  ({im.size[0]}x{im.size[1]})  background removed: {removed:.1f}%")
