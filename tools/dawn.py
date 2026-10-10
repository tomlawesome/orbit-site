#!/usr/bin/env python3
"""
The door's dawn: the night side of the Earth from low orbit, the sun coming
up over the limb — rendered once, here, into a picture the door lays over
its sky, so the landing page draws it without a GPU.

The camera is set so the Earth's horizon falls exactly on the door's limb:
the circle of radius 3000 about (800, 3920) in the 1600×1000 frame every
door layer shares (and the flight's canvas, engine.js). The frame's plane
faces the Earth's centre and the frame is shifted up off its axis, so the
horizon is a true circle there.

What is drawn:
  - the air: single scattering by molecules (Rayleigh) and haze (Mie), with
    ozone's absorption, lit by a sun just under the horizon, the Earth's own
    shadow included — so the limb comes out layered, red low down, gold, then
    a thin blue, then black, as it is photographed from orbit;
  - the clouds: a slab whose cover is NASA's Blue Marble cloud map, standing
    up from the surface as thick as it is dense, so cloud tops break the
    horizon and catch the first light before the ground does;
  - the cities: NASA's Black Marble (2016), seen through the air and under
    the clouds, which they light from below;
  - the ground: NASA's Blue Marble, lit only by the twilight sky.

Imagery (NASA Earth Observatory; credit NASA):
  https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg (or the 500 m tiles, _C1.jpg …)
  https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud.E.2001210.21600x21600.png (or cloud_combined_2048.jpg)
  https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.C1.jpg

  python3 tools/dawn.py --lights L.jpg --clouds C.png --land G.jpg --out assets/door/img/dawn/dawn.webp
"""
import argparse, json, math, time
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, gaussian_filter

Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser()
ap.add_argument("--lights", required=True)
ap.add_argument("--lights-box", default="-180,180,-90,90", help="lon0,lon1,lat0,lat1 the lights image covers")
ap.add_argument("--clouds", default=None)
ap.add_argument("--clouds-box", default="-180,180,-90,90")
ap.add_argument("--land", default=None)
ap.add_argument("--land-box", default="-180,180,-90,90")
ap.add_argument("--lat", type=float, default=32.0)
ap.add_argument("--lon", type=float, default=10.0)
ap.add_argument("--heading", type=float, default=90.0, help="degrees from north the camera faces")
ap.add_argument("--alt", type=float, default=420.0, help="km")
ap.add_argument("--sun", type=float, default=0.25, help="the sun's centre, degrees under the horizon point it rises at (negative: above)")
ap.add_argument("--sunx", type=float, default=800.0, help="where along the frame the sun rises (frame units)")
ap.add_argument("--scale", type=float, default=1.0, help="pixels per frame unit")
ap.add_argument("--y0", type=float, default=640.0, help="the top of what is drawn, frame units")
ap.add_argument("--x0", type=float, default=0.0)
ap.add_argument("--x1", type=float, default=1600.0)
ap.add_argument("--ss", type=int, default=1, help="supersampling per axis")
ap.add_argument("--expo", type=float, default=0.35)
ap.add_argument("--city", type=float, default=1.0)
ap.add_argument("--moon", type=float, default=1.0, help="how much moonlight shows the night's clouds and land")
ap.add_argument("--airglow", type=float, default=1.0)
ap.add_argument("--out", default="dawn.png")
ap.add_argument("--hdr", default=None, help="also save the linear radiance (.npy)")
args = ap.parse_args()

RE, TOP = 6371.0, 110.0
RA = RE + TOP
D = RE + args.alt
AL = math.asin(RE / D)
F = 3000.0 / math.tan(AL)                     # the focal length that puts the horizon on the door's limb
CX, CY = 800.0, 3920.0

# ── the air ────────────────────────────────────────────────────────────────
BR = np.array([5.802e-3, 13.558e-3, 33.1e-3])          # Rayleigh scattering, /km
HR = 8.0
BM, BMX, HM, G = 3.996e-3, 4.40e-3, 1.2, 0.8            # Mie scattering, extinction, scale height, asymmetry
BO = np.array([0.650e-3, 1.881e-3, 0.085e-3]) * 0.6          # ozone absorption, /km
SUN = np.array([1.0, 0.96, 0.90]) * 20.0                # the sun's light, before the air

def dens(h):
    h = np.maximum(h, 0.0)
    r = np.exp(-h / HR); m = np.exp(-h / HM)
    o = np.maximum(0.0, 1.0 - np.abs(h - 25.0) / 15.0)
    return r, m, o

def ext(r, m, o):
    return r[..., None] * BR + (m * BMX)[..., None] + o[..., None] * BO

