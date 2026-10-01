#!/usr/bin/env python3
"""
The install's rings, from a photograph: Cassini's natural-colour mosaic
across Saturn's rings ("Expanse of Ice", PIA08389, NASA/JPL/Space Science
Institute) read as a radial profile.

The mosaic runs from the inner edge of the faint inner (C) ring, across the
bright (B) ring, the dark division, the outer (A) ring with its gap, to the
thin F ring beyond. Its columns are matched to the rings' real radii by two
edges found in the image (the C ring's inner edge and the A ring's outer
edge) and resampled across RIN..ROUT, the radii world.js draws between.

Colour is the photograph's own, medianed down each column. How much each
ring hides of what is behind it is the rings' known optical depth — thin in
the C ring and the division, all but opaque in the B ring — shaped by the
photograph's ringlets. The colour is stored as the ring's reflectance over
its opacity, so the shader's opacity-weighted light gives back the
photograph where the rings are seen face on.

  pip install numpy pillow
  curl -O https://images-assets.nasa.gov/image/PIA08389/PIA08389~orig.jpg
  python3 tools/rings.py 'PIA08389~orig.jpg' [--out assets/img/install/rings.png] [--n 8192] [--preview p.png]
"""
import argparse
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--out", default="assets/img/install/rings.png")
ap.add_argument("--n", type=int, default=8192)
ap.add_argument("--preview", default=None)
args = ap.parse_args()

RIN, ROUT = 1.24, 2.34                      # world.js
SAT = 60268.0                               # Saturn's equatorial radius, km; the rings' radii in planet radii:
C_IN, B_IN, B_OUT, A_IN, A_OUT, F = 74658 / SAT, 92000 / SAT, 117580 / SAT, 122170 / SAT, 136775 / SAT, 140180 / SAT
ENCKE, ENCKE_W = 133589 / SAT, 325 / SAT

im = np.asarray(Image.open(args.src).convert("RGB"), dtype=float) / 255.0
H, W, _ = im.shape
lin = im[int(H * 0.15):int(H * 0.85)] ** 2.2
rgb = np.median(lin, axis=0)                # W x 3
L = rgb @ np.array([0.2126, 0.7152, 0.0722])

# the two edges: where the C ring begins, and where the A ring ends before the dark gap to the F ring
c0 = int(np.argmax(L > 0.004))
dark = L < 0.005
run = np.convolve(dark.astype(float), np.ones(60), mode="valid")       # a dark stretch 60 columns long, not a narrow gap
c1 = int(W * 0.85) + int(np.argmax(run[int(W * 0.85):] >= 60))
col = lambda r: c0 + (r - C_IN) / (A_OUT - C_IN) * (c1 - c0)
fpk = int(np.argmax(L[int(col(F)) - 60:int(col(F)) + 60])) + int(col(F)) - 60
Ff = C_IN + (fpk - c0) / (c1 - c0) * (A_OUT - C_IN)
print(f"C inner at column {c0}, A outer at {c1}; F ring found at r = {Ff:.4f} (real {F:.4f})")

r = RIN + (np.arange(args.n) + 0.5) / args.n * (ROUT - RIN)
x = np.clip(col(r), 0, W - 1)
samp = np.stack([np.interp(x, np.arange(W), rgb[:, j]) for j in range(3)], axis=1)
Ls = samp @ np.array([0.2126, 0.7152, 0.0722])

def sm(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# the rings' optical depth, region by region, shaped by the photograph's ringlets
tau = np.zeros_like(r)
regions = [(C_IN, B_IN, 0.12), (B_IN, B_OUT, 2.6), (B_OUT, A_IN, 0.12), (A_IN, A_OUT, 0.6)]
for a, b, t0 in regions:
    m = (r >= a) & (r < b)
    med = np.median(Ls[m]) + 1e-6
    tau[m] = t0 * np.clip(Ls[m] / med, 0, 6) ** 1.3
tau *= sm(C_IN, C_IN + 0.004, r)
tau[np.abs(r - ENCKE) < ENCKE_W / 2] = 0.01
fm = np.abs(r - Ff) < 0.004
tau[fm] = 0.9 * np.clip(Ls[fm] / (Ls[fm].max() + 1e-6), 0, 1)
tau[(r > A_OUT) & ~fm] = 0
alpha = 1 - np.exp(-tau)

# colour: the photograph's, as reflectance over opacity, a little less green and a little warmer, to sit by the violet and the gold
# the mosaic's panels were exposed differently: each ring is set to its real brightness (I/F seen lit, face on),
# the photograph keeping only the ringlets within it — so the B ring is the brightest, as it is
TARGET = [(C_IN, B_IN, 0.13), (B_IN, B_OUT, 0.56), (B_OUT, A_IN, 0.10), (A_IN, A_OUT, 0.40)]
refl = samp.copy()
for a, b, lvl in TARGET:
    m = (r >= a) & (r < b)
    med = np.median(Ls[m]) + 1e-6
    shape = np.minimum(np.clip(Ls[m] / med, 0, 4) ** 0.8, 1.55)   # the ringlets, a little gentler than the stretched mosaic
    chroma = samp[m] / (Ls[m][:, None] + 1e-6)
    refl[m] = chroma * (lvl * shape)[:, None]
fm2 = np.abs(r - Ff) < 0.004
refl[fm2] = samp[fm2] / (Ls[fm2].max() + 1e-6) * 0.5
refl[(r > A_OUT) & ~fm2] = 0
col_ = refl / np.maximum(alpha, 0.06)[:, None]
lum = col_ @ np.array([0.2126, 0.7152, 0.0722])
col_ = (lum[:, None] + (col_ - lum[:, None]) * 0.75) * np.array([1.0, 0.95, 0.88])
col_ = np.clip(col_, 0, 1)
col_[alpha < 0.002] = col_[alpha >= 0.002].mean(axis=0)

out = np.zeros((1, args.n, 4), dtype=np.uint8)
out[0, :, :3] = (np.clip(col_, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
out[0, :, 3] = (alpha * 255 + 0.5).astype(np.uint8)
Image.fromarray(out, "RGBA").save(args.out, optimize=True)
print("wrote", args.out)

if args.preview:
    face = np.clip(col_ * alpha[:, None], 0, 1) ** (1 / 2.2)
    strip = np.repeat((face * 255).astype(np.uint8)[None], 160, axis=0)
    a8 = np.repeat((alpha * 255).astype(np.uint8)[None], 60, axis=0)
    prev = np.concatenate([strip, np.dstack([a8] * 3)], axis=0)
    Image.fromarray(prev).resize((2000, 220), Image.LANCZOS).save(args.preview)
