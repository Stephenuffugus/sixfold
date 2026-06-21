#!/usr/bin/env python3
"""High-quality white-background cutout for watercolor sprite sheets.

The art is rendered on a flat white background with soft, smoky, translucent
edges (ink wisps, dust, snow). A binary key shreds those edges, so instead we:
  1. SOFT luminance matte: alpha rises with "ink" (darkness OR saturation), so
     pure white -> 0, faint smoke -> partial, solid figure -> 1. Soft edges survive.
  2. BORDER FLOOD: force the white region that touches the frame fully transparent
     (kills stray speckle / vignette without eating interior light areas).
  3. HOLE FILL: enclosed light areas surrounded by the figure (bone, white robe)
     are made opaque so the character isn't hollowed out.
  4. DESPECKLE: drop tiny stray alpha islands left in the background.
  5. WHITE UN-PREMULTIPLY: recover the true ink colour on partial-alpha pixels so
     edges composite cleanly on the dark battlefield (no white halo).

Usage:
  python3 tools/cutout.py <in.png> <out.png>
      [--lo N] [--hi N]        soft-ramp ink thresholds (default 10 / 60)
      [--bgmin N] [--bgsat N]  border-flood "is white" test (default 242 / 12)
      [--speck N]              max stray-island area to drop (default 40 px)
      [--nopremul]             skip un-premultiply (keep original RGB)
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

args = sys.argv[1:]
if len(args) < 2:
    sys.exit("usage: cutout.py in.png out.png [--lo N --hi N --bgmin N --bgsat N --speck N --nopremul]")
src, dst = args[0], args[1]
def opt(name, d):
    return float(args[args.index(name) + 1]) if name in args else d
LO     = opt("--lo", 10)
HI     = opt("--hi", 60)
BGMIN  = opt("--bgmin", 242)
BGSAT  = opt("--bgsat", 12)
SPECK  = opt("--speck", 40)
PREMUL = "--nopremul" not in args

im = Image.open(src).convert("RGB")
C = np.asarray(im).astype(np.float32)
r, g, b = C[..., 0], C[..., 1], C[..., 2]
mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
sat = mx - mn

# 1) soft matte: high for dark OR colourful pixels, ~0 for white
ink = np.maximum(255.0 - mn, sat)
alpha = np.clip((ink - LO) / (HI - LO), 0.0, 1.0)

# 2) border-connected white -> hard transparent
bgseed = (mn >= BGMIN) & (sat <= BGSAT)
lbl, n = ndimage.label(bgseed)
border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
border.discard(0)
bg = np.isin(lbl, list(border))
alpha[bg] = 0.0

# 3) fill enclosed interior holes (bone / pale robe surrounded by the figure)
solid = ndimage.binary_fill_holes(alpha > 0.35)
holes = solid & (alpha < 0.35)
alpha[holes] = 1.0

# 4) despeckle tiny stray islands in the background
m = alpha > 0.06
lbl2, n2 = ndimage.label(m)
if n2:
    sizes = ndimage.sum(np.ones_like(lbl2, dtype=np.float32), lbl2, range(1, n2 + 1))
    small = np.where(sizes < SPECK)[0] + 1
    if small.size:
        alpha[np.isin(lbl2, small)] = 0.0

# 5) un-premultiply white so partial-alpha edges show true ink on a dark bg
if PREMUL:
    a = alpha[..., None]
    eps = 0.02
    F = np.where(a > eps, (C - (1.0 - a) * 255.0) / np.maximum(a, eps), C)
    F = np.clip(F, 0, 255)
else:
    F = C

out = np.dstack([F, alpha * 255.0]).astype(np.uint8)
Image.fromarray(out, "RGBA").save(dst)
print(f"wrote {dst}  ({im.size[0]}x{im.size[1]})  opaque: {(alpha>0.5).mean()*100:.1f}%  soft-edge: {((alpha>0.06)&(alpha<0.94)).mean()*100:.2f}%")