# transmittance to the sun from altitude h at elevation e (degrees): a table, fine about the horizon
LUT_H = TOP * np.linspace(0, 1, 160) ** 2
LUT_E = np.concatenate([np.linspace(-12, -2, 60, endpoint=False), np.linspace(-2, 6, 800, endpoint=False), np.linspace(6, 90, 100)])
def build_lut():
    hh, ee = np.meshgrid(LUT_H, LUT_E, indexing="ij")
    r0 = RE + hh; mu = np.sin(np.radians(ee))
    # distance to the top of the air, and whether the ground is in the way
    b = r0 * mu
    c_top = r0 ** 2 - RA ** 2
    t_top = -b + np.sqrt(np.maximum(b * b - c_top, 0))
    disc_g = b * b - (r0 ** 2 - RE ** 2)
    hits = (mu < 0) & (disc_g > 0)
    n = 300
    tau = np.zeros(hh.shape + (3,))
    for i in range(n):
        t = (i + 0.5) / n * t_top
        r = np.sqrt(r0 ** 2 + t * t + 2 * r0 * t * mu)
        tau += ext(*dens(r - RE)) * (t_top / n)[..., None]
    T = np.exp(-tau)
    T[hits] = 0.0
    return T
t0 = time.time()
LUT = build_lut()
print(f"sun table {time.time() - t0:.1f}s")

def lut(h, e):
    """the sun's light reaching altitude h (km) at elevation e (degrees): bilinear in the table"""
    hi = np.interp(h, LUT_H, np.arange(len(LUT_H)))
    ei = np.interp(e, LUT_E, np.arange(len(LUT_E)))
    out = np.empty(h.shape + (3,), np.float32)
    for k in range(3):
        out[..., k] = map_coordinates(LUT[..., k], [hi.ravel(), ei.ravel()], order=1, mode="nearest").reshape(h.shape)
    return out

# ── the maps ───────────────────────────────────────────────────────────────
class Map:
    def __init__(self, path, box, gray=False, blur=0):
        im = Image.open(path)
        im = im.convert("L" if gray else "RGB")
        a = np.asarray(im, dtype=np.float32) / 255.0
        if blur: a = gaussian_filter(a, (blur, blur) + ((0,) if a.ndim == 3 else ()))
        self.a = a
        self.lon0, self.lon1, self.lat0, self.lat1 = [float(v) for v in box.split(",")]
        print(f"{path}: {a.shape}")
    def __call__(self, lat, lon):
        H, W = self.a.shape[:2]
        x = (lon - self.lon0) / (self.lon1 - self.lon0) * W - 0.5
        y = (self.lat1 - lat) / (self.lat1 - self.lat0) * H - 0.5
        if self.a.ndim == 2:
            return map_coordinates(self.a, [y.ravel(), x.ravel()], order=1, mode="nearest").reshape(lat.shape)
        return np.stack([map_coordinates(self.a[..., k], [y.ravel(), x.ravel()], order=1, mode="nearest").reshape(lat.shape) for k in range(3)], -1)

LIGHTS = Map(args.lights, args.lights_box)
CLOUDS = Map(args.clouds, args.clouds_box, gray=True) if args.clouds else None
CLOUDS_SOFT = Map(args.clouds, args.clouds_box, gray=True, blur=10) if args.clouds else None
LAND = Map(args.land, args.land_box) if args.land else None

# ── the camera ─────────────────────────────────────────────────────────────
la, lo, hd = np.radians(args.lat), np.radians(args.lon), np.radians(args.heading)
Z = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
EAST = np.array([-math.sin(lo), math.cos(lo), 0.0])
NORTH = np.cross(Z, EAST)
HEAD = math.cos(hd) * NORTH + math.sin(hd) * EAST
RIGHT = np.cross(HEAD, Z)
CAM = Z * D

def ray(X, Y):
    px, py = X - CX, CY - Y
    d = px[..., None] * RIGHT + py[..., None] * HEAD + F * (-Z)
    return d / np.linalg.norm(d, axis=-1, keepdims=True)

sd = ray(np.array(args.sunx), np.array(CY - 3000.0))     # the horizon point the sun rises at …
# … and the sun that far under it: turned about the axis across the line of sight
ax = np.cross(sd, -Z); ax /= np.linalg.norm(ax)
a = np.radians(args.sun)
S = sd * math.cos(a) + np.cross(ax, sd) * math.sin(a) + ax * np.dot(ax, sd) * (1 - math.cos(a))
S = S / np.linalg.norm(S)

def sphere(o, d, R):
    b = np.einsum("...k,...k", o, d) if o.ndim > 1 else d @ o
    c = o @ o - R * R if o.ndim == 1 else np.einsum("...k,...k", o, o) - R * R
    disc = b * b - c
    s = np.sqrt(np.maximum(disc, 0))
    return -b - s, -b + s, disc > 0

