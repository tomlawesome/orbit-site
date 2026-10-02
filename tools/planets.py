#!/usr/bin/env python3
"""
The door's planets, rendered once, here, into pictures.

Each of the dawn's bodies is a small world of its own, made from the same
maps as the worlds they open onto: the install's purple giant with its rings
(assets/img/install/planet.webp, rings.png), the information's coral giant
(the same map, graded as main.js grades it), the docs' ice moon (moon.webp,
turned to ice), and the gold planet on the ring (the giant's map in gold).

They hang in the sky above the sunrise, so the light comes from below and a
little from behind: a wide crescent along the lower limb, the atmosphere
bright where the sun shines through it, and the night side dark against the
stars. The page turns each picture as its planet travels so the lit side
always faces the sun (pads.js), so the light is baked straight down here.

  python3 tools/planets.py   → assets/img/door/planet-{install,info,docs,gold}.webp
"""
import numpy as np
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/img/install"
OUT = ROOT / "assets/img/door"

S = 288            # the picture's side, px
RP = 56            # the planet's radius in it, px (the page sizes the picture at S / (2 RP) times the body)
SS = 3             # supersampling
RIN, ROUT = 1.24, 2.34

L = np.array([0.0, 0.88, -0.28]); L /= np.linalg.norm(L)   # to the sun: below (y is down), a little behind


def load(name, size=None):
    im = Image.open(SRC / name)
    if size: im = im.resize(size, Image.LANCZOS)
    a = np.asarray(im.convert("RGBA"), dtype=np.float32) / 255.0
    return a


def srgb_to_lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lin_to_srgb(c): return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)


def sample(tex, u, v):
    """bilinear, u wraps, v clamps"""
    h, w = tex.shape[:2]
    x = (u % 1.0) * w - 0.5; y = np.clip(v, 0, 1) * h - 0.5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    x1 = (x0 + 1) % w; x0 %= w; y1 = np.clip(y0 + 1, 0, h - 1); y0 = np.clip(y0, 0, h - 1)
    return (tex[y0, x0] * (1 - fx) + tex[y0, x1] * fx) * (1 - fy) + (tex[y1, x0] * (1 - fx) + tex[y1, x1] * fx) * fy


def rot(tz, tx):
    cz, sz, cx, sx = np.cos(tz), np.sin(tz), np.cos(tx), np.sin(tx)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    return Rz @ Rx


def grade(alb, g0, g1, g2, k):
    l = np.clip((alb @ np.array([0.2126, 0.7152, 0.0722])) * 1.6, 0, 1) ** 0.9
    l = l[..., None]
    gr = np.where(l < 0.5, g0 + (g1 - g0) * (l * 2), g1 + (g2 - g1) * (l * 2 - 1))
    return alb + (gr - alb) * k


