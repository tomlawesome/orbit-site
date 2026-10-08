# Capabilities: shipping the best version each machine can carry

The goal: find, reliably and within the first quarter second, the highest-quality version of the door that this
machine and browser can run smoothly, and ship exactly that. Never a stutter to find out; never something shown
and then taken away.

(Decided 8 October 2026, from the measurements below. The code that follows it: `assets/js/capability.js`, which
every other module reads its level from; nothing decides on its own.)

## Two rules

1. **Prove before you show.** Every step up the ladder is measured first, unseen (a compile timed under the loading
   ring, frames drawn into an off-screen target). The visitor only ever sees a level that has already passed.
2. **Probe before you pay.** Cheap checks come before expensive work: a compile's duration before the next compile, a
   small synthetic draw before megabytes of maps are fetched or uploaded.

## What a browser can tell us

| Signal | How good | When known | Used for |
|---|---|---|---|
| Screen size, pixel ratio, window size | exact | 0 s | map tier (lights strip 120/180/240 px a degree), drawing density |
| Whether shaders compile in the background (`KHR_parallel_shader_compile`) or on the page's thread (Firefox) | exact | 0 s | where compiles may happen: anywhere (background) or only under the ring (page thread: a compile stalls everything, the compositor's animations included) |
| WebGL2, float render targets, anisotropic filtering | exact | 0 s | whether the live door is possible at all |
| Reduced motion, save-data, battery saver (where exposed) | exact where present | 0 s | still door; no sharp strip |
| GPU name (vague on Firefox), memory class (Chrome/Edge only), cores (capped) | hints only | 0 s | tie-breakers, never a decision |
| **Compiler speed**: the probe shader's compile time | measured | ~0.1 s | predicts every later compile (the laptop's compiler was 3x the desktop's on each shader) |
| **GPU speed**: the probe shader drawn four times into 512x512, read back | measured | ~0.15 s | predicts ms per million pixels, scaled to this screen's band |
| The real compiles and draws, timed as they happen | measured | 0.5 s on | confirmation; the real measures still gate every step |

## The probe (step one, at 0 s, before the ring turns)

One context (the one that asks about background compiling), one shader of known moderate size, a few thousand
characters of the same arithmetic and texture reads the Earth does. Compile it, timed: on a page-thread compiler a
stall of 50-150 ms while nothing moves yet. Draw it four times into a 512x512 target with a read-back, timed. Two
numbers: compile ms (predicts the ring budget) and ms per million pixels (predicts frame cost). Then release the
context. Calibration points from the real shaders: see the measurements.

As built (`assets/js/capability.js`, `probe()`, 8 October 2026): where compiles are in the background the probe is
compiled twice (salted, two programs) and the second is the one timed, since a fresh context's first compile is
3-5x the rest on Safari; on the page's thread once, since each is a stall. The result is kept in `localStorage` for
**7 days**, keyed by the user agent, the screen's width and height and the pixel ratio, and while it is that fresh
the probe is skipped altogether (the console says `stored` instead of `fresh`). Only a probe that worked is kept.
`doorWeight()` turns it into the door's weight: the rich Earth predicted at ms per Mpx × the band's Mpx × 0.55,
"rich" at 24 ms or less, "both" (lean first, rich tried by the ladder) at 40 or less, "lean" above; no probe, "both".

## The ladder

