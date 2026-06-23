#!/usr/bin/env python3
"""SIXFOLD meticulous art cleanup — remove FLAT PURE-WHITE background that leaked
into the cutout (classic 'white pocket between the legs and the shadow'), per cell,
WITHOUT harming painted character white (robes/feathers/fur are textured + off-white).

Discriminator: source paper background is near-pure (>=243 all channels) AND flat
(low luminance variance over the region). Painted white is shaded/textured -> kept.
Plus a light de-fringe (alpha<16 -> 0). Usage: tools/cutlegs.py in.png out.png"""
import sys, numpy as np
from PIL import Image
from collections import deque

def clean_cell(cell):
    a=cell.astype(int); A=a[...,3]; R,G,B=a[...,0],a[...,1],a[...,2]
    h,w=A.shape; L=(0.299*R+0.587*G+0.114*B)
    pure=(R>=243)&(G>=243)&(B>=243)&(A>60)
    out=a.copy(); seen=np.zeros((h,w),bool); ys,xs=np.where(pure); rm=np.zeros((h,w),bool)
    for sy,sx in zip(ys,xs):
        if seen[sy,sx]:continue
        q=deque([(sy,sx)]);seen[sy,sx]=True;px=[(sy,sx)]
        while q:
            y,x=q.popleft()
            for dy,dx in((1,0),(-1,0),(0,1),(0,-1)):
                ny,nx=y+dy,x+dx
                if 0<=ny<h and 0<=nx<w and pure[ny,nx] and not seen[ny,nx]:seen[ny,nx]=True;q.append((ny,nx));px.append((ny,nx))
        if len(px)<120: continue
        vals=np.array([L[y,x] for (y,x) in px])
        if vals.std()<10 and vals.mean()>=246:
            for (y,x) in px: rm[y,x]=True
    if rm.any():                                  # grow 1px to swallow the AA fringe
        gr=rm.copy(); ys2,xs2=np.where(rm)
        for y,x in zip(ys2,xs2):
            for dy,dx in((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                ny,nx=y+dy,x+dx
                if 0<=ny<h and 0<=nx<w and max(R[ny,nx],G[ny,nx],B[ny,nx])>=225 and min(R[ny,nx],G[ny,nx],B[ny,nx])>=205:
                    gr[ny,nx]=True
        rm=gr
    out[rm,3]=0
    A2=out[...,3]; A2[A2<16]=0; out[...,3]=A2          # de-fringe
    tp=out[...,3]==0; out[tp,0]=out[tp,1]=out[tp,2]=0
    return out.astype(np.uint8), int(rm.sum())

def process(path, cols=3, rows=2):
    im=Image.open(path).convert("RGBA"); arr=np.asarray(im).copy(); H,W=arr.shape[:2]
    cw,ch=W//cols,H//rows; tot=0
    for r in range(rows):
        for c in range(cols):
            y0,x0=r*ch,c*cw
            new,rem=clean_cell(arr[y0:y0+ch,x0:x0+cw]); arr[y0:y0+ch,x0:x0+cw]=new; tot+=rem
    return Image.fromarray(arr,"RGBA"), tot

if __name__=="__main__":
    out,rem=process(sys.argv[1]); out.save(sys.argv[2]); print(f"{sys.argv[1]}: removed {rem}px")
