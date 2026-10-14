/*
 * #56: tracked text uses invented names only. This guard keeps a real person's
 * name, a real host login in a home-directory path, and a private or shared-space
 * IPv4 address from coming back. Only the sha256 digest of each banned word is
 * stored, so the guard does not itself spell the values. A hit is reported as
 * file:line and nothing else: CI logs are public, so the word, the login, the
 * address and the line text are never printed. Modelled on Orbit's #1408 guard.
 *
 *   node tools/ci/no-real-names.mjs        # scans `git ls-files`; exit 1 on any hit
 *
 * The matchers are exported for tools/ci/no-real-names-test.mjs; the scan runs
 * only when this file is executed directly, not when it is imported.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** sha256 of each banned word, lower case. */
const BANNED = new Set([
  // a real person's surname
  "4aa59b5a3761c43828cf2c0f44a385d94d078934936482f66e573cb444e7e481",
]);

const sha = (s) => createHash("sha256").update(s).digest("hex");
const seen = new Map();
export function banned(word) {
  let hit = seen.get(word);
  if (hit === undefined) { hit = BANNED.has(sha(word)); seen.set(word, hit); }
  return hit;
}

/**
 * The lower-case words a line could spell a banned word with: camelCase runs
 * split, and each token also tried without a trailing `s` or `es`, because the
 * plural was nearly all of the lines Orbit's sweep removed. A longer word that
 * merely contains the name is one token and so does not match.
 */
export function wordsOf(line) {
  const words = new Set();
  for (const token of line.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    words.add(token);
    if (token.length <= 2) continue;
    if (token.endsWith("s")) words.add(token.slice(0, -1));
    if (token.endsWith("es")) words.add(token.slice(0, -2));
  }
  return words;
}

/*
 * A real login name leaks through a home-directory path. Only path segments are
 * checked, because a login can also be an ordinary first name that text
 * legitimately uses. Digests only, as above.
 */
const BANNED_LOGINS = new Set([
  // the owner's host login
  "e1608f75c5d7813f3d4031cb30bfb786507d98137538ff8e128a6ff74e84e643",
  // the account automated agents run under on the development host
  "57de4cf40144bdf7d00010f2f5557a7d642c2b9705309bfade167dd313e2ca93",
]);
export const bannedLogin = (login) => BANNED_LOGINS.has(sha(login));

/** `/home/<login>`, `/Users/<login>`, `C:\Users\<login>` (any slash, escaped or not, either case), `~<login>/`. */
const HOME_DIRECTORY = /(?:\/home\/|[/\\]+[Uu][Ss][Ee][Rr][Ss][/\\]+|(?<![\w/])~)([A-Za-z0-9._-]+)/gu;

/**
 * The lower-case login candidates of every home-directory path in a line: the
 * whole segment, the segment without a trailing `.` or `-` (end of a sentence),
 * and the part before its first `.` or `-` (`/home/<login>-old`).
 */
export function loginsOf(line) {
  const logins = new Set();
  for (const match of line.matchAll(HOME_DIRECTORY)) {
    const login = match[1].toLowerCase();
    logins.add(login);
    logins.add(login.replace(/[.-]+$/u, ""));
    logins.add(login.split(/[.-]/u)[0]);
  }
  return logins;
}

/** A dotted quad not embedded in a longer run of digits and dots (version strings, OIDs). */
export const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.]*\d)/gu;

/**
 * RFC 1918 private ranges and RFC 6598 shared (CGNAT) space. The documentation
 * ranges of RFC 5737 fall outside both, so they never match.
 */
export function isPrivateOrShared(address) {
  const [a, b, c, d] = address.split(".").map(Number);
  if ([a, b, c, d].some((octet) => octet > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function trackedTextFiles() {
  const names = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  const files = [];
  for (const name of names) {
    let data;
    try { data = readFileSync(path.join(root, name)); } catch { continue; } // deleted in the tree, or not a file
    if (data.subarray(0, 8192).includes(0)) continue; // binary
    files.push({ name, text: data.toString("utf8") });
  }
  return files;
}

/** The `file:line` of every hit, each line once, in file order. Never the word, login, address or text. */
export function scan(files) {
  const hits = [];
  for (const { name, text } of files) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const bad = [...wordsOf(line)].some(banned)
        || [...loginsOf(line)].some(bannedLogin)
        || [...line.matchAll(IPV4)].some((m) => isPrivateOrShared(m[0]));
      if (bad) hits.push(`${name}:${i + 1}`);
    }
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const hits = scan(trackedTextFiles());
  for (const h of hits) console.log(`   ${h}`);
  if (hits.length) {
    console.log(`no-real-names: ${hits.length} line(s) hold a real name, host login or private address (#56): use an invented name, ~/..., <project root> or a documentation address (192.0.2.x, 198.51.100.x, 203.0.113.x)`);
    process.exit(1);
  }
  console.log("no-real-names: ok");
}