def latlon(p):
    r = np.linalg.norm(p, axis=-1)
    return np.degrees(np.arcsin(p[..., 2] / r)), np.degrees(np.arctan2(p[..., 1], p[..., 0])), r

def hg(c, g):
    return (1 - g * g) / (4 * np.pi * (1 + g * g - 2 * g * c) ** 1.5)

MOON = np.array([0.55, 0.62, 0.78]) * 0.0045 * args.moon   # a quarter moon, high behind the camera
CL0, CL1 = 1.0, 11.0                     # the cloud slab, km
def cloud_density(lat, lon, h):
    if CLOUDS is None: return np.zeros_like(h)
    c = np.clip((CLOUDS(lat, lon) - 0.2) / 0.8, 0, 1)
    # how high the tops stand comes from the cover about them, smoothed, so masses of cloud rise as masses
    cs = np.clip((CLOUDS_SOFT(lat, lon) - 0.2) / 0.8, 0, 1)
    top = CL0 + 0.8 + (CL1 - CL0 - 0.8) * cs ** 1.1 * (0.55 + 0.45 * c) + 1.6 * c ** 2
    edge = np.clip((top - h) / (0.6 + 1.6 * cs), 0, 1)
    inside = edge * edge * (3 - 2 * edge) * np.clip((h - CL0) / 0.6, 0, 1)
    return c * inside * 0.6                                   # extinction, /km

# a soft glow of the city lights, for the undersides of clouds above them
GLOW = None
FOOT = []
def render(X, Y):
    d = ray(X, Y)
    n = d.shape[0]
    o = CAM
    ta0, ta1, hitA = sphere(o, d, RA)
    tg0, _, hitG = sphere(o, d, RE)
    tl0, tl1, hitL = sphere(o, d, RE + 15.0)
    ground = hitG & (tg0 > 0)
    tend = np.where(ground, tg0, ta1)
    L = np.zeros((n, 3)); T = np.ones((n, 3))
    mu_v = d @ S
    pr = 3 / (16 * np.pi) * (1 + mu_v ** 2)
    pm = hg(mu_v, G)
    pc = 0.7 * hg(mu_v, 0.6) + 0.3 * hg(mu_v, -0.2)
    # three stretches: down to the low air, through it (finely), and out again
    lowin = np.where(hitL, np.maximum(tl0, ta0), tend)
    lowout = np.where(hitL, np.where(ground, tg0, tl1), tend)
    segs = [(ta0, lowin, 48), (lowin, lowout, 160), (lowout, tend, 48)]
    for a0, a1, N in segs:
        a0 = np.where(hitA, a0, 0); a1 = np.where(hitA, np.maximum(a1, a0), a0)
        dt = (a1 - a0) / N
        for i in range(N):
            t = a0 + (i + 0.5) * dt
            p = o + t[:, None] * d
            lat, lon, r = latlon(p)
            h = r - RE
            dr, dm, do = dens(h)
            up = p / r[:, None]
            esun = np.degrees(np.arcsin(np.clip(up @ S, -1, 1)))
            Ts = lut(h, esun)
            sig = ext(dr, dm, do)
            cd = cloud_density(lat, lon, h) if CLOUDS is not None else 0
            sig_t = sig + (cd[:, None] if CLOUDS is not None else 0)
            # light scattered toward the camera here: the air's, and the clouds'
            ins = (dr[:, None] * BR * pr[:, None] + (dm * BM * pm)[:, None]) * Ts * SUN
            # the air's own light from the rest of the lit sky: a little of it, blue, where the sun is not far under
            amb = dr[:, None] * BR * np.exp(np.clip(esun, -20, 0)[:, None] / 1.5) * SUN * 0.012
            ins = ins + amb
            # the airglow: oxygen's faint green, a thin shell about 95 km up
            ins = ins + (np.exp(-0.5 * ((h - 95.0) / 2.2) ** 2) * 0.7e-4 * args.airglow)[:, None] * np.array([0.35, 1.0, 0.45])
            if CLOUDS is not None:
                hn = np.clip((h - CL0) / (CL1 - CL0), 0, 1)
                csun = Ts * SUN * (pc * 4 * np.pi * 0.08 + 0.02)[:, None] * (0.35 + 0.65 * hn[:, None])
                csky = np.array([0.22, 0.32, 0.6]) * 2.0 * np.exp(np.clip(esun, -20, 0) / 2.2)[:, None] * 0.25
                cglow = 0
                if GLOW is not None:
                    cglow = GLOW(lat, lon) * 0.6 * (1 - hn[:, None]) ** 2
                cmoon = MOON * (0.5 + 0.5 * hn[:, None])
                ins = ins + cd[:, None] * (csun + csky + cglow + cmoon)
            seg = np.exp(-sig_t * dt[:, None])
            # integrate the in-scattering over the step against its own extinction
            L += T * ins * (1 - seg) / np.maximum(sig_t, 1e-9)
            T *= seg
    # the ground: the cities, and what the twilight sky shows of the land
    if ground.any():
        pg = o + tg0[:, None] * d
        lat, lon, _ = latlon(pg[ground])
        FOOT.append((lat.min(), lat.max(), lon.min(), lon.max()))
        city = LIGHTS(lat, lon) ** 2.2 * 0.9 * args.city
        up = pg[ground] / RE
        esun = np.degrees(np.arcsin(np.clip(up @ S, -1, 1)))
        tw = np.exp(np.clip(esun, -30, 0) / 2.0)[:, None]
        sky = np.array([0.25, 0.35, 0.7]) * 0.35 * tw + np.array([1.0, 0.55, 0.3]) * 0.6 * tw ** 3 + MOON * 4.0
        alb = (LAND(lat, lon) ** 2.2 if LAND is not None else np.full((len(lat), 3), 0.08))
        Lg = city + alb * sky
        L[ground] += T[ground] * Lg
    return L, ground