def render(name, tex, look):
    n = S * SS
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    x = ((xs + 0.5) / SS - S / 2) / RP; y = ((ys + 0.5) / SS - S / 2) / RP
    d2 = x * x + y * y; d = np.sqrt(d2)
    hit = d2 < 1.0
    z = np.sqrt(np.maximum(0.0, 1.0 - d2))
    N = np.stack([x, y, z], -1)
    M = rot(look["tiltZ"], look["tiltX"])            # planet frame → view
    P = N @ M                                        # view → planet frame (M orthonormal: v @ M = M^T v)
    lat = np.arcsin(np.clip(-P[..., 1], -1, 1)); lon = np.arctan2(P[..., 0], P[..., 2]) + look["lon"]
    u = lon / (2 * np.pi) + 0.5; v = 0.5 - lat / np.pi
    alb = srgb_to_lin(sample(tex, u, v)[..., :3])
    if "grade" in look: alb = grade(alb, *[np.array(g) for g in look["grade"][:3]], look["grade"][3])
    alb = alb * look.get("albK", 1.0)

    ndl = N @ L
    mu = z
    # a soft terminator: light carried a little round the limb by the haze
    day = np.clip((ndl + 0.06) / 1.06, 0, 1) ** 1.15
    limb = mu ** look.get("limbK", 0.3)
    col = alb * day[..., None] * limb[..., None] * 3.2
    # the night side: the faintest skyglow, so the disc reads against the stars
    col += alb * 0.0035 + np.array([0.0015, 0.0018, 0.003])
    # the haze along the lit limb, inside the disc
    haze = np.array(look["haze"])
    rim_in = (1 - mu) ** 3 * np.clip(ndl + 0.25, 0, 1)
    col += haze * rim_in[..., None] * 1.4

    # the rings: in the equator's plane; the planet's shadow on them, theirs on it
    ring_front = np.zeros((n, n, 4), np.float32); ring_back = np.zeros((n, n, 4), np.float32)
    if look.get("rings"):
        prof = np.asarray(Image.open(SRC / "rings.png").convert("RGBA"), np.float32)[0] / 255.0
        A = M @ np.array([0.0, -1.0, 0.0])           # the pole, in view space
        zr = -(x * A[0] + y * A[1]) / A[2]
        R = np.stack([x, y, zr], -1); rr = np.linalg.norm(R, axis=-1)
        inr = (rr > RIN) & (rr < ROUT)
        idx = np.clip(((rr - RIN) / (ROUT - RIN) * (len(prof) - 1)).astype(int), 0, len(prof) - 1)
        pr = prof[idx]; ra = pr[..., 3] * inr * 0.8
        rc = srgb_to_lin(pr[..., :3]) * np.array(look.get("ringTint", [1, 1, 1]))
        # lit face or the light through it
        lit = abs(A @ L); same = np.sign(A @ L) == np.sign(A[2])
        rl = (lit * 1.1 if same else 0.12 + (1 - ra) * 0.9) + 0.02
        # the planet's shadow on the ring
        along = R @ L; perp = np.linalg.norm(R - along[..., None] * L, axis=-1)
        shadow = (along < 0) & (perp < 1.0)
        rl = rl * np.where(shadow, 0.04, 1.0)
        rcol = rc * rl[..., None]
        front = inr & ((~hit) | (zr > z))
        layer = np.concatenate([rcol * ra[..., None], ra[..., None]], -1)
        ring_front = np.where(front[..., None], layer, 0)
        ring_back = np.where((inr & ~front)[..., None], layer, 0)
        # the rings' shadow on the planet
        Ps = N
        t = -(Ps @ A) / (L @ A)
        Q = Ps + t[..., None] * L; qr = np.linalg.norm(Q, axis=-1)
        qi = np.clip(((qr - RIN) / (ROUT - RIN) * (len(prof) - 1)).astype(int), 0, len(prof) - 1)
        rsh = np.where((t > 0) & (qr > RIN) & (qr < ROUT), prof[qi][..., 3] * 0.8, 0)
        col *= (1 - rsh)[..., None]

    # the atmosphere beyond the limb: thin all round, bright where the sun comes through it
    L2 = np.array([L[0], L[1]]); L2 /= np.linalg.norm(L2)
    cosa = (x * L2[0] + y * L2[1]) / np.maximum(d, 1e-6)
    fwd = np.clip(cosa, 0, 1) ** 3
    h = np.maximum(d - 1.0, 0)
    glow = (np.exp(-h / look.get("atmH", 0.045)) * (0.10 + 2.4 * fwd) + np.exp(-h / 0.35) * (0.02 + 0.25 * fwd)) * (~hit)
    gcol = haze * glow[..., None]

    # compose: rings behind, the planet, rings in front; light beyond the disc as added light
    rgb = np.zeros((n, n, 3), np.float32); a = np.zeros((n, n), np.float32)
    rgb += ring_back[..., :3]; a = np.maximum(a, ring_back[..., 3])
    rgb = np.where(hit[..., None], col, rgb + gcol); a = np.where(hit, 1.0, a)
    rgb = rgb * (1 - ring_front[..., 3:]) + ring_front[..., :3]; a = a + (1 - a) * ring_front[..., 3]
    # the film: the same shoulder as the worlds'
    rgb = 1 - np.exp(-rgb * 1.6)
    # light where nothing is opaque is carried as alpha, so it adds over the sky
    lum = rgb.max(-1)
    a_out = np.maximum(a, np.clip(lum, 0, 1))
    rgb = rgb / np.maximum(a_out[..., None], 1e-4)
    out = np.concatenate([lin_to_srgb(np.clip(rgb, 0, 1)), a_out[..., None]], -1)
    img = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    img = img.resize((S, S), Image.LANCZOS)
    path = OUT / f"planet-{name}.webp"
    img.save(path, "WEBP", quality=88, method=6)
    print("wrote", path.relative_to(ROOT), path.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    giant = load("planet-2k.webp", (1024, 512))
    moon = load("moon.webp")
    LOOKS = {
        "install": (giant, dict(tiltZ=0.38, tiltX=-0.32, lon=0.4, rings=True, haze=[0.55, 0.42, 1.0], ringTint=[0.82, 0.74, 1.0], limbK=0.35)),
        "info": (giant, dict(tiltZ=-0.22, tiltX=0.1, lon=2.1, haze=[1.0, 0.62, 0.5], atmH=0.06,
                             grade=([.09, .018, .012], [.62, .17, .11], [.98, .72, .58], .85))),
        "docs": (moon, dict(tiltZ=0.1, tiltX=0.0, lon=-0.6, haze=[0.55, 0.75, 1.0], atmH=0.025, limbK=0.1,
                            grade=([.03, .05, .09], [.42, .56, .74], [.86, .94, 1.0], .9), albK=1.05)),
        "gold": (giant, dict(tiltZ=0.2, tiltX=-0.15, lon=4.0, haze=[1.0, 0.8, 0.45], atmH=0.05,
                             grade=([.06, .035, .008], [.7, .44, .1], [1.0, .86, .5], .92))),
    }
    for name, (tex, look) in LOOKS.items():
        render(name, tex, look)
