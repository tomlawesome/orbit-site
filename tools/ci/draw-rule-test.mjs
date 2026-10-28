/*
 * Test for #85 batch 2, the worker (ADR-0004 6a.4 and 6a.7, test D3), written from the specification alone: when the
 * worker path is taken. Through assets/door/index.js alone on the stub page (door-stub.mjs), the worker a fake class
 * given as `drawWorker`. With no `flags.draw`, the rule is all of: the host gave `drawWorker` and `fonts`; the GPU gate
 * accepted the page and reports no background shader compile (the Firefox tell); `navigator.userAgentData` is absent;
 * the gate was not forced (`gpu: "force"`); Worker, OffscreenCanvas and canvas.transferControlToOffscreen exist; not
 * under save-data. `draw: "worker"` takes the worker path wherever the host gave `drawWorker` and `fonts`, whatever
 * the rest says; `draw: "page"` never. The console says which, once (`flight: drawn in a worker` / `flight: drawn on
 * the page: <why>`, the latter only when the host gave a worker).
 *
 *   node tools/ci/draw-rule-test.mjs
 *
 *   worker      every condition holds: a worker is made, the line says so, #warp is handed over (no 2D context taken)
 *   page cases  one condition fails at a time (parallel compile; userAgentData; gpu force; save-data; no fonts;
 *               draw=page; and no Worker, no OffscreenCanvas, no transferControlToOffscreen): no worker, the line
 *               names the reason (and the six reasons the spec gives differ), and the page path runs (#warp's 2D
 *               context taken)
 *   forced      draw=worker beats the rule (parallel, userAgentData and gpu force all against it): a worker; but with
 *               no fonts it is the page path, with the line
 *   bare        no drawWorker and no fonts given: no worker and no line at all
 *
 * One fresh Node process a case, on the virtual clock; the worker never answers, which these cases do not need.
 */
import { bootWorkerPage, drawnLines, childMain, runCase, chk, check, finish } from "./door-stub.mjs";

async function scenario(o) {
  const b = await bootWorkerPage(o);
  b.journey.warm({ prove: false }).catch(() => {});
  await b.clock.advance(1000);
  return {
    made: b.host.made, lines: drawnLines(b.page), terminated: b.host.list.reduce((n, w) => n + w.terminated, 0),
    warpTransferred: b.dom.warp.transferred, warpContext: b.dom.warp.gotContext,
  };
}

const CASES = {
  worker: () => scenario({}),
  parallel: () => scenario({ parallel: true }),
  ua: () => scenario({ userAgentData: true }),
  force: () => scenario({ flags: { gpu: "force" } }),
  saveData: () => scenario({ saveData: true }),
  noFonts: () => scenario({ fonts: false }),
  drawPage: () => scenario({ draw: "page" }),
  noWorkerGlobal: () => scenario({ noWorkerGlobal: true }),
  noOffscreen: () => scenario({ noOffscreen: true }),
  noTransfer: () => scenario({ noTransfer: true }),
  forced: () => scenario({ draw: "worker", parallel: true, userAgentData: true, flags: { gpu: "force" } }),
  forcedNoFonts: () => scenario({ draw: "worker", fonts: false }),
  bare: () => scenario({ worker: false, fonts: false }),
};

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
const reasonOf = (r) => { for (const l of r.lines) { const m = /flight: drawn on the page: (.+)$/.exec(l); if (m) return m[1].trim(); } return null; };
const inWorker = (r) => r.lines.some((l) => /flight: drawn in a worker/.test(l));
const REASONS = {
  parallel: /parallel|background|compil|aside|off the (page|main)/i,
  ua: /userAgentData|user.?agent|chrom|family|browser/i,
  force: /force|gpu|gate/i,
  saveData: /save-?data/i,
  noFonts: /font/i,
};

{
  const r = run("worker");
  chk("D3 the rule holds (parallel false, no userAgentData, worker, fonts): a worker is made", r, (r) => [r.made === 1, `workers made ${r.made}`]);
  chk("D3 ... the console says `flight: drawn in a worker`, once, and not the other", r, (r) => [r.lines.filter((l) => /drawn in a worker/.test(l)).length === 1 && !r.lines.some((l) => /drawn on the page/.test(l)), `lines ${show(r.lines)}`]);
  chk("D3 ... #warp is handed over and the page took no 2D context of it", r, (r) => [r.warpTransferred === true && r.warpContext === null, `transferred ${r.warpTransferred}, context ${show(r.warpContext)}`]);
}
const reasons = {};
for (const [name, what] of [["parallel", "the gate compiles in the background (parallel true)"], ["ua", "navigator.userAgentData is defined"], ["force", "gpu is forced"], ["saveData", "save-data is on"],
  ["noFonts", "no fonts are given"], ["drawPage", "draw is \"page\""], ["noWorkerGlobal", "there is no Worker"], ["noOffscreen", "there is no OffscreenCanvas"], ["noTransfer", "canvases cannot be transferred"]]) {
  const r = run(name);
  chk(`D3 ${what}: no worker is made`, r, (r) => [r.made === 0 && !inWorker(r), `workers made ${r.made}, lines ${show(r.lines)}`]);
  chk(`D3 ${what}: the console says \`flight: drawn on the page: <why>\``, r, (r) => {
    const why = reasonOf(r);
    reasons[name] = why;
    return [!!why && (!REASONS[name] || REASONS[name].test(why)), `lines ${show(r.lines)}`];
  });
  chk(`D3 ${what}: the page path runs (#warp gives its 2D context, nothing is handed over)`, r, (r) => [r.warpContext === "2d" && r.warpTransferred === false, `transferred ${r.warpTransferred}, context ${show(r.warpContext)}`]);
}
{
  const six = ["parallel", "ua", "force", "saveData", "noFonts", "drawPage"].map((k) => reasons[k]);
  check("D3 the reasons named for the six conditions differ from one another", six.every(Boolean) && new Set(six.map((s) => s.toLowerCase())).size === 6, show(six));
}
{
  const r = run("forced");
  chk("D3 draw=worker beats the rule (parallel, userAgentData and gpu force all against it): a worker", r, (r) => [r.made === 1 && inWorker(r), `workers made ${r.made}, lines ${show(r.lines)}`]);
  const f = run("forcedNoFonts");
  chk("D3 draw=worker without fonts is the page path, with the line", f, (r) => [r.made === 0 && !!reasonOf(r) && /font/i.test(reasonOf(r)) && r.warpContext === "2d", `workers made ${r.made}, lines ${show(r.lines)}, context ${show(r.warpContext)}`]);
  const b = run("bare");
  chk("D3 no drawWorker and no fonts given: no worker and no line about where it is drawn", b, (r) => [r.made === 0 && r.lines.length === 0 && r.warpContext === "2d", `workers made ${r.made}, lines ${show(r.lines)}, context ${show(r.warpContext)}`]);
}
finish();