def tonemap(x):
    # an exponential shoulder: linear in the dark, the bright limb rolled off rather than clipped
    return 1 - np.exp(-np.maximum(x * args.expo, 0))

def main():
    global GLOW
    if CLOUDS is not None:
        g = LIGHTS.a ** 2.2
        GLOW = Map.__new__(Map); GLOW.a = gaussian_filter(g, (6, 6, 0)) * 1.0
        GLOW.lon0, GLOW.lon1, GLOW.lat0, GLOW.lat1 = LIGHTS.lon0, LIGHTS.lon1, LIGHTS.lat0, LIGHTS.lat1
    s, ss = args.scale, args.ss
    W = int(round((args.x1 - args.x0) * s)); H = int(round((1000 - args.y0) * s))
    xs = args.x0 + (np.arange(W * ss) + 0.5) / (s * ss)
    ys = args.y0 + (np.arange(H * ss) + 0.5) / (s * ss)
    # only rows the air reaches need the march; above it, nothing
    out = np.zeros((H * ss, W * ss, 3), np.float32); cov = np.zeros((H * ss, W * ss), np.float32)
    t0 = time.time()
    rows_per = max(1, 60000 // (W * ss))
    for r0 in range(0, H * ss, rows_per):
        yy = ys[r0:r0 + rows_per]
        X, Y = np.meshgrid(xs, yy)
        L, g = render(X.ravel(), Y.ravel())
        out[r0:r0 + len(yy)] = L.reshape(len(yy), W * ss, 3)
        cov[r0:r0 + len(yy)] = g.reshape(len(yy), W * ss)
        print(f"\r{r0 + len(yy)}/{H * ss} rows {time.time() - t0:.0f}s", end="", flush=True)
    print()
    if FOOT: f_ = np.array(FOOT); print(f"ground: lat {f_[:,0].min():.2f}..{f_[:,1].max():.2f}  lon {f_[:,2].min():.2f}..{f_[:,3].max():.2f}")
    if ss > 1:
        out = out.reshape(H, ss, W, ss, 3).mean((1, 3)); cov = cov.reshape(H, ss, W, ss).mean((1, 3))
    if args.hdr: np.save(args.hdr, np.concatenate([out, cov[..., None]], -1))
    c = tonemap(out)
    fade = np.clip((ys[::ss][:H] - args.y0) / 60.0, 0, 1) if ss == 1 else np.clip(((args.y0 + (np.arange(H) + 0.5) / s) - args.y0) / 60.0, 0, 1)
    c = c * (fade * fade * (3 - 2 * fade))[:, None, None]
    # over the door's sky: the Earth is opaque, the air is light laid over what is behind it
    glow = c * (1 - cov[..., None])
    alpha = np.clip(np.maximum(cov, glow.max(-1)), 0, 1)
    col = np.where(alpha[..., None] > 1e-4, c * cov[..., None] / np.maximum(alpha, 1e-4)[..., None] + glow / np.maximum(alpha, 1e-4)[..., None], 0)
    col = np.clip(col, 0, 1)
    rgba = np.concatenate([col ** (1 / 2.2), alpha[..., None]], -1)
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(args.out)
    # and a look at it over black, for review
    prev = np.clip(c, 0, 1) ** (1 / 2.2)
    Image.fromarray((prev * 255 + 0.5).astype(np.uint8), "RGB").save(args.out.rsplit(".", 1)[0] + "_view.png")
    print("wrote", args.out)

main()
