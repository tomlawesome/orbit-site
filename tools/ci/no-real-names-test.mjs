/*
 * Test for the matchers in tools/ci/no-real-names.mjs (#56), with invented
 * words only: no digests, no real names, logins or addresses. Addresses are
 * built from parts so this file holds no dotted quad the guard would flag.
 *
 *   node tools/ci/no-real-names-test.mjs
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IPV4, isPrivateOrShared, loginsOf, scan, wordsOf } from "./no-real-names.mjs";
import * as guard from "./no-real-names.mjs";

let failed = false;
let count = 0;
const check = (name, ok, detail) => { count++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`); if (!ok) failed = true; };
const has = (set, words) => words.every((w) => set.has(w));
const show = (set) => JSON.stringify([...set]);
const quad = (...o) => o.join(".");
// the addresses in a line that the guard would flag
const flagged = (line) => [...line.matchAll(IPV4)].map((m) => m[0]).filter(isPrivateOrShared);

// wordsOf
check("wordsOf: plural", has(wordsOf("the Brightwells met"), ["brightwell"]), show(wordsOf("the Brightwells met")));
check("wordsOf: possessive", has(wordsOf("the Brightwells' boiler"), ["brightwell"]), show(wordsOf("the Brightwells' boiler")));
check("wordsOf: upper-case plural", has(wordsOf("BRIGHTWELLS"), ["brightwell"]), show(wordsOf("BRIGHTWELLS")));
check("wordsOf: camelCase run", has(wordsOf("const brightwellItems = []"), ["brightwell", "items"]), show(wordsOf("const brightwellItems = []")));
check("wordsOf: UPPER_SNAKE run", has(wordsOf("BRIGHTWELL_ITEMS"), ["brightwell"]), show(wordsOf("BRIGHTWELL_ITEMS")));
check("wordsOf: bare word", has(wordsOf("brightwell"), ["brightwell"]), show(wordsOf("brightwell")));
check("wordsOf: does not join separate words", !wordsOf("bright well").has("brightwell"), show(wordsOf("bright well")));
check("wordsOf: a longer word containing it is one token", !wordsOf("brightwellness.example").has("brightwell"), show(wordsOf("brightwellness.example")));

// loginsOf
check("loginsOf: sentence-ending dot after /home", has(loginsOf("files live in /home/alex."), ["alex"]), show(loginsOf("files live in /home/alex.")));
check("loginsOf: sentence-ending dot after ~login", has(loginsOf("under ~alex."), ["alex"]), show(loginsOf("under ~alex.")));
check("loginsOf: suffix after a dash", has(loginsOf("/home/alex-old"), ["alex"]), show(loginsOf("/home/alex-old")));
check("loginsOf: dashed login ending a sentence", has(loginsOf("files live in /home/al-ex."), ["al-ex"]), show(loginsOf("files live in /home/al-ex.")));
check("loginsOf: dotted login ending a sentence", has(loginsOf("under ~al.ex."), ["al.ex"]), show(loginsOf("under ~al.ex.")));
check("loginsOf: /home path", has(loginsOf("/home/alex/projects"), ["alex"]), show(loginsOf("/home/alex/projects")));
check("loginsOf: /Users path", has(loginsOf("/Users/alex/Library"), ["alex"]), show(loginsOf("/Users/alex/Library")));
check("loginsOf: lower-case Windows path", has(loginsOf("c:\\users\\alex\\x"), ["alex"]), show(loginsOf("c:\\users\\alex\\x")));
check("loginsOf: all-caps Windows path", has(loginsOf("C:\\USERS\\alex\\x"), ["alex"]), show(loginsOf("C:\\USERS\\alex\\x")));
check("loginsOf: escaped Windows path", has(loginsOf("C:\\\\Users\\\\alex\\\\x"), ["alex"]), show(loginsOf("C:\\\\Users\\\\alex\\\\x")));
check("loginsOf: ignores a path with no leading slash", loginsOf("home/alex").size === 0, show(loginsOf("home/alex")));
check("loginsOf: ignores a tilde inside a word", loginsOf("a~alex").size === 0, show(loginsOf("a~alex")));

// IPv4
check("ipv4: ignores a version string", flagged("node 10.1.2.3.4 and v1.2.3.4").length === 0, JSON.stringify(flagged("node 10.1.2.3.4 and v1.2.3.4")));
check("ipv4: ignores documentation range 192.0.2.x", flagged(`at ${quad(192, 0, 2, 7)}`).length === 0, "flagged");
check("ipv4: ignores documentation range 198.51.100.x", flagged(`at ${quad(198, 51, 100, 7)}`).length === 0, "flagged");
check("ipv4: ignores documentation range 203.0.113.x", flagged(`at ${quad(203, 0, 113, 7)}`).length === 0, "flagged");
check("ipv4: ignores a public address", flagged(`at ${quad(8, 8, 8, 8)}`).length === 0, "flagged");
check("ipv4: ignores an octet over 255", flagged(`at ${quad(10, 300, 1, 1)}`).length === 0, "flagged");
check("ipv4: flags 10/8", flagged(`at ${quad(10, 1, 2, 3)}`).length === 1, "not flagged");
check("ipv4: flags 172.16/12 (both ends)", flagged(`${quad(172, 16, 0, 1)} ${quad(172, 31, 255, 1)}`).length === 2, "not flagged");
check("ipv4: ignores 172.15 and 172.32", flagged(`${quad(172, 15, 0, 1)} ${quad(172, 32, 0, 1)}`).length === 0, "flagged");
check("ipv4: flags 192.168/16", flagged(`at ${quad(192, 168, 1, 5)}`).length === 1, "not flagged");
check("ipv4: flags 100.64/10 (both ends)", flagged(`${quad(100, 64, 0, 1)} ${quad(100, 127, 255, 1)}`).length === 2, "not flagged");
check("ipv4: ignores 100.63 and 100.128", flagged(`${quad(100, 63, 0, 1)} ${quad(100, 128, 0, 1)}`).length === 0, "flagged");

// bannedEmail (commit author/committer addresses): digests only, never a real address.
// Read through the namespace so a missing export fails these checks, not the whole file.
const invented = ["pat", "nobody"].join(".") + "@" + ["mail", "invalid"].join(".");
const inventedDigest = createHash("sha256").update(invented.toLowerCase()).digest("hex");
const bannedEmail = guard.bannedEmail;
check("bannedEmail: is exported as a function", typeof bannedEmail === "function", typeof bannedEmail);
check("bannedEmail: returns a boolean for an invented address", typeof bannedEmail === "function" && typeof bannedEmail(invented) === "boolean", String(typeof bannedEmail === "function" && typeof bannedEmail(invented)));
check("bannedEmail: an invented address is not banned", typeof bannedEmail === "function" && bannedEmail(invented) === false, "banned or missing");
check("bannedEmail: an invented address in capitals is not banned", typeof bannedEmail === "function" && bannedEmail(invented.toUpperCase()) === false, "banned or missing");
const digests = guard.BANNED_EMAILS;
check("BANNED_EMAILS: is an exported Set", digests instanceof Set, String(digests));
check("BANNED_EMAILS: holds at least 2 entries", digests instanceof Set && digests.size >= 2, String(digests && digests.size));
check("BANNED_EMAILS: every entry is 64 lower-case hex characters", digests instanceof Set && [...digests].every((d) => typeof d === "string" && /^[0-9a-f]{64}$/u.test(d)), "bad entry or missing");
check("BANNED_EMAILS: does not hold the digest of an invented address", digests instanceof Set && !digests.has(inventedDigest), "present or missing");

// scan reports file:line only
const hits = scan([{ name: "a.txt", text: `fine\nunder ${quad(10, 1, 2, 3)} here\n` }, { name: "b.txt", text: "nothing\n" }]);
check("scan: reports file:line and nothing else", hits.length === 1 && hits[0] === "a.txt:2", JSON.stringify(hits));


// loginsOf (#60 item 8): "/home" is matched in any case, and the login ends at the first character that is not a
// letter or digit, or at the end of the text
check("loginsOf: /home/<login> ending the text", has(loginsOf("/home/alex"), ["alex"]), show(loginsOf("/home/alex")));
check("loginsOf: upper-case /HOME", has(loginsOf("/HOME/alex"), ["alex"]), show(loginsOf("/HOME/alex")));
check("loginsOf: mixed-case /Home", has(loginsOf("see /Home/alex/x"), ["alex"]), show(loginsOf("see /Home/alex/x")));
check("loginsOf: suffix after an underscore", has(loginsOf("/home/alex_old"), ["alex"]), show(loginsOf("/home/alex_old")));
check("loginsOf: suffix after a dash, no other text", has(loginsOf("/home/alex-old"), ["alex"]), show(loginsOf("/home/alex-old")));
check("loginsOf: a longer login is not the shorter one", !loginsOf("/home/alexxyz").has("alex"), show(loginsOf("/home/alexxyz")));
check("loginsOf: a longer login after /HOME is not the shorter one", !loginsOf("/HOME/alexxyz/x").has("alex"), show(loginsOf("/HOME/alexxyz/x")));

// IPv4 link-local 169.254/16 (#60 item 9)
check("ipv4: flags 169.254/16 (both ends)", flagged(`${quad(169, 254, 0, 1)} ${quad(169, 254, 255, 254)}`).length === 2, "not flagged");
check("ipv4: ignores 169.253 and 169.255", flagged(`${quad(169, 253, 1, 1)} ${quad(169, 255, 1, 1)}`).length === 0, "flagged");

// The probes below run the guard in a child process with a clean environment (no NO_REAL_NAMES_* variables, so
// they judge the built-in sets and give the same answer under the lint-test runs that plant digests), or with
// exactly the variables given. The module is read through its exports only.
const guardUrl = new URL("./no-real-names.mjs", import.meta.url).href;
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const cleanEnv = () => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("NO_REAL_NAMES_")) delete e[k];
  return e;
};
const CHILD = `
const g = await import(process.env.PROBE_URL);
const p = JSON.parse(process.env.PROBE_INPUT);
const hex = /^[0-9a-f]{64}$/;
const shape = (x) => {
  if (x === undefined || x === null) return { kind: "missing" };
  let entries;
  if (x instanceof Set) entries = [...x];
  else if (Array.isArray(x)) entries = x;
  else if (x instanceof Map) entries = [...x].map(([k, v]) => (typeof v === "string" && hex.test(v) ? v : k));
  else if (typeof x === "object") entries = Object.values(x);
  else return { kind: typeof x };
  return { kind: "ok", size: entries.length, entries };
};
const out = {};
if (p.shapes) for (const n of ["BANNED_WORDS", "BANNED_LOGINS", "BANNED_EMAILS", "KEPT"]) out[n] = shape(g[n]);
if (p.files) out.hits = g.scan(p.files);
console.log(JSON.stringify(out));
`;
function probe(input, extraEnv = {}) {
  try {
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", CHILD], {
      env: { ...cleanEnv(), PROBE_URL: guardUrl, PROBE_INPUT: JSON.stringify(input), ...extraEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch (e) {
    return { error: String(e.stderr || e.message).split("\n").find((l) => l.trim()) || "failed" };
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Built-in digest sets (#60 item 2): exact counts, every entry 64 lower-case hex
const shapes = probe({ shapes: true });
for (const [name, n] of [["BANNED_WORDS", 1], ["BANNED_LOGINS", 2], ["BANNED_EMAILS", 2], ["KEPT", 1]]) {
  const s = shapes[name];
  check(`${name}: is exported and readable`, !!s && s.kind === "ok", JSON.stringify(s ?? shapes));
  check(`${name}: holds exactly ${n} built-in ${n === 1 ? "entry" : "entries"}`, !!s && s.size === n, JSON.stringify(s ? s.size : shapes));
  check(`${name}: every entry is 64 lower-case hex characters`, !!s && s.kind === "ok" && s.size > 0 && s.entries.every((d) => typeof d === "string" && /^[0-9a-f]{64}$/u.test(d)), JSON.stringify(s ?? shapes));
}

// Extra digests from the environment, one variable per category (#60 item 1). Invented values only.
const W = "zyx" + "wordq"; // built from parts, so this file holds no planted value
const L = "zyx" + "loginq";
const E = ["zyx.probe", "example.invalid"].join("@");
const extra = {
  NO_REAL_NAMES_EXTRA_WORD_DIGESTS: sha(W),
  NO_REAL_NAMES_EXTRA_LOGIN_DIGESTS: sha(L),
  NO_REAL_NAMES_EXTRA_EMAIL_DIGESTS: sha(E),
};
const run = (text, env = extra) => probe({ files: [{ name: "f.txt", text }] }, env).hits;
const hitsAre = (name, text, want, env = extra) => { const h = run(text, env); check(name, same(h, want), JSON.stringify(h ?? "no result")); };

// word variable
hitsAre("extra words: a bare word is reported as file:line", `fine\nthe ${W} case\nfine\n`, ["f.txt:2"]);
hitsAre("extra words: plural and possessive", `${W[0].toUpperCase()}${W.slice(1)}s\nthe ${W}s' boiler\n`, ["f.txt:1", "f.txt:2"]);
hitsAre("extra words: camelCase and UPPER_SNAKE runs", `const ${W}Items = 1\n${W.toUpperCase()}_ITEMS\n`, ["f.txt:1", "f.txt:2"]);
hitsAre("extra words: not set, the same text is clean", `${W}\n/home/${L}\n${E}\n`, [], {});
hitsAre("extra words: only the word variable set, logins and emails stay clean", `/home/${L}\n${E}\n`, [], { NO_REAL_NAMES_EXTRA_WORD_DIGESTS: sha(W) });
hitsAre("extra words: several digests, comma-separated", `${W}\nzyxwordp\nunrelated\n`, ["f.txt:1", "f.txt:2"], { NO_REAL_NAMES_EXTRA_WORD_DIGESTS: `${sha("zyxwordp")},${sha(W)}` });
hitsAre("extra words: a longer word is another word", `${W}ness\n`, []);

// login variable
hitsAre("extra logins: /home/<login> is reported as file:line", `fine\nunder /home/${L}/work\n`, ["f.txt:2"]);
hitsAre("extra logins: ~<login> with a sentence-ending dot", `under ~${L}.\n`, ["f.txt:1"]);
hitsAre("extra logins: /HOME/<login> in capitals", `/HOME/${L}\n`, ["f.txt:1"]);
hitsAre("extra logins: /home/<login> ending the text with no newline", `a\n/home/${L}`, ["f.txt:2"]);
hitsAre("extra logins: /home/<login>-old and /home/<login>_old", `/home/${L}-old\n/home/${L}_old\n`, ["f.txt:1", "f.txt:2"]);
hitsAre("extra logins: a longer login is not reported", `/home/${L}xyz\n/HOME/${L}xyz/x\n`, []);
hitsAre("extra logins: only the login variable set, words and emails stay clean", `${W}\n${E}\n`, [], { NO_REAL_NAMES_EXTRA_LOGIN_DIGESTS: sha(L) });
hitsAre("extra logins: not set, /home/<login> is clean", `/home/${L}\n`, [], {});

// email variable, and tracked text checked against the banned email digests (#60 item 3)
hitsAre("extra emails: an address in text is reported as file:line", `fine\nwrite to ${E} now\n`, ["f.txt:2"]);
hitsAre("extra emails: case-insensitive", `Write to ${E.toUpperCase()} now\n${E[0].toUpperCase()}${E.slice(1)}\n`, ["f.txt:1", "f.txt:2"]);
hitsAre("extra emails: in angle brackets and after mailto:", `Pat <${E}>\nmailto:${E}?subject=x\n`, ["f.txt:1", "f.txt:2"]);
hitsAre("extra emails: before a sentence-ending dot", `Write to ${E}.\n`, ["f.txt:1"]);
hitsAre("extra emails: another address is clean", `other.person@example.invalid\n${E.replace("@", "x@")}\n`, []);
hitsAre("extra emails: not set, the address is clean", `${E}\n`, [], {});
hitsAre("extra emails: only the email variable set, words and logins stay clean", `${W}\n/home/${L}\n`, [], { NO_REAL_NAMES_EXTRA_EMAIL_DIGESTS: sha(E) });

// a hit is "file:line" and nothing else, so no value reaches a public log
const leak = run(`${W} /home/${L} ${E}\n`);
check("extra digests: a hit never carries the value", Array.isArray(leak) && leak.length > 0 && leak.every((h) => /^f\.txt:\d+$/u.test(h)), JSON.stringify(leak ?? "no result"));

// IPv6 private addresses (#60 item 9), built from parts so this file holds no literal one
const v6 = (...g) => g.join(":");
hitsAre("ipv6: flags a unique-local address", `fine\nat ${v6("fd7a", "115c", "", "1")} here\n`, ["f.txt:2"], {});
hitsAre("ipv6: flags the unique-local range, fc00 to fdff (both ends)", `${v6("fc00", "", "1")}\n${v6("fdff", "ffff", "", "1")}\n`, ["f.txt:1", "f.txt:2"], {});
hitsAre("ipv6: flags unique-local in capitals", `${v6("FD7A", "115C", "", "1")}\n`, ["f.txt:1"], {});
hitsAre("ipv6: flags unique-local in brackets with a port", `http://[${v6("fd7a", "115c", "", "1")}]:8080/x\n`, ["f.txt:1"], {});
hitsAre("ipv6: flags unique-local written in full", `${v6("fd7a", "115c", "a1e0", "0", "0", "0", "0", "1")}\n`, ["f.txt:1"], {});
hitsAre("ipv6: flags the link-local range, fe80 to febf (both ends)", `${v6("fe80", "", "1")}\n${v6("febf", "", "1")}\n`, ["f.txt:1", "f.txt:2"], {});
hitsAre("ipv6: ignores just outside the unique-local and link-local ranges", `${v6("fbff", "", "1")}\n${v6("fe00", "", "1")}\n${v6("fec0", "", "1")}\n`, [], {});
hitsAre("ipv6: ignores the documentation range 2001:db8::/32", `${v6("2001", "db8", "", "1")}\n${v6("2001", "0db8", "1", "2", "3", "4", "5", "6")}\n`, [], {});
hitsAre("ipv6: ignores times of day", "at 12:34:56 on 2026-10-14T10:20:30Z\n", [], {});
hitsAre("ipv4: link-local 169.254.x.x in text is reported as file:line", `fine\nat ${quad(169, 254, 7, 7)}\n`, ["f.txt:2"], {});
hitsAre("ipv4: documentation range stays allowed in text", `at ${quad(192, 0, 2, 7)} and ${quad(198, 51, 100, 7)} and ${quad(203, 0, 113, 7)}\n`, [], {});

// File and directory paths (#60 item 5): a hit reports the path with the offending part masked as *** and the
// category, never the value, because CI logs are public. Invented values only, distinct from the ones above.
const PW = "qxvpathword";
const PL = "qxvpathlogin";
const PATHS_CHILD = `
const g = await import(process.env.PROBE_URL);
console.log(JSON.stringify(typeof g.scanPaths === "function" ? g.scanPaths(JSON.parse(process.env.PROBE_INPUT)) : null));
`;
function pathProbe(names, env = { NO_REAL_NAMES_EXTRA_WORD_DIGESTS: sha(PW), NO_REAL_NAMES_EXTRA_LOGIN_DIGESTS: sha(PL) }) {
  try {
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", PATHS_CHILD], {
      env: { ...cleanEnv(), PROBE_URL: guardUrl, PROBE_INPUT: JSON.stringify(names), ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch { return null; }
}
// one report per path; true when it shows MASKED, names CATEGORY and holds none of the HIDDEN values (any case)
const masked = (reports, want, category, hidden) => Array.isArray(reports) && reports.length === 1 && typeof reports[0] === "string"
  && reports[0].includes(want) && reports[0].includes(category) && hidden.every((v) => !reports[0].toLowerCase().includes(v.toLowerCase()));
const pathCase = (name, paths, want, category, hidden, env) => {
  const r = pathProbe(paths, env);
  // the detail shows only whether a hidden value leaked, never the report itself
  check(name, masked(r, want, category, hidden), Array.isArray(r) ? `${r.length} report(s), want 1 showing ${want} and ${category}` : "scanPaths missing or failed");
};
check("scanPaths: is exported as a function", pathProbe([]) !== null, "missing or failed");
pathCase("scanPaths: a banned word in a directory name is masked", ["docs/" + PW + "/notes.txt"], "docs/***/notes.txt", "word", [PW]);
pathCase("scanPaths: a banned word in a file name is masked", ["docs/notes-" + PW.toUpperCase() + ".txt"], "docs/notes-***.txt", "word", [PW]);
pathCase("scanPaths: a banned login in home/<login> is masked", ["home/" + PL + "/x.txt"], "home/***/x.txt", "login", [PL]);
pathCase("scanPaths: a private address in a file name is masked", ["docs/host-" + quad(10, 0, 0, 7) + ".txt"], "docs/host-***.txt", "private address", [quad(10, 0, 0, 7)], {});
{
  const r = pathProbe(["docs/notes.txt", "docs/host-" + quad(192, 0, 2, 7) + ".txt", "home/" + PL + "xyz/x.txt"]);
  check("scanPaths: clean paths, a documentation address and a longer login are not reported", Array.isArray(r) && r.length === 0, Array.isArray(r) ? `${r.length} report(s)` : "missing or failed");
  const u = pathProbe(["docs/" + PW + "/notes.txt", "home/" + PL + "/x.txt"], {});
  check("scanPaths: without the digests the same paths are not reported", Array.isArray(u) && u.length === 0, Array.isArray(u) ? `${u.length} report(s)` : "missing or failed");
}

