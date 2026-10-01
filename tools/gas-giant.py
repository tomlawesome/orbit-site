#!/usr/bin/env python3
"""
The install's planet, simulated: the cloud deck of a violet gas giant.

A pseudo-spectral solver for 2D vorticity on a doubly periodic channel
(longitude by latitude). The bands are laid out first, irregular as a real
planet's are, each with its own colour and its own streaks; jets run along
their edges, some strong enough to roll up and some calm; a beta effect keeps
them banded; storms are seeded as vortices — anticyclones in the zones, a few
dark cyclones in the belts, and one great storm — and the bands' own colours
(linear RGB, and the cloud tops' height) are carried by the flow. Their zonal
means are held to the bands, so the eddies fold the edges into the curls and
filaments real cloud decks have without washing the bands out. The winds blow
for a set time: long enough to roll up, not so long that everything boils.

The result is written as the planet's map, equirectangular, north at the top:
  assets/img/install/planet.webp      4096 wide, for screens that can take it
  assets/img/install/planet-2k.webp   2048 wide, for phones

  pip install numpy scipy pillow
  python3 tools/gas-giant.py [--n 2048] [--time 0.3] [--out assets/img/install/planet.webp] [--preview p.png]
"""
import argparse, time
import numpy as np
import scipy.fft as F
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=2048, help="cells round the equator; the grid is n by n/2")
ap.add_argument("--time", type=float, default=0.45, help="how long the winds blow (model time)")
ap.add_argument("--out", default="assets/img/install/planet.webp")
ap.add_argument("--size", type=int, default=4096, help="width of the written map")
ap.add_argument("--preview", default=None)
ap.add_argument("--seed", type=int, default=1729)
ap.add_argument("--beta", type=float, default=150.0)
ap.add_argument("--jet", type=float, default=1.0)
ap.add_argument("--ovals", type=int, default=22)
ap.add_argument("--stir", type=float, default=1.0)
ap.add_argument("--base", default=None, help="a real planet's map to start from (equirectangular); its bands set the jets")
args = ap.parse_args()

W = 4
NX, NY = args.n, args.n // 2
L = 2 * np.pi
x = np.arange(NX) * L / NX
y = np.arange(NY) * L / NX                    # 0..pi: south pole to north pole
lat = y - np.pi / 2
X, Y = np.meshgrid(x, y)
LAT = Y - np.pi / 2
rng = np.random.default_rng(args.seed)

kx = F.rfftfreq(NX, d=L / NX) * 2 * np.pi    # integers
ky = F.fftfreq(NY, d=L / NX) * 2 * np.pi     # even integers
KX, KY = np.meshgrid(kx, ky)
K2 = KX ** 2 + KY ** 2
K2i = np.where(K2 == 0, 0, 1 / np.where(K2 == 0, 1, K2))
kk = np.sqrt(K2) / (NX / 2)
FILTER = np.exp(-36.0 * kk ** 16)            # the spectral filter: keeps the resolved scales, removes the grid's noise
DEAL = (np.abs(KX) < NX / 3) & (np.abs(KY) < NX / 3)

def fwd(a): return F.rfft2(a, workers=W)
def inv(a): return F.irfft2(a, s=(NY, NX), workers=W)
def zonal_mean_hat(a_hat):
    m = np.zeros_like(a_hat); m[:, 0] = a_hat[:, 0]; return m
def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
def srgb(r, g, b): return (np.array([r, g, b], dtype=float) / 255.0) ** 2.2
def noise(mask, amp=1.0):
    """a random field with the spectrum the mask allows"""
    h = rng.standard_normal(mask.shape) + 1j * rng.standard_normal(mask.shape)
    f = inv(h * mask); return f / (f.std() + 1e-9) * amp
k = np.sqrt(K2)
def ring(lo, hi): return ((k >= lo) & (k <= hi)).astype(float)
def streaky(lo, hi, kxmax): return (((np.abs(KY) >= lo) & (np.abs(KY) <= hi)) & (np.abs(KX) <= kxmax)).astype(float)

# THE BANDS: irregular widths, alternating zone and belt, a broad bright zone at the equator
ZONES = [srgb(236, 228, 242), srgb(238, 226, 208), srgb(220, 206, 234), srgb(240, 222, 192), srgb(214, 214, 238), srgb(232, 220, 230)]
BELTS = [srgb(92, 50, 106), srgb(62, 32, 86), srgb(122, 72, 88), srgb(140, 92, 68), srgb(76, 62, 120), srgb(152, 92, 122), srgb(104, 58, 82)]
edges, e = [], -1.42
while e < 1.42:
    edges.append(e); e += 0.045 + 0.16 * rng.random() ** 1.6
