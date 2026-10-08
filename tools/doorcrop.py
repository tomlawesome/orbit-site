#!/usr/bin/env python3
"""
The door's Earth, near: the patch of the planet the live door looks at, cut
from NASA's full-resolution maps, so its clouds and cities stay as sharp as
the baked picture's (tools/dawn.py, assets/img/door/dawn.webp).

The live door (assets/js/door3d.js) otherwise samples the flight's global
maps (assets/img/flight/, 2048 px around the world for the clouds, about
17 km a pixel): from 800 km up the clouds go to mush and the lights go soft.
The ground actually in view is lat 42–54, lon 5–14; the Earth turns slowly
under the camera, so the box cut here has room around it:

  NEAR = lon -25 … 45, lat 28 … 66   (plate carrée, north up, west on the left)

What is written, into --out:
  - clouds-near.webp: the Blue Marble's cloud cover, greyscale, 48 px a
    degree (3360×1824; about 2 km a pixel). The source is 120 px a degree in
    two hemispheres; the box crosses lon 0, so a strip is cut from each, the
    two are joined and brought down by 2.5 with a Lanczos filter. Two
    things in it are NASA's and left as they are: the Alps' snow reads as
    cloud, and a dark swath gap, a pixel or two wide, crosses the North Sea
    at lat 56.5 from lon -2 to 0.
  - lights-near.webp: the Black Marble 2016 city lights at 3 km, at its own
    37.5 px a degree (2625×1425), not resampled, so points of light stay
    points. lon -25 falls half way into a pixel there, so the crop starts on
    the pixel edge just west of it: it covers lon -25.0133 … 44.9867 (the
    latitudes are exact). The 500 m Europe crop
    (assets/img/flight/europe-lights.webp) still lies on top of it.
  - land-near.webp: the Blue Marble Next Generation (December 2004, with
    topography and bathymetry) at its own 15 px a degree (1050×570).

Imagery (NASA Earth Observatory; credit NASA):
  https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud.W.2001210.21600x21600.png   (lon -180 … 0)
  https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud.E.2001210.21600x21600.png   (lon 0 … 180)
  https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg
  https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg

Each cloud hemisphere is a 211 MB PNG. Where the disk will not hold both,
give one at a time with --strips: the script keeps the cut strip there (a
lossless PNG, a few MB) and takes it from there when that hemisphere is not
given, so the result is the same as with both at once:

  python3 tools/doorcrop.py --clouds-w cloud.W.png --strips S
  python3 tools/doorcrop.py --clouds-e cloud.E.png --strips S \\
      --lights BlackMarble_2016_3km.jpg --land world.topo.bathy.200412.3x5400x2700.jpg \\
      --out assets/img/door

(pip install pillow, with WebP.)
"""
import argparse, os, sys
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

NEAR = (-25, 45, 28, 66)                  # lon0, lon1, lat0, lat1
CLOUD_PPD, CLOUD_OUT_PPD = 120, 48        # the source's px a degree; what is written
LIGHTS_PPD = 37.5                         # BlackMarble_2016_3km.jpg: 13500×6750
LAND_PPD = 15                             # world.topo.bathy …3x5400x2700.jpg

ap = argparse.ArgumentParser(description="Cut the door's near patch of Earth from NASA's maps.")
ap.add_argument("--clouds-w", help="cloud.W.2001210.21600x21600.png (lon -180..0, lat 90..-90)")
ap.add_argument("--clouds-e", help="cloud.E.2001210.21600x21600.png (lon 0..180, lat 90..-90)")
ap.add_argument("--strips", help="a directory to keep each hemisphere's cut strip in, and take it from when that hemisphere is not given")
ap.add_argument("--lights", help="BlackMarble_2016_3km.jpg (13500×6750, the whole world)")
ap.add_argument("--land", help="world.topo.bathy.200412.3x5400x2700.jpg (the whole world)")
ap.add_argument("--out", default="assets/img/door", help="where the *-near.webp go")
args = ap.parse_args()

lon0, lon1, lat0, lat1 = NEAR
top, bottom = (90 - lat1) * CLOUD_PPD, (90 - lat0) * CLOUD_PPD

def strip(side, path):
    """The box's share of one cloud hemisphere, at the source's resolution."""
    if side == "W":
        a, b = max(lon0, -180), min(lon1, 0)
        x0, x1 = (a + 180) * CLOUD_PPD, (b + 180) * CLOUD_PPD
    else:
        a, b = max(lon0, 0), min(lon1, 180)
        x0, x1 = a * CLOUD_PPD, b * CLOUD_PPD
    keep = os.path.join(args.strips, f"clouds-{side}-strip.png") if args.strips else None
    if path:
        im = Image.open(path)
        if im.size != (180 * CLOUD_PPD, 180 * CLOUD_PPD):
            sys.exit(f"{path}: {im.size}, not a {180 * CLOUD_PPD}² hemisphere")
        s = im.convert("L").crop((x0, top, x1, bottom))
        if keep:
            os.makedirs(args.strips, exist_ok=True)
            s.save(keep, optimize=False)
            print("kept", keep, s.size)
        return s
    if keep and os.path.exists(keep):
        s = Image.open(keep).convert("L")
        if s.size != (x1 - x0, bottom - top):
            sys.exit(f"{keep}: {s.size}, not the strip this box needs")
        return s
    return None

def save(im, name, q):
    p = os.path.join(args.out, name)
    im.save(p, "WEBP", quality=q, method=6)
    print(f"{p}: {im.size[0]}×{im.size[1]}, {os.path.getsize(p)} bytes")

os.makedirs(args.out, exist_ok=True)

# the clouds: west and east strips, joined at lon 0, brought down to 48 px a degree
w, e = strip("W", args.clouds_w), strip("E", args.clouds_e)
if w is not None and e is not None:
    both = Image.new("L", (w.width + e.width, w.height))
    both.paste(w, (0, 0)); both.paste(e, (w.width, 0))
    size = ((lon1 - lon0) * CLOUD_OUT_PPD, (lat1 - lat0) * CLOUD_OUT_PPD)
    save(both.resize(size, Image.LANCZOS), "clouds-near.webp", 72)
elif args.clouds_w or args.clouds_e:
    print("clouds: one hemisphere only so far; give the other (and --strips) to write clouds-near.webp")

# the lights: a crop on the source's own pixels (lon -25 falls mid-pixel: start on the edge west of it)
if args.lights:
    im = Image.open(args.lights)
    if im.size != (13500, 6750):
        sys.exit(f"{args.lights}: {im.size}, not the 3 km Black Marble")
    x0 = int((lon0 + 180) * LIGHTS_PPD)                    # 5812 → lon -25.0133
    wd = round((lon1 - lon0) * LIGHTS_PPD)                 # 2625
    y0, y1 = round((90 - lat1) * LIGHTS_PPD), round((90 - lat0) * LIGHTS_PPD)
    save(im.convert("RGB").crop((x0, y0, x0 + wd, y1)), "lights-near.webp", 82)

# the land: exact pixels at 15 px a degree
if args.land:
    im = Image.open(args.land)
    if im.size != (360 * LAND_PPD, 180 * LAND_PPD):
        sys.exit(f"{args.land}: {im.size}, not the 5400×2700 Blue Marble")
    box = ((lon0 + 180) * LAND_PPD, (90 - lat1) * LAND_PPD, (lon1 + 180) * LAND_PPD, (90 - lat0) * LAND_PPD)
    save(im.convert("RGB").crop(box), "land-near.webp", 75)