// ---- Round 3 (#60 re-review, specs/names-r3.md). Invented values only, built from parts.

// Item 1: no report ever prints a raw path holding a banned value. A file whose path AND content both hold a banned
// value must give reports with none of it anywhere, and the banned part shown as ***.
const addr7 = quad(10, 0, 0, 7);
const hitsFor = (files, env) => { const r = probe({ files }, env); return Array.isArray(r.hits) ? r.hits : null; };
const noLeak = (name, files, env, hidden) => {
  const h = hitsFor(files, env);
  const leaked = Array.isArray(h) && h.some((x) => hidden.some((v) => x.toLowerCase().includes(v.toLowerCase())));
  check(name, Array.isArray(h) && h.length > 0 && !leaked && h.every((x) => x.includes("***")),
    h === null ? "no result" : h.length === 0 ? "nothing reported" : leaked ? "a report holds the banned value" : "a report has no *** mask");
};
const envWL = { NO_REAL_NAMES_EXTRA_WORD_DIGESTS: sha(W), NO_REAL_NAMES_EXTRA_LOGIN_DIGESTS: sha(L), NO_REAL_NAMES_EXTRA_EMAIL_DIGESTS: sha(E) };
noLeak("scan report: a banned word in a directory name is masked when the content also hits", [{ name: `docs/${W}/notes.txt`, text: `the ${W} case\n` }], envWL, [W]);
noLeak("scan report: a banned word in a file name is masked when the content also hits", [{ name: `docs/notes-${W}.txt`, text: `the ${W} case\n` }], envWL, [W]);
noLeak("scan report: a banned word in capitals in a path is masked", [{ name: `docs/${W.toUpperCase()}/notes.txt`, text: `the ${W} case\n` }], envWL, [W]);
noLeak("scan report: home/<login> in a path is masked when the content also hits", [{ name: `home/${L}/x.txt`, text: `under /home/${L}/work\n` }], envWL, [L]);
noLeak("scan report: a private address in a file name is masked when the content also hits", [{ name: `docs/host-${addr7}.txt`, text: `host ${addr7}\n` }], {}, [addr7]);
noLeak("scan report: a private address in a directory name is masked when the content also hits", [{ name: `docs/${addr7}/notes.txt`, text: `host ${addr7}\n` }], {}, [addr7]);
noLeak("scan report: a banned email in a file name is masked when the content also hits", [{ name: `docs/${E}.txt`, text: `write to ${E}\n` }], envWL, [E]);
{
  const h = hitsFor([{ name: `docs/${W}/notes.txt`, text: `fine\nthe ${W} case\nfine\nthe ${W}s again\n` }], envWL);
  check("scan report: each hit in a masked path still ends with its own line number", Array.isArray(h) && h.length === 2 && /:2$/u.test(h[0]) && /:4$/u.test(h[1]) && h.every((x) => !x.toLowerCase().includes(W)), JSON.stringify(h && h.map((x) => x.replace(W, "?"))));
}
check("scan report: a clean path keeps its name in full", same(hitsFor([{ name: "docs/notes.txt", text: `the ${W} case\n` }], envWL), ["docs/notes.txt:1"]), "name changed");

