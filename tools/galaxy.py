#!/usr/bin/env python3
"""
The install's sky: the Milky Way as Gaia saw it — NASA's Deep Star Maps 2020
(credit NASA/Goddard Space Flight Center Scientific Visualization Studio;
Gaia DR2: ESA/Gaia/DPAC), in galactic coordinates, the band along the
equator and the galactic centre in the middle.

The HDR panorama is brought down to an sRGB texture: the faint even glow of
unresolved stars taken off, so the sky away from the band is black, and the
rest set so the core is bright without clipping. world.js turns it into
place with its sky matrix and lays its own fine stars over it.

  pip install numpy pillow OpenEXR
  curl -O https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k_gal.exr
  python3 tools/galaxy.py milkyway_2020_8k_gal.exr [--out assets/img/install/galaxy.webp] [--w 4096]
  (writes galaxy.webp and, half the size for phones, galaxy-2k.webp)
"""
import argparse
import numpy as np
import OpenEXR
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--out", default="assets/img/install/galaxy.webp")
ap.add_argument("--w", type=int, default=4096)
args = ap.parse_args()

px = OpenEXR.File(args.src).channels()["RGB"].pixels.astype(np.float32)
L = px.mean(axis=2)
floor = np.percentile(L, 45)                 # the even glow of stars too faint to see one by one
top = np.percentile(L, 99.85)
v = np.clip((px - floor) / (top - floor), 0, None)
v = v / (1 + v * 0.35)                       # a soft shoulder, so the core keeps its shape
v = np.clip(v / (1 / 1.35), 0, 1)
img = Image.fromarray((v ** (1 / 2.2) * 255 + 0.5).astype(np.uint8), "RGB")
from PIL import ImageFilter
img = img.resize((args.w, args.w // 2), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.9))   # the grain of faint stars, which world.js draws itself
img.save(args.out, "WEBP", quality=80, method=6)
img.resize((args.w // 2, args.w // 4), Image.LANCZOS).save(args.out.replace(".webp", "-2k.webp"), "WEBP", quality=80, method=6)
print("wrote", args.out)
