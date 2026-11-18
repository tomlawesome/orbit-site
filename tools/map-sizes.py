#!/usr/bin/env python3
"""
Each flight map's smaller sizes, made ready for the browser (#148), so it never
makes them itself (one generateMipmap a map: a stall that cannot be split).

For every map in MAPS (assets/door/img/), each size half the last, down to the
last one still 512 or more wide, written beside it as <name>-<width>.webp. A
size is exactly the GPU's own level of the full map: floor(w / 2^i) by
floor(h / 2^i), so it goes into that level as it is (voyage.js: FULL and mapSizes,
upload.js: uploadSized). Each channel is resized on its own (the moon's alpha is
its height, not a coverage, so it is not premultiplied). Run again whenever a
full-size map is replaced.

  pip install pillow
  python3 tools/map-sizes.py [--root assets/door/img]
"""
import argparse
import os
from PIL import Image

# the map, and how it is saved (lossy WebP quality; the moon keeps its alpha)
MAPS = {
    "flight/earth-lights.webp": 82,
    "flight/earth-day.webp": 80,
    "flight/earth-clouds.webp": 80,
    "flight/europe-lights.webp": 82,
    "flight/moon.webp": 90,
    "dawn/lights-near.webp": 82,
    "dawn/clouds-near.webp": 72,
    "dawn/land-near.webp": 75,
}
SMALLEST = 512

ap = argparse.ArgumentParser()
ap.add_argument("--root", default="assets/door/img")
args = ap.parse_args()


def shrink(im, size):
    bands = [b.resize(size, Image.LANCZOS) for b in im.split()]
    return Image.merge(im.mode, bands)


for rel, q in MAPS.items():
    src = os.path.join(args.root, rel)
    im = Image.open(src)
    im.load()
    w, h = im.size
    base = src[: -len(".webp")]
    i = 1
    while (w >> i) >= SMALLEST:
        size = (w >> i, h >> i)
        out = f"{base}-{size[0]}.webp"
        small = shrink(im, size)
        if im.mode == "RGBA":
            small.save(out, "WEBP", quality=q, alpha_quality=85, method=6, exact=True)
        else:
            small.convert("RGB").save(out, "WEBP", quality=q, method=6)
        print(f"{out}: {size[0]}x{size[1]}, {os.path.getsize(out)} bytes")
        i += 1
