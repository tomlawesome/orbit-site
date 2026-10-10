#!/usr/bin/env python3
"""
The install's gold moon, from the Moon itself: NASA's CGI Moon Kit (the LRO
camera's natural-colour mosaic and the LOLA elevation map; credit NASA's
Scientific Visualization Studio), graded to Orbit's gold.

Writes assets/door/img/flight/moon.webp: RGB the graded surface, alpha the
elevation, for world.js to light the craters with.

  pip install numpy pillow
  base=https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720
  curl -O $base/lroc_color_poles_2k.tif -O $base/ldem_4_uint.tif
  python3 tools/moon.py lroc_color_poles_2k.tif ldem_4_uint.tif [--out assets/door/img/flight/moon.webp]
"""
import argparse
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("colour")
ap.add_argument("elevation")
ap.add_argument("--out", default="assets/door/img/flight/moon.webp")
ap.add_argument("--w", type=int, default=1024)
args = ap.parse_args()

W, H = args.w, args.w // 2
c = np.asarray(Image.open(args.colour).convert("RGB").resize((W, H), Image.LANCZOS), dtype=float) / 255.0
lin = c ** 2.2
L = lin @ np.array([0.2126, 0.7152, 0.0722])
L = np.clip((L - np.percentile(L, 0.5)) / (np.percentile(L, 99.7) - np.percentile(L, 0.5)), 0, 1)

def srgb(r, g, b): return (np.array([r, g, b], dtype=float) / 255.0) ** 2.2
stops = [(0.0, srgb(58, 42, 26)), (0.45, srgb(150, 116, 68)), (0.75, srgb(206, 172, 112)), (1.0, srgb(240, 222, 182))]
gold = np.zeros((H, W, 3))
for (a, ca), (b, cb) in zip(stops[:-1], stops[1:]):
    m = (L >= a) & (L <= b); t = ((L - a) / (b - a))[m][..., None]; gold[m] = ca + (cb - ca) * t
# a little of the Moon's own colour: the maria's blue and the highlands' warmth, under the gold
chroma = lin / (lin.mean(axis=2, keepdims=True) + 1e-4)
gold = gold * (0.85 + 0.15 * chroma)

e = np.asarray(Image.open(args.elevation), dtype=float)
e = np.asarray(Image.fromarray(e.astype(np.float32), "F").resize((W, H), Image.BICUBIC))
e = np.clip((e - np.percentile(e, 0.2)) / (np.percentile(e, 99.8) - np.percentile(e, 0.2)), 0, 1)

rgb = (np.clip(gold, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
a = (e * 255 + 0.5).astype(np.uint8)
Image.fromarray(np.dstack([rgb, a]), "RGBA").save(args.out, "WEBP", quality=90, alpha_quality=85, method=6)
print("wrote", args.out)
