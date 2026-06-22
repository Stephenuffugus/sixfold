#!/usr/bin/env python3
"""Conservative atlas cleanup for SIXFOLD skins:
   1) de-fringe: zero the faintest halo (A<16); soften faint near-white haze.
   2) strip small ISOLATED near-white components (baked-in text labels / specks
      left by the source sheet) — never touches the large character blobs or
      legit white robes (those are big components).
   Safe by construction: only small near-white connected blobs are removed.
   Usage: tools/cleanskin.py in.png out.png [area_max]"""
import sys, numpy as np
from PIL import Image
from collections import deque

def clean(arr, area_max=360):
    a=arr.copy()
    A=a[...,3].astype(int); R,G,B=a[...,0].astype(int),a[...,1].astype(int),a[...,2].astype(int)
    mn=np.minimum(np.minimum(R,G),B); mx=np.maximum(np.maximum(R,G),B)
    near_white=(mn>=200)&(mx-mn<=26)
    # de-fringe
    A[A<16]=0
    soft=(A>=16)&(A<54)&near_white; A[soft]=(A[soft]*0.45).astype(int)
    # strip small isolated near-white components (opaque)
    opaque_white=(A>40)&near_white
    h,w=A.shape; seen=np.zeros((h,w),bool); removed=0; comps=0
    ys,xs=np.where(opaque_white)
    for sy,sx in zip(ys,xs):
        if seen[sy,sx]: continue
        q=deque([(sy,sx)]); seen[sy,sx]=True; px=[(sy,sx)]
        while q:
            y,x=q.popleft()
            for dy,dx in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                ny,nx=y+dy,x+dx
                if 0<=ny<h and 0<=nx<w and opaque_white[ny,nx] and not seen[ny,nx]:
                    seen[ny,nx]=True; q.append((ny,nx)); px.append((ny,nx))
        if len(px)<=area_max:           # small floating near-white blob -> artifact
            for (y,x) in px: A[y,x]=0
            removed+=len(px); comps+=1
    a[...,3]=np.clip(A,0,255).astype(np.uint8)
    # zero RGB under fully-transparent px (keeps later quantize clean)
    tp=a[...,3]==0; a[tp,0]=a[tp,1]=a[tp,2]=0
    return a, removed, comps

if __name__=="__main__":
    inp,outp=sys.argv[1],sys.argv[2]
    amax=int(sys.argv[3]) if len(sys.argv)>3 else 360
    im=Image.open(inp).convert("RGBA")
    out,removed,comps=clean(np.asarray(im),amax)
    Image.fromarray(out,"RGBA").save(outp)
    print(f"{inp}: stripped {comps} small white blobs ({removed}px)")

def near_white_frac(arr):
    A=arr[...,3].astype(int); R,G,B=arr[...,0].astype(int),arr[...,1].astype(int),arr[...,2].astype(int)
    mn=np.minimum(np.minimum(R,G),B); mx=np.maximum(np.maximum(R,G),B)
    nw=(mn>=200)&(mx-mn<=26)&(A>40)
    op=(A>40)
    return nw.sum()/max(1,op.sum())