edges = [v for v in edges if not -0.13 < v < 0.11] + [-0.13, 0.11]
edges = sorted(edges)
kinds, colours, strengths = [], [], []
# which side of each edge is a zone: the equatorial band (between -0.13 and 0.11) is one
eq = edges.index(-0.13)
for i in range(len(edges) + 1):
    zone = (i - (eq + 1)) % 2 == 0
    kinds.append(zone)
    if zone: c = srgb(234, 216, 186) if i == eq + 1 else ZONES[rng.integers(len(ZONES))]
    else: c = BELTS[rng.integers(len(BELTS))]
    mid = (edges[i - 1] if i > 0 else -1.6) * 0.5 + (edges[i] if i < len(edges) else 1.6) * 0.5
    c = c * (0.85 + 0.3 * rng.random())
    if abs(mid) > 0.9: c = c * 0.7 + srgb(110, 112, 160) * 0.3            # cooler towards the poles
    colours.append(c)
for i in range(len(edges)):
    strengths.append((0.3 + 1.1 * rng.random() ** 2) * (1 if i % 2 else -1))

wave = noise(streaky(0, 12, 10), 0.005)       # the edges are not ruled lines
LATW = LAT + wave
band_rgb = np.zeros((NY, NX, 3)); band_tone = np.zeros((NY, NX))
idx = np.searchsorted(np.array(edges), LATW)
for i, c in enumerate(colours):
    m = (idx == i)
    band_rgb[m] = c; band_tone[m] = 1.0 if kinds[i] else 0.0
# soften the edges a little, and streak every band along its length
soft = lambda a: inv(fwd(a) * np.exp(-(k / 300) ** 2))
band_rgb = np.dstack([soft(band_rgb[..., j]) for j in range(3)])
band_tone = soft(band_tone)
# texture at every scale inside the bands: long streaks, shorter ones, puffs of cloud
streak = noise(streaky(24, 120, 10), 1.0)
fine = noise(streaky(120, 500, 60), 1.0)
puffs = noise(ring(150, 600), 1.0)
band_rgb *= (1 + 0.09 * streak + 0.07 * fine + 0.05 * puffs)[..., None]
band_tone += 0.05 * streak

# OR A REAL PLANET'S MAP: its light and its warmth, regraded to violet and gold; its bands set the jets
if args.base:
    base = np.asarray(Image.open(args.base).convert("RGB").resize((NX, NY), Image.BICUBIC), dtype=float)[::-1] / 255.0
    # the mosaic's seams: steps from column to column that the planet does not have
    from scipy.ndimage import gaussian_filter1d
    rows = np.abs(lat) < 1.2
    cols = base[rows].mean(axis=0)
    base = np.clip(base - (cols - gaussian_filter1d(cols, NX / 60, axis=0, mode="wrap"))[None, :, :], 0, 1)
    lin = base ** 2.2
    Lb = (0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2])
    Lb = (Lb - np.percentile(Lb, 2)) / (np.percentile(Lb, 98) - np.percentile(Lb, 2)); Lb = np.clip(Lb, 0, 1)
    rb = (base[..., 0] - base[..., 2]) / (base[..., 0] + base[..., 2] + 1e-3)
    warmth = np.clip((rb - np.percentile(rb, 60)) / (np.percentile(rb, 97) - np.percentile(rb, 60)), 0, 1)   # only where it is warmer than the planet is
    stops = [(0.0, srgb(34, 16, 52)), (0.3, srgb(88, 44, 104)), (0.55, srgb(160, 120, 184)), (0.8, srgb(222, 208, 236)), (1.0, srgb(246, 240, 250))]
    def grade(v):
        out = np.zeros(v.shape + (3,))
        for (a, ca), (b, cb) in zip(stops[:-1], stops[1:]):
            m = (v >= a) & (v <= b); t_ = ((v - a) / (b - a))[m][..., None]; out[m] = ca + (cb - ca) * t_
        return out
    v = Lb ** 0.85
    band_rgb = grade(v)
    gold = (srgb(140, 92, 48) + (srgb(244, 214, 158) - srgb(140, 92, 48)) * v[..., None])
    band_rgb = band_rgb + (gold - band_rgb) * (warmth * 0.6)[..., None]
    rg = base[..., 0] - base[..., 1]
    # the great storm turns rose: the reddest oval, found where the red is broadest, and only there
    from scipy.ndimage import gaussian_filter
    rgs = gaussian_filter(rg, (NY / 120, NX / 120), mode="wrap")
    cy_, cx_ = np.unravel_index(np.argmax(rgs * (np.abs(LAT) < 0.8)), rgs.shape)
    near = np.exp(-(((X - x[cx_] + np.pi) % L - np.pi) ** 2 / 0.12 ** 2 + (LAT - lat[cy_]) ** 2 / 0.06 ** 2))
    red = np.clip((rg - np.percentile(rg, 90)) / (np.percentile(rg, 99.5) - np.percentile(rg, 90) + 1e-6), 0, 1) * near
    band_rgb = band_rgb + (srgb(200, 96, 128) - band_rgb) * (red * 0.8)[..., None]
    band_rgb *= (1 + 0.05 * fine + 0.04 * puffs)[..., None]
    band_tone = Lb
    # the jets run along the sharpest edges of the bands
    zm = Lb.mean(axis=1)
    zm = np.convolve(zm, np.ones(9) / 9, mode="same")
    grad = np.gradient(zm, lat)
    edges = list(lat[1:-1][(np.abs(grad[1:-1]) > np.abs(grad[:-2])) & (np.abs(grad[1:-1]) >= np.abs(grad[2:])) & (np.abs(grad[1:-1]) > 0.6 * np.abs(grad).std()) & (np.abs(lat[1:-1]) < 1.3)])
    strengths = [float(np.clip(abs(np.interp(e_, lat, grad)) / (3 * np.abs(grad).std()), 0.3, 1.4)) * (1 if np.interp(e_, lat, grad) > 0 else -1) for e_ in edges]