| Level | What ships | Proof required, in order |
|---|---|---|
| **0 Still** | the baked door (`assets/img/door/dawn.webp`, 3200x720 from the NASA sources: static Earth, static clouds, high fidelity) and its picture planets; the flight with its classic Earth (the lighter, pre-slab shader); the dives and planets as before the live door | none: the floor, always ready |
| **1 Live lean** | the live Earth with flat clouds, turning slowly; sphere and world planets; the flight's richer Earth (for the handoff); near maps and the small lights strip | WebGL2 with float targets; the level's compiles fit the ring budget (predicted from the probe); the probe's ms per million pixels, scaled to the band, says lean <= 16 ms a frame, *before* the big maps are fetched; the real lean frames unseen <= 16 ms; the world planets' cost unseen |
| **2 Live rich** | the cloud slab (dawn.py's physics); the device's sharp lights strip, faded in | the rich compile also fits the ring budget; rich frames unseen <= 40 ms |

Continuous knobs inside a level, all by measure: drawing density (down to 0.5x), the world planets at half scale,
the lights strip tier by screen.

No browser is named in the rules. The names only explain where a machine lands.

## Where the machines we have measured land

| Machine | Browser | Probe-equivalent facts | Level |
|---|---|---|---|
| Desktop, RTX 3080, 3840x2160 at 1.5x | Edge | compiles in background; lean 13-16 ms at 3.3 Mpx | 2 |
| Desktop, RTX 3080 | Firefox | page-thread compiles: install world 0.5-1 s, door lean 0.37-0.41 s, rich 0.5-0.7 s, flight ~1.9 s classic / 3.1 s with the slab Earth; lean 4-7 ms | 2, compiles under the ring |
| Laptop 14", Ryzen 7 4700U with integrated Radeon, 1920x1080 at 1.25x | Edge | compiles in background (install 1.4 s, flight 1.8 s, galaxy 0.4 s); lean 18 ms a frame; uploads and first draws ~5 s after the reveal | 0 or 1 without the world planets: decided by the probe before the uploads |
| Laptop, same | Firefox | install 1.6 s, flight 3.1 s, door 0.4 + 0.7 s, planets 0.24, galaxy 0.18: 6.2 s of compiles, each a stall; lean 11 ms, rich 23 ms, world planets 11.9 ms (halved) | 0 |
| iPhone 13 Pro Max, 428x926 at 3x (drawn at 2x) | Safari 26 | WebGL2, float targets, compiles in background (130-170 ms each); lean 3.3 ms, rich 5.7 ms at 0.48 Mpx; uploads in tens of ms; frames at 30 a second during the test (Low Power Mode?) | 2 |
| MacBook, Apple GPU (Apple silicon), 1512x982 at 2x, 8 cores | Safari 26 | compiles in background (150-167 ms each; the very first compile of the context 503 ms, see below); probe 10.2 ms per Mpx, as fast as the 3080; lean 4.3 ms, rich 6.7 ms at 2.06 Mpx; uploads 5-47 ms; frame gaps 20 ms around the rich compile | 2, the most headroom measured |

Readiness measured on 8 October 2026 (cold, private window), after the ordering work: desktop Edge ways in 5.3 s,
button 6.0 s; desktop Firefox 8.7 s / 9.3 s (before compiles were moved under the ring); laptop Edge 8.6 s / 9.5 s;
laptop Firefox 15.4 s / 16.1 s. The flight's compile grew from ~1.9 s to 3.1 s on Firefox with the slab Earth: level
0 restores the classic Earth to the flight.

## Testing across devices

The tests live at `tests/` (`https://tomlawesome.github.io/orbit-site/tests/`): six small pages, one task each, and a
runner that runs them all and copies one report: `machine` (what the browser says, WebGL2 and its extensions, the GPU's
name), `compile` (the probe shader and the real door and flight Earth shaders, salted against the shader cache),
`draw` (the probe at 512x512 for ms per million pixels, then the real lean and rich door shaders at this screen's own
band with maps of noise so every path runs), `upload` (maps of the site's sizes put on the GPU with their mipmaps),
`stall` (a spinner turns while the rich shader compiles: the frame gaps, and the eye's verdict on the spinner), and
`network` (two of the maps fetched fresh). Numbers from each device go into the table above.

A readout page (`?probe` in the address) that runs the probe and prints its report on the screen as well as the
console (phones have no console to hand), as copyable text: browser class, screen, extensions, compile ms, ms per
million pixels, the level chosen and why, and then the real measures as they come. The same lines are printed on the
normal door (`orbit · …`). Devices to hand: the desktop (Edge, Firefox), the laptop (Edge, Firefox), one WebKit phone;
no WebKit desktop of our own (a friend's Mac can be asked). The probe page must work on a phone, and its report must
be short enough to paste from one: a friend with a Mac should be able to open the link and send back the text.

## Measured with the tests (8 October 2026)

| | Desktop RTX 3080 (over Remote Desktop: 1920x1080 at 1.25x, reduced motion on) | Laptop 4700U, integrated Radeon, 1920x1080 at 1.25x |
|---|---|---|
| Compile, Firefox (each a stall): probe 2k / door lean 16k / door rich / flight head 28k / flight rich | 199 / 279 / 439 / 346 / 537 ms | 317 / 457 / 772 / 583 / 934 ms |
| Compile, Edge (background, same programs) | 200 / 286 / 450 / 398 / 543 ms | 308 / 421 / 1039 / 777 / 1393 ms |
| Trivial program / probe rolled | not yet measured | 8-13 / 129 ms (Firefox); 9-13 / 124 ms (Edge) |
| Draw at this band (0.83 Mpx): probe ms per Mpx / door lean / door rich | 9-13 / 1.7-2.0 / 4.7-4.8 ms | 40-48 / 9.6-12.7 / 22-24 ms |
| Upload 4096x2048 with mipmaps | ~50 ms | ~70-130 ms |
| Stall of the page for the rich compile, Firefox | 445 ms | 520 ms |

**WebKit, both devices (8 October).** iPhone 13 Pro Max: compiles 130-170 ms each in the background (probe 168, the
salted probe again 88), lean 3.3 / rich 5.7 ms at 0.48 Mpx, uploads <= 45 ms. MacBook with an Apple GPU, Safari 26,
1512x982 at 2x: probe 503 ms then 91; door lean 152, rich 167, flight head 151, rich 166 ms; probe 10.2 ms per Mpx;
lean 4.3 / rich 6.7 ms at the band's 2.06 Mpx (first frames 96 and 110 ms); uploads 5-47 ms; rich compile 158 ms with
frame gaps of 20 ms either side; 40 Mbit/s. Two Safari habits to design for: the *first* compile of a fresh context is
3-5x the rest (503 vs 91 on the Mac, 168 vs 88 on the phone), so the probe's second compile is the honest one and the
first is warm-up to be discounted; and "mipmaps 0 ms" every time means they are built lazily, on first use, so the
first draw of a real shader carries ~100 ms there (which the unseen proving draw absorbs, as it should).

**The finding: a program's fixed cost is ~10 ms; the rest is its size once unrolled.** A trivial program compiles
in 8-13 ms on the laptop. Direct3D's compiler unrolls every loop whose count it can see, and that unrolled size is
the cost: the 2k-character probe takes 315 ms with its loops countable and 129 ms with them rolled (a uniform, always
0, added to each count), in Firefox and in Edge, drawing at the same speed. The count of programs mattered only for
the ~10 ms each and for the contention when many compile in the background at once. The site's shaders are full of
fixed-count loops, so the rich door's 770 ms and the flight head's 998 ms were mostly unrolling (PERFORMANCE.md).

**What it implied, before the loops were measured:** fewer programs, same picture. (Status as of 8 October 2026; see
PERFORMANCE.md. Built on the belief above that the count was the cost; the count turned out to cost ~10 ms a program,
so this bought little on Windows, and the rolled loops are what bought the compile time.)
- **Done.** The flight's two bloom passes and film become one program with a mode switch (saves two compiles). The
  install/information world's the same (two more).
- **Done.** The live door compiles rich only, when the probe says rich fits; lean only otherwise (saves one). Between
  the two ("both") it is as before: lean first, rich if the ladder finds room. The lean one is compiled after a rich
  start only if the rich one is still over budget at half density.
- **Done**, the second way: the cloud field and glow passes are folded into the rich Earth's own program (saves both,
  in the door's context and in the flight's).
- **Deferred** to a later build: the planets compile once (one context, the far half blitted). They still compile
  their one program twice.
- **Done** for the docs' galaxy where compiles are in the background: it is compiled after the door is live, not
  during the reveal. On the page's thread it stays under the ring (there is no better slot). The flight's rich overlay
  is compiled only where the door's weight needs it: in place of the lean one where the door is rich, as before where
  it is "both", never where it is lean.
On the laptop that is roughly 1.5-2 s less under the ring on Firefox, and on Edge the same work off the background.

**Calibration from the probe:** lean ≈ 0.18-0.25 of the probe's ms per Mpx (the Mac 0.20), rich ≈ 0.3-0.55 (the Mac 0.32, the PCs 0.45-0.55); a compile ≈ the
probe's compile time scaled by the shader's rolled size (the per-character rule from before the loops were rolled no
longer holds; to be re-fitted from the next laptop run). Firefox's GPU name is made up ("GTX 980",
"R9 200 Series"); Edge's is real.

## Open questions

- The exact ring budget (how many seconds of compiles a visitor will wait on a first visit before the door): 2.5 s?
- Whether level 1 on a weak GPU keeps the world planets (two world draws a frame) or only the spheres.
- Calibration of the probe against the real shaders: four points (the 3080, the 4700U's Radeon, the phone, the Mac);
  rich's ratio spreads 0.3-0.55, so the real rich measure, unseen, stays the gate and the probe only decides whether
  to try it.
