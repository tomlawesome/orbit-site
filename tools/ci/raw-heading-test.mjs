/*
 * Test for raw html headings in the docs import. A markdown heading
 * (`## Raw title`) comes out of the import with an id, a "#" anchor link and
 * an entry in the page's table of contents (the section's id and title for an
 * h2, the section's `subs` for an h3, and the search index). A heading written
 * as raw html in the markdown source (`<h2>Raw title</h2>`, h2 to h6) must get
 * the same id (same rule, same numbering for repeats), the same anchor and
 * the same table-of-contents entry. A hostile attribute on it must not
 * survive, and the id must be the import's own.
 *
 *   npm ci --prefix tools --ignore-scripts && node tools/ci/raw-heading-test.mjs
 *
 * The import writes into assets/docs next to tools/, so this runs a COPY of
 * the import's four files in a scratch folder, over a fixture source read
 * with --from. Nothing in the repository is written. Needs `marked`. No network.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const tools = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(tools, "node_modules", "marked"))) {
  check("marked is installed", false, "run: npm ci --prefix tools --ignore-scripts");
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "raw-heading-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const copy = join(scratch, "tools");
mkdirSync(copy);
for (const f of ["import-docs.mjs", "import-docs-lib.mjs", "sanitise-html.mjs"]) cpSync(join(tools, f), join(copy, f));
/* the import checks its own output with the publish job's markup check */
mkdirSync(join(copy, "ci"));
cpSync(join(tools, "ci", "docs-markup.mjs"), join(copy, "ci", "docs-markup.mjs"));
symlinkSync(join(tools, "node_modules"), join(copy, "node_modules"));
const src = { slug: "readme", name: "README", c: "#d8b45a", repo: "tomlawesome/orbit", path: "README.md", title: "Orbit" };
writeFileSync(join(copy, "docs-sources.json"), JSON.stringify([src]));

let n = 0;
/* import one markdown source; gives the page (as written to assets/docs/readme.json) and the index entry */
const run = (md) => {
  const root = join(scratch, `src${n++}`);
  mkdirSync(root);
  writeFileSync(join(root, "README.md"), md);
  rmSync(join(scratch, "assets"), { recursive: true, force: true });
  const r = spawnSync(process.execPath, [join(copy, "import-docs.mjs"), "--from", root], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) return { error: `import exited ${r.status}: ${(r.stderr || r.stdout).slice(0, 300)}` };
  const out = join(scratch, "assets", "docs");
  return {
    page: JSON.parse(readFileSync(join(out, "readme.json"), "utf8")),
    index: JSON.parse(readFileSync(join(out, "index.json"), "utf8")).sources[0],
  };
};

/* the heading element of a given depth in a page's html, with its anchor, as one string */
const headingsOf = (page, depth) => page.sections.map((s) => s.html).join("")
  .match(new RegExp(`<h${depth}\\b[^>]*>[\\s\\S]*?</h${depth}>`, "g"))?.map((h) => h.trim()) ?? [];
const toc = (r) => JSON.stringify({
  sections: r.page.sections.map((s) => ({ id: s.id, title: s.title, subs: s.subs })),
  index: r.index.sections.map((s) => ({ id: s.id, title: s.title, subs: s.subs })),
});

const wrap = (heading, after = "") => `# Orbit\n\nOpening words.\n\n## First\n\nSome text.\n\n${heading}\n\nBody under the heading.\n\n${after}`;