// Item 2: email matching is linear. One 200,000-letter line with no @ must be scanned in under 2 s. The text is built
// inside the child process (an environment variable cannot carry 200,000 characters), which times scan itself.
const SPEED_CHILD = `
const g = await import(process.env.PROBE_URL);
const text = process.env.PROBE_SHAPE === "letters" ? "a".repeat(200000) + "\\n" : "ab.".repeat(33333) + "\\n" + "x-".repeat(50000) + "\\n";
const t0 = Date.now();
const hits = g.scan([{ name: "f.txt", text }]);
console.log(JSON.stringify({ ms: Date.now() - t0, hits }));
`;
const speedProbe = (shape) => {
  try {
    const t0 = Date.now();
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", SPEED_CHILD], {
      env: { ...cleanEnv(), PROBE_URL: guardUrl, PROBE_SHAPE: shape, ...envWL },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000,
    });
    return { ...JSON.parse(stdout.trim().split("\n").pop()), wall: Date.now() - t0 };
  } catch (e) { return { error: String(e.message).split("\n")[0], ms: 99999 }; }
};
for (const [label, shape] of [["a 200,000-letter line with no @", "letters"], ["200,000 characters of letters and separators with no @", "mixed"]]) {
  const r = speedProbe(shape);
  check(`scan speed: ${label} is clean and takes under 2 s`, r.error === undefined && same(r.hits, []) && r.ms < 2000, r.error ?? `${r.ms} ms, result ${JSON.stringify(r.hits)}`);
}

