/*
 * Test for the flight's pace (#151), written from the issue's specification alone: the flight is paced by one pair of
 * pure functions in assets/door/engine.js, clockAt (flight time to clock time) and paced (its inverse), in front of
 * an unchanged timeline.
 *
 * The specification's definition, which every expected number below is worked out from (a numeric integral written
 * in this file, never the code under test):
 *
 *   sm(a, b, x) = t*t*(3 - 2*t), t = clamp((x - a) / (b - a), 0, 1)
 *   slow(f)     = sm(0, 300, f) * (1 - sm(1500, 1900, f))
 *   fast(f)     = sm(1900, 2400, f) * (1 - sm(4400, 4800, f))
 *   cost(f)     = 1 + (1000 / 1550) * slow(f) - (500 / 2450) * fast(f)
 *   clockAt(f)  = the integral of cost from 0 to f for 0 <= f <= UPDUR; f for f < 0; f + (UPTIME - UPDUR) past UPDUR
 *   paced(c)    = its inverse; UPTIME = 5300, DOWNTIME = UPTIME * REV
 *   rev (the descent, in its own flight time d, 0 to DOWNDUR):
 *     clockAt(d, true) = DOWNTIME - REV * clockAt(mirror(d)); d for d < 0; d + (DOWNTIME - DOWNDUR) past DOWNDUR
 *
 * Covered here (the Node-visible part of the specification):
 *   1. the exports (engine.js and the door's index.js) and the neighbours that must not move (UPDUR, DOWNDUR, REV,
 *      mirror, the profiles' own lengths, the timeline's lengths that are not beats, the reduced-motion beats)
 *   2. clockAt against the integral, the checked figures, below 0 and past the end, with and without rev
 *   3. paced as clockAt's inverse to within 1 ms both ways across the whole range, and strictly rising
 *   4. the descent identity mirror(paced(c, true)) = paced(UPTIME * (1 - c / DOWNTIME))
 *   5. the new beat tables (a beat at or after the warp beat moves to warp + clockAt(beat - warp); earlier ones do not),
 *      MARK_RIDE_UP and MARK_RIDE_DOWN
 *   6. flights played "a second shorter" (sideways and docs flights, and the descents from them)
 *
 * What Node cannot see (the engine drawing paced(clock * rate), pinned flights, journey.js's pinnedFlight, quicken) is
 * in tools/ci/pin-test.mjs and the live suites. No test judges speed or smoothness.
 *
 *   node tools/ci/flight-pace-test.mjs
 *
 * No dependencies and no browser. A missing export is reported as a failure, not a crash.
 */
