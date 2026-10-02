#!/usr/bin/env python3
"""
The docs' sky: the Milky Way behind the chart of the constellations.

A stretch of the galactic plane round the core, from the same all-sky map as
the install's sky (assets/img/install/galaxy.webp, ESA/Gaia), laid across the
frame on a diagonal, low and warm, with the dust lanes kept: something to
read the constellations against, never against the words.

  python3 tools/docsky.py   → assets/img/docs/milkyway.webp
"""
import numpy as np
from PIL import Image, ImageFilter
from pathlib import Path
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
W, H = 1920, 1080

src = Image.open(ROOT / "assets/img/install/galaxy.webp").convert("RGB")
sw, sh = src.size
# the core and some way either side of it, the band through the middle
band = src.crop((int(sw * 0.08), int(sh * 0.3), int(sw * 0.92), int(sh * 0.7)))
band = band.resize((2600, int(2600 * band.height / band.width)), Image.LANCZOS)
# the crop fades out above and below the plane, so no edge of it is ever seen
b = np.asarray(band, np.float32) / 255.0
v = np.linspace(-1, 1, b.shape[0])[:, None, None]
b *= np.clip((1 - np.abs(v)) / 0.45, 0, 1) ** 1.5
band = Image.fromarray((b * 255).astype(np.uint8))
# laid on a diagonal, rising to the right
band = band.rotate(-17, resample=Image.BICUBIC, expand=True)
c = Image.new("RGB", (W, H))
c.paste(band, ((W - band.width) // 2, (H - band.height) // 2 + 40))
a = np.asarray(c, np.float32) / 255.0
# to linear, held low; warmed a little; the brightest kept from blooming
lin = a ** 2.2
# the glow of the sky off the plane taken down to black, so only the band itself is left
def blur(x, r):
    return gaussian_filter(x, r)
L0 = lin @ np.array([0.2126, 0.7152, 0.0722])
Lb = np.stack([blur(lin[..., k], 7) for k in range(3)], -1) @ np.array([0.2126, 0.7152, 0.0722])
t = np.clip((Lb - 0.07) / 0.3, 0, 1); mask = t * t * (3 - 2 * t)
lin = (lin * mask[..., None] ** 1.3) ** 1.25 * 2.2
# a broad haze round the band, as the eye sees it
haze = np.stack([blur(lin[..., k], 45) for k in range(3)], -1)
lin = lin * 0.95 + haze * 0.22
lum = lin @ np.array([0.2126, 0.7152, 0.0722])
lin = lin * 0.8 + lum[..., None] * 0.2                     # most of the colour: the dust stays brown, the core warm
lin *= np.array([1.04, 0.98, 0.92])
lin = lin / (1 + lin * 1.6) * 0.34
# kept clear of the middle column, where the words are: dimmer there
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
mid = np.exp(-((xx / W - 0.5) / 0.2) ** 2)
lin *= (1 - 0.55 * mid)[..., None]
# and soft at the frame's edges
edge = np.clip(np.minimum.reduce([xx / (W * 0.12), (W - xx) / (W * 0.12), yy / (H * 0.12), (H - yy) / (H * 0.12)]), 0, 1)
lin *= (0.35 + 0.65 * edge)[..., None]
out = np.clip(lin, 0, 1) ** (1 / 2.2)
img = Image.fromarray((out * 255 + 0.5).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
(ROOT / "assets/img/docs").mkdir(parents=True, exist_ok=True)
p = ROOT / "assets/img/docs/milkyway.webp"
img.save(p, "WEBP", quality=82, method=6)
print("wrote", p.relative_to(ROOT), p.stat().st_size // 1024, "KB")