// Item 3: a banned address is found however it is glued into text, in any letter case.
const [eLocal, eDomain] = E.split("@");
const glued = [
  ["after a path and a dash", `docs/notes-${E}`],
  ["after a dash", `-${E}`],
  ["after a letter run and an underscore", `abc_${E}`],
  ["after a digit run and a dot", `123.${E}`],
  ["after a letter run and a plus", `abc+${E}`],
  ["after a letter run and a percent sign", `abc%${E}`],
  ["after a percent sign", `%${E}`],
  ["between underscores", `_${E}_`],
  ["as a file name with an extension", `docs/${E}.txt`],
  ["before a sentence word joined by a dot", `${E}.Thanks`],
  ["before a dash and letters", `${E}-abc`],
  ["before an underscore and a digit", `${E}_2`],
  ["before a plus and a tag", `${E}+tag`],
  ["percent-encoded @", `${eLocal}%40${eDomain}`],
  ["percent-encoded @ in a mailto link", `mailto:${eLocal}%40${eDomain}?subject=x`],
  ["percent-encoded angle brackets", `%3C${E}%3E`],
  ["percent-encoded angle brackets in lower case", `%3c${E}%3e`],
  ["percent-encoded angle brackets and @", `%3C${eLocal}%40${eDomain}%3E`],
  ["in capitals after a dash", `docs/notes-${E.toUpperCase()}`],
  ["in capitals between underscores", `_${E.toUpperCase()}_`],
  ["in capitals and percent-encoded", `${eLocal.toUpperCase()}%40${eDomain.toUpperCase()}`],
  ["in mixed case before a dot word", `${E[0].toUpperCase()}${E.slice(1)}.Thanks`],
];
for (const [label, text] of glued) hitsAre(`email glue: ${label}`, `fine\n${text}\n`, ["f.txt:2"]);
hitsAre("email glue: an unrelated address glued the same ways is clean", `docs/notes-other.person@${eDomain}\n_other.person@${eDomain}_\nother.person%40${eDomain}\n%3Cother.person@${eDomain}%3E\n`, []);
hitsAre("email glue: the glued forms are clean when the digest is not set", `docs/notes-${E}\n_${E}_\n${eLocal}%40${eDomain}\n${E}.Thanks\n`, [], {});
hitsAre("email glue: a longer local part is not the banned one", `zz${eLocal}@${eDomain} and ${eLocal}z@${eDomain}\n`, []);
// in paths (reports mask the path, never print the address)
const pathReports = (names, env) => pathProbe(names, env);
for (const [label, name] of [["a file name", `docs/${E}.txt`], ["after a dash", `docs/notes-${E}`], ["in capitals", `docs/${E.toUpperCase()}.txt`]]) {
  const r = pathReports([name], { NO_REAL_NAMES_EXTRA_EMAIL_DIGESTS: sha(E) });
  check(`email glue in a path: ${label} is reported and masked`, Array.isArray(r) && r.length === 1 && r[0].includes("***") && !r[0].toLowerCase().includes(E), Array.isArray(r) ? `${r.length} report(s)` : "scanPaths missing or failed");
}
{
  const r = pathReports([`docs/${E}.txt`], {});
  check("email glue in a path: not reported without the digest", Array.isArray(r) && r.length === 0, Array.isArray(r) ? `${r.length} report(s)` : "scanPaths missing or failed");
}