let failed = false, total = 0;
const check = (name, ok, detail) => {
  total++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const near = (a, b, tol) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= tol;
const attempt = (fn) => { try { return { v: fn() }; } catch (e) { return { err: String(e && e.message || e).split("\n")[0] }; } };
const say = (r, f = (v) => String(v)) => (r.err ? `threw: ${r.err}` : f(r.v));

const engine = await import("../../assets/door/engine.js");
const door = await import("../../assets/door/index.js");
const tl = await import("../../assets/door/timeline.js");
const jy = await import("../../assets/js/journeys.js");
const { UPDUR, DOWNDUR, REV, mirror, UP, DOWN } = engine;

/* ---- the definition, as an integral worked out here ---- */
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const slow = (f) => sm(0, 300, f) * (1 - sm(1500, 1900, f));
const fast = (f) => sm(1900, 2400, f) * (1 - sm(4400, 4800, f));
const cost = (f) => 1 + (1000 / 1550) * slow(f) - (500 / 2450) * fast(f);
const UPT = 5300, DOWNT = UPT * (4100 / 4800);
const H = 0.25, CELLS = 4800 / H;
const simpson = (a, b) => (b - a) / 6 * (cost(a) + 4 * cost((a + b) / 2) + cost(b));
const cum = new Float64Array(CELLS + 1);
for (let k = 0; k < CELLS; k++) cum[k + 1] = cum[k] + simpson(k * H, (k + 1) * H);
const ref = (f) => {
  if (f < 0) return f;
  if (f > 4800) return f + (UPT - 4800);
  const k = Math.min(CELLS - 1, Math.floor(f / H));
  return cum[k] + simpson(k * H, f);
};
const refMirror = (d) => 4800 * (1 - clamp01(d / 4100));
const refRev = (d) => (d < 0 ? d : d > 4100 ? d + (DOWNT - 4100) : DOWNT - (4100 / 4800) * ref(refMirror(d)));

/* the integral against the specification's own figures, so the reference is itself checked */
for (const [f, want] of [[300, 396.77], [1900, 2900], [2400, 3348.98], [4400, 4940.82], [4800, 5300]]) {
  check(`reference: the integral at ${f} is the checked figure ${want}`, near(ref(f), want, 0.011), `${ref(f).toFixed(3)}`);
}
check("reference: the descent figures 2955 and 4100", near(refRev(2955), 2726.03, 0.011) && near(refRev(4100), 4527.08, 0.011), `${refRev(2955).toFixed(3)}, ${refRev(4100).toFixed(3)}`);

/* ---- 1. exports ---- */
const names = ["UPTIME", "DOWNTIME", "clockAt", "paced"];
for (const n of names) {
  check(`engine.js exports ${n}`, engine[n] !== undefined, `typeof ${typeof engine[n]}`);
  check(`index.js exports ${n}`, door[n] !== undefined, `typeof ${typeof door[n]}`);
}
const built = names.every((n) => engine[n] !== undefined);

/* ---- 7 (unchanged): the flight-time constants and neighbours ---- */
check("7. UPDUR is 4800 and DOWNDUR 4100", UPDUR === 4800 && DOWNDUR === 4100, `${UPDUR}, ${DOWNDUR}`);
check("7. REV is DOWNDUR / UPDUR", near(REV, 4100 / 4800, 1e-12), `${REV}`);
check("7. mirror(t) = UPDUR * (1 - clamp(t / DOWNDUR, 0, 1)) at 0, 1025, 2050, 4100, below and past", [0, 1025, 2050, 4100, -30, 4500].every((t) => near(mirror(t), refMirror(t), 1e-9)), [0, 2050, 4100, -30, 4500].map((t) => `${t}:${mirror(t)}`).join(" "));
check("7. the climb's and the descent's profile lengths (P.dur) are still flight time: 4800 and 4100", UP.dur === 4800 && DOWN.dur === 4100, `${UP.dur}, ${DOWN.dur}`);
check("7. UP.speed and UP.atm are still functions", typeof UP.speed === "function" && typeof UP.atm === "function", `${typeof UP.speed}, ${typeof UP.atm}`);
check("7. door index re-exports UPDUR and DOWNDUR unchanged", door.UPDUR === 4800 && door.DOWNDUR === 4100, `${door.UPDUR}, ${door.DOWNDUR}`);

/* ---- 1/2. UPTIME, DOWNTIME ---- */
check("UPTIME is 5300", engine.UPTIME === 5300, `${engine.UPTIME}`);
check("DOWNTIME is UPTIME * REV (about 4527.08)", near(engine.DOWNTIME, UPT * (4100 / 4800), 1e-6) && near(engine.DOWNTIME, 4527.08, 0.01), `${engine.DOWNTIME}`);

if (!built) {
  console.log("FAIL 2-4: not run, clockAt/paced/UPTIME/DOWNTIME are not all exported yet (every case below needs them)");
  failed = true;
}
const { clockAt, paced } = engine;
const ok = built && typeof clockAt === "function" && typeof paced === "function";

if (ok) {
  /* ---- 2. clockAt against the definition ---- */
  for (const [f, want] of [[300, 396.77], [1900, 2900], [2400, 3348.98], [4400, 4940.82], [4800, 5300]]) {
    const r = attempt(() => clockAt(f));
    check(`2. clockAt(${f}) is the checked figure ${want}`, !r.err && near(r.v, want, 0.011), say(r, (v) => v.toFixed(3)));
  }
  for (const [d, want] of [[2955, 2726.03], [4100, 4527.08]]) {
    const r = attempt(() => clockAt(d, true));
    check(`2. clockAt(${d}, true) is the checked figure ${want}`, !r.err && near(r.v, want, 0.011), say(r, (v) => v.toFixed(3)));
  }
  check("2. clockAt(0) is 0 and clockAt(0, true) is 0", near(clockAt(0), 0, 1e-6) && near(clockAt(0, true), 0, 1e-6), `${clockAt(0)}, ${clockAt(0, true)}`);
  const dense = (rev, top) => {
    let worst = 0, at = 0;
    for (let f = 0; f <= top; f += 3.7) { const e = Math.abs(clockAt(f, rev) - (rev ? refRev(f) : ref(f))); if (e > worst) { worst = e; at = f; } }
    return { worst, at };
  };
  for (const [rev, top, label] of [[false, 4800, "climb"], [true, 4100, "descent (rev)"]]) {
    const r = attempt(() => dense(rev, top));
    check(`2. clockAt matches the integral of cost across the whole ${label}, within 0.1 ms`, !r.err && r.v.worst <= 0.1, say(r, (v) => `worst ${v.worst.toFixed(4)} ms at ${v.at.toFixed(1)}`));
  }
  /* below 0 and past the end */
  for (const [f, want, rev] of [[-1, -1, false], [-250, -250, false], [4801, 4801 + 500, false], [6200, 6700, false], [100000, 100500, false], [-1, -1, true], [-250, -250, true], [4101, 4101 + (DOWNT - 4100), true], [5000, 5000 + (DOWNT - 4100), true]]) {
    const r = attempt(() => clockAt(f, rev));
    check(`2. clockAt(${f}${rev ? ", true" : ""}) is ${want.toFixed(2)} (${f < 0 ? "below 0: itself" : "past the end: shifted by the extra length"})`, !r.err && near(r.v, want, 0.011), say(r, (v) => v.toFixed(3)));
  }
  check("2. clockAt is continuous at both ends (the climb at 0 and 4800, the descent at 0 and 4100)", [[0, false], [4800, false], [0, true], [4100, true]].every(([e, rev]) => Math.abs(clockAt(e + 1e-6, rev) - clockAt(e - 1e-6, rev)) < 1e-3), "steps of 2e-6 around each end");

  /* ---- 3. paced: the inverse both ways, and strictly rising ---- */
  for (const [rev, ft, ct, label] of [[false, 4800, 5300, "climb"], [true, 4100, DOWNT, "descent (rev)"]]) {
    const sweep = () => {
      let wf = 0, wc = 0, af = 0, ac = 0;
      for (let f = -40; f <= ft + 60; f += 3.3) { const e = Math.abs(paced(clockAt(f, rev), rev) - f); if (e > wf) { wf = e; af = f; } }
      for (let c = -40; c <= ct + 60; c += 3.3) { const e = Math.abs(clockAt(paced(c, rev), rev) - c); if (e > wc) { wc = e; ac = c; } }
      return { wf, af, wc, ac };
    };
    const r = attempt(sweep);
    check(`3. ${label}: paced(clockAt(f)) is f within 1 ms, from -40 to the end + 60`, !r.err && r.v.wf <= 1, say(r, (v) => `worst ${v.wf.toFixed(4)} ms at ${v.af.toFixed(1)}`));
    check(`3. ${label}: clockAt(paced(c)) is c within 1 ms, from -40 to the end + 60`, !r.err && r.v.wc <= 1, say(r, (v) => `worst ${v.wc.toFixed(4)} ms at ${v.ac.toFixed(1)}`));
    for (const [fnName, fn, top] of [["clockAt", (x) => clockAt(x, rev), ft], ["paced", (x) => paced(x, rev), ct]]) {
      const rising = () => {
        let prev = fn(-30), bad = null;
        for (let x = -29; x <= top + 30; x += 1) { const v = fn(x); if (!(v > prev)) { bad = `${fnName}(${x}) = ${v} after ${prev}`; break; } prev = v; }
        return bad;
      };
      const q = attempt(rising);
      check(`3. ${label}: ${fnName} rises strictly at every whole millisecond, from -30 to the end + 30`, !q.err && q.v === null, q.err ? `threw: ${q.err}` : q.v ?? "always rising");
    }
    for (const [c, want, nm] of [[-100, -100, "below 0 is itself"], [ct + 100, ft + 100, "past the end is shifted back"]]) {
      const q = attempt(() => paced(c, rev));
      check(`3. ${label}: paced(${c.toFixed(1)}) ${nm} (${want.toFixed(2)})`, !q.err && near(q.v, want, 1), say(q, (v) => v.toFixed(3)));
    }
    check(`3. ${label}: paced(0) is 0 and paced(${ct.toFixed(2)}) is ${ft}`, near(paced(0, rev), 0, 1) && near(paced(ct, rev), ft, 1), `${paced(0, rev).toFixed(3)}, ${paced(ct, rev).toFixed(3)}`);
  }
  /* paced against the integral directly, so it is not only the inverse of the code's own clockAt */
  {
    const r = attempt(() => {
      let worst = 0, at = 0;
      for (let f = 0; f <= 4800; f += 37) { const e = Math.abs(paced(ref(f)) - f); if (e > worst) { worst = e; at = f; } }
      return { worst, at };
    });
    check("3. paced inverts the integral worked out here (not only the code's own clockAt), within 1 ms", !r.err && r.v.worst <= 1, say(r, (v) => `worst ${v.worst.toFixed(4)} ms at ${v.at}`));
    const q = attempt(() => { let worst = 0, at = 0; for (let d = 0; d <= 4100; d += 37) { const e = Math.abs(paced(refRev(d), true) - d); if (e > worst) { worst = e; at = d; } } return { worst, at }; });
    check("3. the same for the descent (rev), within 1 ms", !q.err && q.v.worst <= 1, say(q, (v) => `worst ${v.worst.toFixed(4)} ms at ${v.at}`));
  }

  /* ---- 4. the descent is the climb run backwards ---- */
  {
    const r = attempt(() => {
      let worst = 0, at = 0;
      for (let c = 0; c <= DOWNT; c += 5.1) {
        const e = Math.abs(mirror(paced(c, true)) - paced(UPT * (1 - c / DOWNT)));
        if (e > worst) { worst = e; at = c; }
      }
      return { worst, at };
    });
    check("4. mirror(paced(c, true)) = paced(UPTIME * (1 - c / DOWNTIME)) for c across 0..DOWNTIME (within 2 ms)", !r.err && r.v.worst <= 2, say(r, (v) => `worst ${v.worst.toFixed(4)} ms at ${v.at.toFixed(1)}`));
    const q = attempt(() => [0, 1000, 2000, 3000, DOWNT].every((c) => near(refMirror(paced(c, true)), paced(UPT * (1 - c / DOWNT)), 2)));
    check("4. ... and the same against the integral's own mirror at five clocks", !q.err && q.v, say(q));
    const s = attempt(() => [0, 250, 900, 2100, 4100].every((d) => near(clockAt(d, true), DOWNT - REV * clockAt(mirror(d)), 1e-6)));
    check("4. clockAt(d, true) = DOWNTIME - REV * clockAt(mirror(d)) at five points", !s.err && s.v, say(s));
  }
}

/* ---- 5. the beat tables ---- */
const warpU = 200, warpD = 700;
const newU = (b) => (b < warpU ? b : warpU + ref(b - warpU));
const newD = (b) => (b < warpD ? b : warpD + refRev(b - warpD));
const { T, D } = tl;
const listed = (beats) => Object.fromEntries(beats.map((x) => [x.act, x.at]));
const asc = attempt(() => listed(tl.ascentBeats()));
const desc = attempt(() => listed(tl.descentBeats()));

const wantT = { warp: 200, mark: 260, release: 430, markOut: 1340, nameOn: 1560, nameOff: 2600, land: 4800, condensed: 6400 };
for (const [k, old] of Object.entries(wantT)) {
  check(`5. T.${k} (was ${old}) is warp + clockAt(${old} - warp) = ${newU(old).toFixed(2)}`, near(T[k], newU(old), 0.1), `${T[k]}`);
}
for (const [k, old] of Object.entries({ warp: 200, mark: 260, release: 430, markOut: 1340, nameOn: 1560, nameOff: 2600, land: 4800 })) {
  const want = k === "warp" ? 200 : newU(old);
  check(`5. the ascent beat "${k}" is at ${want.toFixed(2)}`, !asc.err && near(asc.v[k], want, 0.1), asc.err ? `threw: ${asc.err}` : `${asc.v[k]}`);
}
check("5. the ascent's first beat (arming, at 0) and the warp beat (200) did not move", !asc.err && asc.v.arming === 0 && asc.v.warp === 200, asc.err ? `threw: ${asc.err}` : `arming ${asc.v.arming}, warp ${asc.v.warp}`);
check("5. figures: T.land about 5307.65 and T.condensed 6900", near(T.land, 5307.65, 0.02) && near(T.condensed, 6900, 0.02), `${T.land}, ${T.condensed}`);
/* the settle is a length, not a beat (the host's setting, 1100 ms here): the instrument arrives that long after the
   new landing, and the tour follows by the same unchanged lengths */
const instrumentWant = newU(4800) + 1100;
check(`5. the instrument beat is the new landing plus the settle (${instrumentWant.toFixed(2)}, was 5900)`, !asc.err && near(asc.v.instrument, instrumentWant, 0.1) && near(T.instrumentAt, instrumentWant, 0.1), asc.err ? `threw: ${asc.err}` : `beat ${asc.v.instrument}, T.instrumentAt ${T.instrumentAt}`);
check(`5. T.tourAt follows by the unchanged lengths (${(instrumentWant + 1800 + 450).toFixed(2)}, was 8150)`, near(T.tourAt, instrumentWant + 1800 + 450, 0.1), `${T.tourAt}`);
check("5. lengths that are not beats did not change: dwell 600, instrument 1800, tourGap 450", T.dwell === 600 && T.instrument === 1800 && T.tourGap === 450, `${T.dwell}, ${T.instrument}, ${T.tourGap}`);

const wantD = { withdraw: 0, disperse: 620, warp: 700, release: 1000, nameOn: 2580, nameOff: 3467, markIn: 3655, dusk: 3600, warpOut: 4150, markHome: 5100, farewell: 5350 };
for (const [k, old] of Object.entries(wantD)) {
  check(`5. D.${k} (was ${old}) is ${old < warpD ? "unchanged (before the warp beat)" : `warp + clockAt(${old} - warp, true) = ${newD(old).toFixed(2)}`}`, near(D[k], newD(old), 0.1), `${D[k]}`);
}
for (const k of Object.keys(wantD)) {
  check(`5. the descent beat "${k}" is at ${newD(wantD[k]).toFixed(2)}`, !desc.err && near(desc.v[k], newD(wantD[k]), 0.1), desc.err ? `threw: ${desc.err}` : `${desc.v[k]}`);
}
check("5. figures: D.dusk about 3335.55, D.warpOut 4240.39, D.markHome 5527.08, D.farewell 5777.08", near(D.dusk, 3335.55, 0.02) && near(D.warpOut, 4240.39, 0.02) && near(D.markHome, 5527.08, 0.02) && near(D.farewell, 5777.08, 0.02), `${D.dusk}, ${D.warpOut}, ${D.markHome}, ${D.farewell}`);
check("5. the descent's beats before the warp beat (withdraw 0, disperse 620) did not move", !desc.err && desc.v.withdraw === 0 && desc.v.disperse === 620, desc.err ? `threw: ${desc.err}` : `${desc.v.withdraw}, ${desc.v.disperse}`);

/* the lengths the mark rides for, as the new length of the windows they span */
{
  const up = newU(1340) - newU(260), down = refRev(3878) - refRev(2955);
  check(`5. MARK_RIDE_UP is the new markOut - mark (${up.toFixed(2)}, was 1080)`, near(tl.MARK_RIDE_UP, up, 0.1) && near(tl.MARK_RIDE_UP, T.markOut - T.mark, 0.1), `${tl.MARK_RIDE_UP}`);
  check(`5. MARK_RIDE_DOWN is the new length of descent flight time 2955 to 3878 (${down.toFixed(2)}, was 923)`, near(tl.MARK_RIDE_DOWN, down, 0.1), `${tl.MARK_RIDE_DOWN}`);
}

/* the reduced-motion beats are today's (written out from the code before the change) */
{
  const a = attempt(() => JSON.stringify(tl.ascentBeatsReduced()));
  const d = attempt(() => JSON.stringify(tl.descentBeatsReduced()));
  check("7. the reduced-motion ascent beats are unchanged", !a.err && a.v === '[{"at":0,"act":"release"},{"at":0,"act":"land"},{"at":1300,"act":"instrument"}]', say(a));
  check("7. the reduced-motion descent beats are unchanged", !d.err && d.v === '[{"at":0,"act":"withdraw"},{"at":0,"act":"disperse"},{"at":0,"act":"release"},{"at":0,"act":"dusk"},{"at":0,"act":"farewell"}]', say(d));
}

/* ---- 6. flights played "a second shorter" ---- */
{
  const upRate = 5300 / 4300, downRate = (UPT * (4100 / 4800)) / (UPT * (4100 / 4800) - 1000);
  const chart = jy.docsFlight ? attempt(() => jy.docsFlight({})) : { err: "docsFlight not exported" };
  const flights = [["RIGHT", jy.RIGHT], ["LEFT", jy.LEFT], ["docsFlight(chart)", chart.v]];
  for (const [name, P] of flights) {
    check(`6. ${name} is played at UPTIME / (UPTIME - 1000), a second shorter than the new climb (rate ${upRate.toFixed(6)})`, !!P && near(P.rate, upRate, 1e-6), P ? `rate ${P.rate}` : say(chart));
    const r = P ? attempt(() => door.descentProfile({ from: P })) : { err: "no flight to descend from" };
    check(`6. the descent from ${name} is at DOWNTIME / (DOWNTIME - 1000), a second shorter than the new descent (rate ${downRate.toFixed(6)})`, !r.err && near(r.v.rate, downRate, 1e-6), say(r, (v) => `rate ${v.rate}`));
  }
  const plain = attempt(() => door.descentProfile({ from: UP }));
  check("6/7. the site's own climb and its descent are not shortened (no rate)", UP.rate === undefined && !plain.err && plain.v.rate === undefined, `UP.rate ${UP.rate}, descent rate ${plain.err ? plain.err : plain.v.rate}`);
  check("7. the sideways flights keep their length in flight time (dur 4800) and the descent from one its own (4100)", jy.RIGHT.dur === 4800 && jy.LEFT.dur === 4800 && !!chart.v && chart.v.dur === 4800 && attempt(() => door.descentProfile({ from: jy.RIGHT })).v?.dur === 4100, "dur of RIGHT, LEFT, docs and the descent from RIGHT");
}

console.log(`${total} checks, ${failed ? "some FAILED" : "all ok"}`);
process.exit(failed ? 1 : 0);
