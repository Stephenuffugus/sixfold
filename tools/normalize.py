#!/usr/bin/env python3
"""SIXFOLD fighter scale/footing normalization (bakes into the atlas).
Computes ONE affine from the idle frame (uniform scale toward a target height +
baseline + horizontal centre), applies the SAME affine to ALL 6 frames so relative
pose motion is preserved. Clamped so intentional size differences aren't erased.
Usage: tools/normalize.py in.png out.png"""
import sys, numpy as np
from PIL import Image

TARGET_H=0.88      # content height as fraction of cell
TARGET_BASE=0.975  # content bottom sits here (fraction down the cell)
S_MIN,S_MAX=0.85,1.30
W_CAP=0.94         # content width must stay within this fraction of cell

def idle_metrics(arr, cw, ch):
    cell=arr[0:ch,0:cw,3]
    ys,xs=np.where(cell>30)
    top,bot=ys.min(),ys.max(); left,right=xs.min(),xs.max()
    return top,bot,left,right

def affine_cell(cell_img, s, dx, dy, cw, ch):
    # scale about bottom-centre (cw/2, ch), then translate (dx,dy)
    sc=cell_img.resize((max(1,int(round(cw*s))), max(1,int(round(ch*s)))), Image.LANCZOS)
    canvas=Image.new("RGBA",(cw,ch),(0,0,0,0))
    px=int(round(cw/2 - sc.width/2 + dx))
    py=int(round(ch - sc.height + dy))
    canvas.alpha_composite(sc,(px,py))
    return canvas

def process(path, cols=3, rows=2):
    im=Image.open(path).convert("RGBA"); arr=np.asarray(im); H,W=arr.shape[:2]
    cw,ch=W//cols,H//rows
    top,bot,left,right=idle_metrics(arr,cw,ch)
    h=bot-top; w=right-left
    s=(TARGET_H*ch)/max(1,h)
    s=min(s, (W_CAP*cw)/max(1,w))           # don't exceed width
    s=max(S_MIN,min(S_MAX,s))
    cx=(left+right)/2.0
    dx=-s*(cx-cw/2.0)                        # centre idle horizontally
    # after scaling about bottom-centre, idle bottom maps to ch - s*(ch-bot); shift to target
    new_bot=ch - s*(ch-bot)
    dy=TARGET_BASE*ch - new_bot
    out=Image.new("RGBA",(W,H),(0,0,0,0))
    for r in range(rows):
        for c in range(cols):
            cell=im.crop((c*cw,r*ch,c*cw+cw,r*ch+ch))
            out.alpha_composite(affine_cell(cell,s,dx,dy,cw,ch),(c*cw,r*ch))
    return out, s

if __name__=="__main__":
    out,s=process(sys.argv[1]); out.save(sys.argv[2]); print(f"{sys.argv[1]}: scale={s:.2f}")
