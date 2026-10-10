/* how fast the site's own pictures come down this line: two of the maps, fetched fresh */
import { line, round } from "./common.js";
export const name = "network";
export async function run() {
  const out = [];
  for (const [path, label] of [["../assets/door/img/dawn/lights-strip-180.webp", "lights strip 180 (1.2 MB)"], ["../assets/door/img/dawn/clouds-near.webp", "near clouds (0.5 MB)"]]) {
    try {
      const t0 = performance.now();
      const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" }); const b = await r.blob();
      const ms = performance.now() - t0;
      out.push(line(label, `${round(ms)} ms, ${round((b.size * 8) / ms / 1000, 1)} Mbit/s`));
    } catch (e) { out.push(line(label, `failed: ${e.message}`)); }
  }
  return out;
}