/* control: the markdown form gives the expected id, anchor and TOC entry */
const md2 = run(wrap("## Raw title"));
if (md2.error) { check("control: markdown ## Raw title imports", false, md2.error); process.exit(1); }
{
  const h = headingsOf(md2.page, 2).find((x) => x.includes("Raw title")) ?? "";
  const want = '<h2 id="raw-title"><a class="anchor" href="#docs/readme/raw-title" aria-label="Link to this heading">#</a>Raw title</h2>';
  check("control: markdown h2 has id, anchor", h === want, `gave ${JSON.stringify(h)} (want ${JSON.stringify(want)})`);
  const s = md2.page.sections.find((x) => x.id === "raw-title");
  check("control: markdown h2 is a section with id raw-title and title Raw title", !!s && s.title === "Raw title",
    `sections: ${JSON.stringify(md2.page.sections.map((x) => [x.id, x.title]))}`);
  const i = md2.index.sections.find((x) => x.id === "raw-title");
  check("control: markdown h2 is in the search index", !!i && i.title === "Raw title", `index: ${JSON.stringify(md2.index.sections.map((x) => [x.id, x.title]))}`);
}
const md3 = run(wrap("## Parent\n\n### Raw title"));
check("control: markdown h3 is in its section's subs", JSON.stringify(md3.page?.sections.find((x) => x.id === "parent")?.subs) === JSON.stringify([{ id: "raw-title", title: "Raw title" }]),
  `gave ${JSON.stringify(md3.page?.sections.map((x) => [x.id, x.subs]))} (want parent with subs [{id: raw-title, title: Raw title}])`);

/* the raw form, h2 to h6, must give exactly what the markdown form gives */
for (let d = 2; d <= 6; d++) {
  const mdSrc = d === 2 ? wrap("## Raw title") : wrap(`## Parent\n\n${"#".repeat(d)} Raw title`);
  const rawSrc = d === 2 ? wrap("<h2>Raw title</h2>") : wrap(`## Parent\n\n<h${d}>Raw title</h${d}>`);
  const m = run(mdSrc), r = run(rawSrc);
  if (m.error || r.error) { check(`h${d}: both forms import`, false, m.error || r.error); continue; }
  const mh = headingsOf(m.page, d).find((x) => x.includes("Raw title")) ?? "";
  const rh = headingsOf(r.page, d).find((x) => x.includes("Raw title")) ?? "";
  check(`h${d}: raw heading has the markdown heading's id and anchor`, rh === mh && mh !== "", `raw gave ${JSON.stringify(rh)} (want ${JSON.stringify(mh)})`);
  check(`h${d}: raw heading has the markdown heading's table-of-contents entry`, toc(r) === toc(m), `raw toc ${toc(r)} (want ${toc(m)})`);
}

/* a markdown heading and a raw one with the same text share one numbering */
{
  const r = run(wrap("## Raw title", "<h3>Raw title</h3>\n\n### Raw title\n"));
  const hs = r.error ? [] : headingsOf(r.page, 3);
  const ids = hs.map((h) => /id="([^"]*)"/.exec(h)?.[1]);
  check("repeats: after an h2 Raw title, a raw h3 and a markdown h3 of the same text get raw-title-1 and raw-title-2, anchors to match",
    JSON.stringify(ids) === JSON.stringify(["raw-title-1", "raw-title-2"]) && hs.every((h) => h.includes(`href="#docs/readme/${/id="([^"]*)"/.exec(h)[1]}"`)),
    r.error || `ids ${JSON.stringify(ids)} (want the h2 "Raw title" to take raw-title, then raw-title-1 and raw-title-2 for the two h3, each with a matching anchor href)`);
}

/* hostile attributes: no handler, and the import's own id, never "evil" */
{
  const r = run(wrap('<h2 onclick=x id="evil">Raw title</h2>'));
  if (r.error) check("hostile: imports", false, r.error);
  else {
    const all = r.page.sections.map((s) => s.html).join("");
    check("hostile: no onclick survives", !/onclick/i.test(all), `html holds ${JSON.stringify(all.match(/<h2[^>]*onclick[^>]*>/i)?.[0] ?? "")}`);
    check("hostile: the supplied id evil does not survive", !/evil/.test(all), `html holds ${JSON.stringify(all.match(/<h2[^>]*evil[^>]*>/)?.[0] ?? "")}`);
    const mh = headingsOf(md2.page, 2).find((x) => x.includes("Raw title")) ?? "";
    const rh = headingsOf(r.page, 2).find((x) => x.includes("Raw title")) ?? "";
    check("hostile: the heading still has the import's own id and anchor", rh === mh && mh !== "", `gave ${JSON.stringify(rh)} (want ${JSON.stringify(mh)})`);
    check("hostile: the heading is still in the table of contents under the import's id", toc(r) === toc(md2), `gave ${toc(r)} (want ${toc(md2)})`);
  }
}

process.exit(failed ? 1 : 0);
