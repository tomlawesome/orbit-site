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
| Phone (WebKit) | Safari | not yet measured | ? |

Readiness measured on 8 October 2026 (cold, private window), after the ordering work: desktop Edge ways in 5.3 s,
button 6.0 s; desktop Firefox 8.7 s / 9.3 s (before compiles were moved under the ring); laptop Edge 8.6 s / 9.5 s;
laptop Firefox 15.4 s / 16.1 s. The flight's compile grew from ~1.9 s to 3.1 s on Firefox with the slab Earth: level
0 restores the classic Earth to the flight.

## Testing across devices

A readout page (`?probe` in the address) that runs the probe and prints its report on the screen as well as the
console (phones have no console to hand), as copyable text: browser class, screen, extensions, compile ms, ms per
million pixels, the level chosen and why, and then the real measures as they come. The same lines are printed on the
normal door (`orbit · …`). Devices to hand: the desktop (Edge, Firefox), the laptop (Edge, Firefox), one WebKit phone;
no WebKit desktop of our own (a friend's Mac can be asked). The probe page must work on a phone, and its report must
be short enough to paste from one: a friend with a Mac should be able to open the link and send back the text.

## Open questions

- The exact ring budget (how many seconds of compiles a visitor will wait on a first visit before the door): 2.5 s?
- Whether level 1 on a weak GPU keeps the world planets (two world draws a frame) or only the spheres.
- Calibration of the probe against the real shaders: two points so far (the 3080 and the 4700U's Radeon); the phone
  will be the third.
