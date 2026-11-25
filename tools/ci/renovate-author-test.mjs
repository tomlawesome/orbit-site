/*
 * Test for #147 (Renovate commits fail the private-details job), written from the issue's specification alone.
 *
 * renovate.json must set gitAuthor to "Name <address>" where the address is made up and its domain ends in
 * .invalid (RFC 6761: can never receive mail), so a Renovate commit carries no real mailbox into the public mirror.
 * The check fails when gitAuthor is missing, malformed, or its domain is not under .invalid. Modelled on
 * ai/orbit-launcher's test/supplychain/renovate_author_test.go.
 *
 *   node tools/ci/renovate-author-test.mjs
 *
 * No dependencies and no browser. Fixture addresses are built from parts, so no address is written out here.
 */
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const AT = String.fromCharCode(64);
const addr = (local, domain) => `${local}${AT}${domain}`;

/* the problem with a config's gitAuthor, or null when it is acceptable */
const problem = (cfg) => {
  const a = cfg && cfg.gitAuthor;
  if (a === undefined || a === null || a === "") return "gitAuthor is not set";
  if (typeof a !== "string") return `gitAuthor is a ${typeof a}, want a string`;
  const m = /^([^<>@\s][^<>@]*?)\s+<([^<>@\s]+)@([^<>@\s]+)>$/.exec(a);
  if (!m) return "gitAuthor is not of the form Name <address>";
  const labels = m[3].toLowerCase().split(".");
  if (labels.length < 2 || labels.some((l) => l === "") || labels[labels.length - 1] !== "invalid") {
    return "gitAuthor's address domain does not end in .invalid";
  }
  return null;
};

const fixtures = [
  ["a name and an address under .invalid is accepted", `Orbit Renovate <${addr("renovate", "orbit.invalid")}>`, true],
  ["a deeper domain under .invalid is accepted", `Orbit Renovate <${addr("bot", "a.b.invalid")}>`, true],
  ["a missing gitAuthor is refused", undefined, false],
  ["an empty gitAuthor is refused", "", false],
  ["a bare address with no name is refused", addr("renovate", "orbit.invalid"), false],
  ["an angle address with no name is refused", `<${addr("renovate", "orbit.invalid")}>`, false],
  ["a name with no address is refused", "Orbit Renovate", false],
  ["a missing @ is refused", "Orbit Renovate <renovate.orbit.invalid>", false],
  ["an unclosed angle bracket is refused", `Orbit Renovate <${addr("renovate", "orbit.invalid")}`, false],
  ["a real-looking domain is refused", `Orbit Renovate <${addr("renovate", ["example", "com"].join("."))}>`, false],
  ["a domain that only contains invalid is refused", `Orbit Renovate <${addr("renovate", "invalid.example")}>`, false],
  ["a domain ending in notinvalid is refused", `Orbit Renovate <${addr("renovate", "orbit.notinvalid")}>`, false],
  ["a bare invalid domain with no dot is refused", `Orbit Renovate <${addr("renovate", "invalid")}>`, false],
  ["a non-string gitAuthor is refused", 42, false],
];
for (const [name, author, want] of fixtures) {
  const p = problem({ gitAuthor: author });
  check(`fixture: ${name}`, (p === null) === want, p === null ? "accepted" : p);
}
check("fixture: a config with no gitAuthor key is refused", problem({}) !== null, String(problem({})));

const cfg = JSON.parse(readFileSync(new URL("../../renovate.json", import.meta.url), "utf8"));
const p = problem(cfg);
check("renovate.json gitAuthor is Name <address> with a domain under .invalid", p === null, p === null ? `gitAuthor is ${JSON.stringify(cfg.gitAuthor)}` : p);

process.exit(failed ? 1 : 0);