// Item 4: a private IPv6 address followed by a colon is found.
const ula6 = v6("fd7a", "115c", "", "1");
hitsAre("ipv6: a unique-local address followed by a colon", `fine\nat ${ula6}: refused\n`, ["f.txt:2"], {});
hitsAre("ipv6: a link-local address followed by a colon", `at ${v6("fe80", "", "1")}: refused\n`, ["f.txt:1"], {});
hitsAre("ipv6: a full-form unique-local address followed by a colon", `${v6("fd7a", "115c", "a1e0", "0", "0", "0", "0", "1")}: refused\n`, ["f.txt:1"], {});
hitsAre("ipv6: a documentation address followed by a colon is clean", `at ${v6("2001", "db8", "", "1")}: refused\n`, [], {});

// Item 9 (owner decision 4c): the exact, standard names of the private ranges are public knowledge and are not
// reported. Anything narrower, a real address, or a range prefix without its exact /N still is. Built from parts.
const rangeNames = [
  ["unique-local /7", v6("fc00", "", "") + "/7"],
  ["unique-local /8", v6("fd00", "", "") + "/8"],
  ["link-local /10", v6("fe80", "", "") + "/10"],
  ["class-A private /8", quad(10, 0, 0, 0) + "/8"],
  ["class-B private /12", quad(172, 16, 0, 0) + "/12"],
  ["class-C private /16", quad(192, 168, 0, 0) + "/16"],
  ["link-local IPv4 /16", quad(169, 254, 0, 0) + "/16"],
];
for (const [label, n] of rangeNames) {
  hitsAre(`range names: ${label} alone is not reported`, `${n}\n`, [], {});
  hitsAre(`range names: ${label} in a sentence is not reported`, `fine\nThe ${n} range is private.\n`, [], {});
  hitsAre(`range names: ${label} in capitals is not reported`, `${n.toUpperCase()}\n`, [], {});
  hitsAre(`range names: ${label} with surrounding punctuation is not reported`, `(${n}), \`${n}\`, <${n}>, "${n}"; ${n}.\n${n}:\n`, [], {});
}
hitsAre("range names: all seven on one line are not reported", `${rangeNames.map(([, n]) => n).join(", ")}\n`, [], {});
hitsAre("range names: mixed-case hex names are not reported", `${v6("Fc00", "", "")}/7 ${v6("FD00", "", "")}/8 ${v6("Fe80", "", "")}/10\n`, [], {});
hitsAre("range names: only the lines with a narrower range or a real address are reported", `${rangeNames[0][1]}\nuse ${v6("fd7a", "115c", "", "") + "/48"}\n${rangeNames[3][1]}\nhost ${quad(10, 0, 0, 7)}\n`, ["f.txt:2", "f.txt:4"], {});
const narrower = [
  ["a /48 inside unique-local", v6("fd7a", "115c", "", "") + "/48"],
  ["unique-local base with /8", v6("fc00", "", "") + "/8"],
  ["unique-local /8 base with /16", v6("fd00", "", "") + "/16"],
  ["unique-local /8 base with /7", v6("fd00", "", "") + "/7"],
  ["link-local with /64", v6("fe80", "", "") + "/64"],
  ["link-local /10 followed by more digits", v6("fe80", "", "") + "/100"],
  ["unique-local /7 followed by more digits", v6("fc00", "", "") + "/70"],
  ["a /24 inside the class-C range", quad(192, 168, 7, 0) + "/24"],
  ["class-C base with /24", quad(192, 168, 0, 0) + "/24"],
  ["a /16 inside the class-A range", quad(10, 1, 0, 0) + "/16"],
  ["class-A base with /16", quad(10, 0, 0, 0) + "/16"],
  ["class-A /8 followed by more digits", quad(10, 0, 0, 0) + "/80"],
  ["class-B base with /16", quad(172, 16, 0, 0) + "/16"],
  ["class-B base with /13", quad(172, 16, 0, 0) + "/13"],
  ["link-local IPv4 base with /24", quad(169, 254, 0, 0) + "/24"],
  ["a class-A address with /8", quad(10, 0, 0, 7) + "/8"],
  ["a link-local address with /10", v6("fe80", "", "1") + "/10"],
];
for (const [label, n] of narrower) hitsAre(`range names: ${label} is reported`, `fine\nthe range ${n} here\n`, ["f.txt:2"], {});
const prefixes = [
  ["unique-local base without /N", v6("fc00", "", "")],
  ["second unique-local base without /N", v6("fd00", "", "")],
  ["link-local base without /N", v6("fe80", "", "")],
  ["a link-local address", v6("fe80", "", "1")],
  ["unique-local base followed by a slash and no number", v6("fc00", "", "") + "/"],
  ["class-A base without /N", quad(10, 0, 0, 0)],
  ["class-B base without /N", quad(172, 16, 0, 0)],
  ["class-C base without /N", quad(192, 168, 0, 0)],
  ["link-local IPv4 base without /N", quad(169, 254, 0, 0)],
];
for (const [label, n] of prefixes) hitsAre(`range names: ${label} is reported`, `fine\nthe prefix ${n} here\n`, ["f.txt:2"], {});
hitsAre("range names: an exact name and a real address on one line is reported", `${rangeNames[3][1]} holds ${quad(10, 0, 0, 7)}\n${rangeNames[2][1]} holds ${v6("fe80", "", "1")}\n`, ["f.txt:1", "f.txt:2"], {});
hitsAre("range names: a documentation range name is still clean", `${quad(192, 0, 2, 0)}/24 ${v6("2001", "db8", "")}/32\n`, [], {});
// in paths: a directory named for the exact range is not reported; a narrower one is, masked
{
  const exactPaths = ["docs/" + quad(10, 0, 0, 0) + "/8/notes.txt", "docs/" + quad(192, 168, 0, 0) + "/16/notes.txt", "docs/" + v6("fc00", "", "") + "/7/notes.txt", "docs/" + v6("fe80", "", "") + "/10/notes.txt"];
  const r = pathProbe(exactPaths, {});
  check("range names in paths: the exact names are not reported", Array.isArray(r) && r.length === 0, Array.isArray(r) ? `${r.length} report(s)` : "scanPaths missing or failed");
}
for (const [label, name, hidden] of [
  ["a narrower IPv4 range", "docs/" + quad(192, 168, 7, 0) + "/24/notes.txt", quad(192, 168, 7, 0)],
  ["a real IPv4 address", "docs/host-" + quad(10, 1, 0, 0) + ".txt", quad(10, 1, 0, 0)],
  ["a narrower IPv6 range", "docs/" + v6("fd7a", "115c", "", "") + "/48/notes.txt", v6("fd7a", "115c", "", "")],
]) {
  const r = pathProbe([name], {});
  check(`range names in paths: ${label} is reported and masked`, Array.isArray(r) && r.length === 1 && r[0].includes("***") && r[0].includes("private address") && !r[0].toLowerCase().includes(hidden.toLowerCase()), Array.isArray(r) ? `${r.length} report(s)` : "scanPaths missing or failed");
}

// the real tree and history still pass (#60 item 10); a clean environment, so planted digests do not reach it
const real = spawnSync(process.execPath, [fileURLToPath(new URL("./no-real-names.mjs", import.meta.url))], { cwd: repoRoot, env: cleanEnv(), encoding: "utf8" });
check("real tree and history: the guard exits 0", real.status === 0, `exit ${real.status}: ${String(real.stdout).split("\n").slice(0, 3).join(" | ")}`);
check("real tree and history: the guard prints its ok verdict", /^no-real-names: ok/mu.test(String(real.stdout)), String(real.stdout).split("\n").slice(0, 3).join(" | "));

console.log(`${count} checks`);
process.exit(failed ? 1 : 0);