# THE JETS: along the edges, each its own strength; a super-rotating equator
def jets(l):
    u = 1.1 * np.exp(-(l / 0.09) ** 2)
    for e_, s_ in zip(edges, strengths):
        u = u + s_ * np.exp(-((l - e_) / 0.03) ** 2)
    taper = smooth(1.5, 1.2, np.abs(l))
    return u * taper * args.jet
UJ = jets(LAT)
wJ_hat = -1j * KY * fwd(UJ)
wJ = inv(wJ_hat)
wJ_mean = wJ.mean(axis=1)
WMAX = np.abs(wJ).max()

# the initial state: the jets, a little noise, the storms
w = wJ + noise(ring(12, 50), 0.025 * WMAX)
rgb = band_rgb.copy(); tone = band_tone.copy()
def oval(cx, cy, R, asp):
    dx = (X - cx + np.pi) % L - np.pi
    dy = LAT - cy
    return np.exp(-((dx / asp) ** 2 + dy ** 2) / R ** 2)
anti = lat[(wJ_mean < -0.25 * np.abs(wJ_mean).max()) & (np.abs(lat) < 1.1)]
cyc = lat[(wJ_mean > 0.25 * np.abs(wJ_mean).max()) & (np.abs(lat) < 1.0)]
STORMS_ON = not args.base
# the great storm: a rose oval with a pale collar, in the south
UJm = UJ.mean(axis=1)
calm = lat[(wJ_mean < 0) & (np.abs(UJm) < 0.25 * np.abs(UJm).max()) & (lat < -0.18) & (lat > -0.75)]
SLAT = calm[np.argmin(np.abs(calm + 0.38))] if len(calm) else -0.38; SLON = np.pi - 1.7
g = oval(SLON, SLAT, 0.1, 2.0) * STORMS_ON; core = oval(SLON, SLAT, 0.07, 2.0) * STORMS_ON
w += -1.3 * WMAX * g
collar = np.clip(g - core, 0, 1) * 1.6
rgb = rgb * (1 - np.clip(collar, 0, 1))[..., None] + srgb(240, 228, 230) * np.clip(collar, 0, 1)[..., None]
rgb = rgb * (1 - core)[..., None] + srgb(196, 92, 118) * core[..., None]
tone = tone * (1 - g) + g
# white ovals in the zones, dark barges in the belts
for i in range(args.ovals if STORMS_ON else 0):
    cy = rng.choice(anti); cx = rng.uniform(0, L); R = 0.012 + 0.018 * rng.random()
    g = oval(cx, cy, R, 1.3 + 0.5 * rng.random()); w += -0.8 * WMAX * g
    rgb = rgb * (1 - 0.9 * g)[..., None] + srgb(246, 242, 246) * (0.9 * g)[..., None]; tone = tone * (1 - g) + g
for i in range(args.ovals // 3 if STORMS_ON else 0):
    cy = rng.choice(cyc); cx = rng.uniform(0, L); R = 0.008 + 0.008 * rng.random()
    g = oval(cx, cy, R, 2.2); w += 0.7 * WMAX * g
    rgb = rgb * (1 - 0.85 * g)[..., None] + srgb(58, 26, 52) * (0.85 * g)[..., None]; tone = tone * (1 - g)

# where the belts boil: the strong jets' flanks
BOIL = np.zeros_like(LAT)
for e_, s_ in zip(edges, strengths):
    BOIL = np.maximum(BOIL, np.clip(abs(s_) - 0.5, 0, 1) * np.exp(-((LAT - e_) / 0.06) ** 2))
w_hat = fwd(w)
dyes = [fwd(rgb[..., 0]), fwd(rgb[..., 1]), fwd(rgb[..., 2]), fwd(tone)]
dyes0 = [zonal_mean_hat(fwd(band_rgb[..., j])) for j in range(3)] + [zonal_mean_hat(fwd(band_tone))]
wJ_hat_m = zonal_mean_hat(wJ_hat)

def velocity(w_h):
    psi = -w_h * K2i
    return inv(-1j * KY * psi), inv(1j * KX * psi)   # u = -psi_y, v = psi_x
def advect(u, v, a_h):
    return fwd(u * inv(1j * KX * a_h) + v * inv(1j * KY * a_h)) * DEAL

TAU_JET, TAU_DYE, DRAG = 0.4, 0.6, 0.04
def rhs(w_h, ds):
    u, v = velocity(w_h)
    dw = -advect(u, v, w_h) - args.beta * fwd(v) * DEAL
    dw += (wJ_hat_m - zonal_mean_hat(w_h)) / TAU_JET
    dw -= DRAG * (w_h - zonal_mean_hat(w_h))
    out = [-advect(u, v, a) + (a0 - zonal_mean_hat(a)) / TAU_DYE for a, a0 in zip(ds, dyes0)]
    return dw, out, max(np.abs(u).max(), np.abs(v).max())

dx_ = L / NX
t0 = time.time()
umax, step, T = 2.0, 0, 0.0
while T < args.time:
    dt = min(0.45 * dx_ / max(umax, 1e-3), args.time - T + 1e-9)
    T += dt
    dw1, dd1, umax = rhs(w_hat, dyes)
    w1 = w_hat + dt * dw1
    d1 = [a + dt * da for a, da in zip(dyes, dd1)]
    dw2, dd2, _ = rhs(w1, d1)
    w_hat = (w_hat + 0.5 * dt * (dw1 + dw2)) * FILTER
    dyes = [(a + 0.5 * dt * (p + q)) * FILTER for a, p, q in zip(dyes, dd1, dd2)]
    # stirring: small kicks of spin where the belts boil, so they break into fine filaments
    if args.stir > 0 and step % 6 == 0:
        w_hat = w_hat + fwd(noise(ring(50, 140), 1.0) * BOIL) * (args.stir * 0.02 * WMAX)
    if step % 100 == 0:
        print(f"step {step}  t {T:.3f}/{args.time}  dt {dt:.5f}  umax {umax:.2f}  {time.time() - t0:.0f}s", flush=True)
    step += 1

c = np.dstack([inv(d) for d in dyes[:3]])
t = np.clip(inv(dyes[3]), 0, 1)
# the poles: a blue-grey hood, its edge broken
pol = smooth(1.08, 1.32, np.abs(LAT) + 0.06 * noise(ring(4, 24)))
hood = (srgb(56, 56, 98) + (srgb(128, 128, 166) - srgb(56, 56, 98)) * t[..., None]) * (0.9 + 0.1 * noise(ring(10, 60)))[..., None]
c = c * (1 - pol)[..., None] + hood * pol[..., None]
c *= (0.98 + 0.04 * noise(ring(150, 400)))[..., None]

def to8(a): return (np.clip(a, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
img = Image.fromarray(to8(c)[::-1], "RGB")
big = img.resize((args.size, args.size // 2), Image.LANCZOS) if args.size != NX else img
if args.base:
    from PIL import ImageFilter
    big = big.filter(ImageFilter.UnsharpMask(radius=2.5, percent=70, threshold=1))   # the real map is softer than the screen
if args.preview:
    big.save(args.preview)
if args.out:
    big.save(args.out, "WEBP", quality=88, method=6)
    img.resize((2048, 1024), Image.LANCZOS).save(args.out.replace(".webp", "-2k.webp"), "WEBP", quality=88, method=6)
print("done", round(time.time() - t0), "s")
