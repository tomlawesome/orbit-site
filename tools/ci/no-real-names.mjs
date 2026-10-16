/*
 * #56: tracked text uses invented names only. This guard keeps a real person's
 * name, a real host login in a home-directory path, a banned email address, and a
 * private, shared-space or link-local address from coming back, in tracked text,
 * in tracked paths and in commit history (#60). Only the sha256 digest of each
 * banned value is stored, so the guard does not itself spell the values. CI logs
 * are public, so a hit is reported as file:line, a path with the offending part
 * masked as ***, or a commit's short id and part, with the category: never the
 * word, login, address, email or line text. Modelled on Orbit's #1408 guard.
 *
 *   node tools/ci/no-real-names.mjs        # scans `git ls-files` and history; exit 1 on any hit
 *
 * The matchers are exported for tools/ci/no-real-names-test.mjs; the scan runs
 * only when this file is executed directly, not when it is imported.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const sha = (s) => createHash("sha256").update(s).digest("hex");
/* NO_REAL_NAMES_EXTRA_<KIND>_DIGESTS (comma-separated sha256 hex) adds digests to a category, for tests. */
const extra = (kind) => new Set((process.env[`NO_REAL_NAMES_EXTRA_${kind}_DIGESTS`] || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean));
const cached = (sets) => {
  const seen = new Map();
  return (value) => {
    let hit = seen.get(value);
    if (hit === undefined) {
      const d = sha(value);
      hit = sets.some((s) => s.has(d));
      if (seen.size >= 50000) seen.clear(); // bounded: a large file's email candidates are mostly seen once
      seen.set(value, hit);
    }
    return hit;
  };
};

/** sha256 of each banned word, lower case. */
export const BANNED_WORDS = new Set([
  // a real person's surname
  "4aa59b5a3761c43828cf2c0f44a385d94d078934936482f66e573cb444e7e481",
]);
export const banned = cached([BANNED_WORDS, extra("WORD")]);

/* lines the owner keeps on purpose: file -> sha256 of the whole line. Any edit
   to such a line brings the check back. */
export const KEPT = new Map([
  // the copyright holder in LICENSE (owner, 2026-10-14, #56 answer 3a)
  ["LICENSE", "51c60ba09ba9ae97a0e28aca0fb02c227a07f2e092275a082e2f9c4962d78e5c"],
]);

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
export const BANNED_LOGINS = new Set([
  // the owner's host login
  "e1608f75c5d7813f3d4031cb30bfb786507d98137538ff8e128a6ff74e84e643",
  // the account automated agents run under on the development host
  "57de4cf40144bdf7d00010f2f5557a7d642c2b9705309bfade167dd313e2ca93",
]);
export const bannedLogin = cached([BANNED_LOGINS, extra("LOGIN")]);

/*
 * Email addresses that must never again be an author or committer, nor appear
 * in tracked text or a commit message: the history was rewritten to remove them
 * (#56, owner answer 8a), and a branch cut before that rewrite would bring them
 * back. Digests of the lower-cased address only.
 */
export const BANNED_EMAILS = new Set([
  // the owner's two personal addresses, removed from history 2026-10-14
  "1027221ce9257f19167a81709f2f4b8695655a4a8b0d8fe208b6745d603c627c",
  "261f593acda73db451a02fc7382f490b64dff16426c90f60cc9af59cb077ae67",
]);
const emailDigest = cached([BANNED_EMAILS, extra("EMAIL")]);
export const bannedEmail = (address) => emailDigest(String(address).toLowerCase());

/*
 * Email candidates, found in time linear in the text (#60 r3 item 2): no regular expression that can backtrack over
 * a long run. Each `@` (or percent-encoded `%40`) is a centre; a candidate local part ends there and starts at the
 * start of the run of address characters or just after a separator (`_ - . % +`, or a `%XX` escape such as `%3C`),
 * at most 64 characters back; a candidate domain starts just after it and ends at the end of its run or just before a
 * separator, at most 255 characters on, and holds a dot. So an address glued into text by separators is found
 * (`notes-<address>.txt`, `_<address>_`, `%3C<address>%3E`), while a letter or digit glued on directly makes another
 * address. The work per `@` is bounded by those caps.
 */
const LOCAL_MAX = 64;
const DOMAIN_MAX = 255;
const isAlnum = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9");
const isSeparator = (c) => c === "_" || c === "-" || c === "." || c === "%" || c === "+";
const isLocalChar = (c) => c !== undefined && (isAlnum(c) || isSeparator(c));
const isDomainChar = (c) => c !== undefined && (isAlnum(c) || c === "." || c === "-");
const isHex = (c) => c !== undefined && /^[0-9A-Fa-f]$/u.test(c);

/** Every `@` or `%40` in TEXT with its candidate local-part starts, domain ends and the start of the whole local run. */
function* emailCentres(text) {
  for (const m of text.matchAll(/@|%40/gu)) {
    const at = m.index;
    const from = at + m[0].length;
    const starts = [];
    let runStart = -1;
    for (let s = at - 1; s >= 0 && at - s <= LOCAL_MAX && isLocalChar(text[s]); s--) {
      const prev = text[s - 1];
      if (!isLocalChar(prev)) runStart = s;
      if (isSeparator(text[s])) continue;
      if (!isLocalChar(prev) || isSeparator(prev) || (text[s - 3] === "%" && isHex(text[s - 2]) && isHex(prev))) starts.push(s);
    }
    const ends = [];
    let e = from;
    if (isAlnum(text[from])) {
      let dotted = false; // a domain holds a dot
      for (; e < text.length && e - from < DOMAIN_MAX && isDomainChar(text[e]); e++) {
        if ((text[e] === "." || text[e] === "-") && isAlnum(text[e - 1]) && dotted) ends.push(e);
        if (text[e] === ".") dotted = true;
      }
      if (!isDomainChar(text[e]) && isAlnum(text[e - 1]) && dotted) ends.push(e);
    }
    yield { at, from, starts, runStart, ends };
  }
}

/** The spans of TEXT that are a banned address, however it is glued in (any case). */
function bannedEmailSpans(text) {
  const spans = [];
  for (const { at, from, starts, ends } of emailCentres(text)) {
    if (!starts.length || !ends.length) continue;
    const domains = ends.map((end) => [end, text.slice(from, end).toLowerCase()]);
    for (const start of starts) {
      const local = text.slice(start, at).toLowerCase();
      for (const [end, domain] of domains) if (emailDigest(`${local}@${domain}`)) spans.push({ start, end });
    }
  }
  return spans;
}

/** True when the whole local part of an address in TEXT (`<login>@host`) is a banned login (#60 r3 items 5 and 8). */
function loginAsLocalPart(text) {
  for (const { at, runStart } of emailCentres(text)) {
    if (runStart >= 0 && bannedLogin(text.slice(runStart, at).toLowerCase())) return true;
  }
  return false;
}

/** `/home/<login>` (any case), `/Users/<login>`, `C:\Users\<login>` (any slash, escaped or not, either case), `~<login>/`. */
const HOME_DIRECTORY = /(?:\/[Hh][Oo][Mm][Ee]\/|[/\\]+[Uu][Ss][Ee][Rr][Ss][/\\]+|(?<![\w/])~)([A-Za-z0-9._-]+)/gu;

/** The lower-case login candidates of one home-directory segment. */
function loginCandidates(segment) {
  const login = segment.toLowerCase();
  // the whole segment, the segment without a trailing `.`, `-` or `_` (end of a
  // sentence), and the part before its first `.`, `-` or `_` (`/home/<login>-old`)
  return [login, login.replace(/[._-]+$/u, ""), login.split(/[._-]/u)[0]];
}

/** The lower-case login candidates of every home-directory path in a line. */
export function loginsOf(line) {
  const logins = new Set();
  for (const match of line.matchAll(HOME_DIRECTORY)) for (const l of loginCandidates(match[1])) logins.add(l);
  return logins;
}

/** A dotted quad not embedded in a longer run of digits and dots (version strings, OIDs). */
export const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.]*\d)/gu;

/**
 * RFC 1918 private ranges, RFC 6598 shared (CGNAT) space and RFC 3927 link-local
 * 169.254/16. The documentation ranges of RFC 5737 fall outside all of them.
 */
export function isPrivateOrShared(address) {
  const [a, b, c, d] = address.split(".").map(Number);
  if ([a, b, c, d].some((octet) => octet > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254);
}

/**
 * Colon-separated hex groups, not part of a longer word or colon run (times of day fail the shape check below). An
 * underscore is a separator, as in the IPv4 rule, not part of the address (`host_<address>_old`, #60 r4 item 1). A
 * colon may follow when it does not lead on to more groups (`<address>: refused`).
 */
const IPV6 = /(?<![A-Za-z0-9:])[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?![A-Za-z0-9]|:[0-9A-Fa-f:])/gu;

/** A well-formed IPv6 address in the unique-local range (first group fc00 to fdff) or link-local range (fe80 to febf); the documentation range is neither. */
export function isPrivateIPv6(address) {
  const halves = address.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((h) => (h ? h.split(":") : []));
  if (groups.some((g) => !/^[0-9A-Fa-f]{1,4}$/u.test(g))) return false;
  if (halves.length === 1 ? groups.length !== 8 : groups.length > 7) return false;
  const first = halves[0] ? parseInt(halves[0].split(":")[0], 16) : 0;
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/*
 * The exact, standard names of the private ranges are public knowledge, not a machine's address, and are not
 * reported (owner decision 4c, #60 r3 item 9). Only the whole name: a narrower range, an address or a prefix without
 * its exact /N still is.
 */
const RANGE_NAMES = new Set(["fc00::/7", "fd00::/8", "fe80::/10", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"]);
/** True when ADDRESS, ending at END in TEXT, is followed by the `/N` that makes it a range name, as a whole token. */
function isRangeName(text, address, end) {
  const m = /^\/(\d{1,3})(?!\w|\.\d)/u.exec(text.slice(end, end + 6));
  return m !== null && RANGE_NAMES.has(`${address.toLowerCase()}/${m[1]}`);
}

/**
 * Every banned or private thing in a piece of text, as { category, start, end }
 * (the span in the text). OPTIONS.addresses off skips private addresses
 * (author and committer names are checked for logins and emails only).
 */
export function findings(text, { addresses = true } = {}) {
  const out = [];
  for (const m of text.matchAll(/[A-Za-z0-9]+/gu)) {
    if ([...wordsOf(m[0])].some(banned)) out.push({ category: "word", start: m.index, end: m.index + m[0].length });
  }
  for (const m of text.matchAll(HOME_DIRECTORY)) {
    if (loginCandidates(m[1]).some(bannedLogin)) { const start = m.index + m[0].length - m[1].length; out.push({ category: "login", start, end: start + m[1].length }); }
  }
  for (const span of bannedEmailSpans(text)) out.push({ category: "email", ...span });
  if (addresses) {
    for (const m of text.matchAll(IPV4)) if (isPrivateOrShared(m[0]) && !isRangeName(text, m[0], m.index + m[0].length)) out.push({ category: "private address", start: m.index, end: m.index + m[0].length });
    for (const m of text.matchAll(IPV6)) {
      // a single trailing colon is punctuation (`at <address>: refused`), not part of the address
      const address = /[^:]:$/u.test(m[0]) ? m[0].slice(0, -1) : m[0];
      if (isPrivateIPv6(address) && !isRangeName(text, address, m.index + address.length)) out.push({ category: "private address", start: m.index, end: m.index + address.length });
    }
  }
  return out;
}
const categories = (found) => [...new Set(found.map((f) => f.category))].join(", ");

/** TEXT with every span in FOUND replaced by `***`. */
function mask(text, found) {
  const spans = found.map(({ start, end }) => [start, end]).sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [start, end] of spans) {
    if (end <= at) continue;
    if (start > at) out += text.slice(at, start);
    if (!out.endsWith("***") || start > at) out += "***";
    at = Math.max(at, end);
  }
  return out + text.slice(at);
}

/**
 * One report per tracked path holding a banned word, login (`home/<login>/...`)
 * or email, or a private address: the path with each offending part masked as
 * `***`, and the categories. Never the raw path.
 */
function pathFindings(name) {
  // a leading slash so that home/<login>/... at the top reads as a home directory
  return findings(`/${name}`).map((f) => ({ ...f, start: Math.max(0, f.start - 1), end: f.end - 1 }));
}
export function scanPaths(names) {
  const reports = [];
  for (const name of names) {
    const found = pathFindings(name);
    if (found.length) reports.push(`${mask(name, found)} (path: ${categories(found)})`);
  }
  return reports;
}

/** NAME as any report may print it: each banned or private part masked as `***` (#60 r3 item 1). */
export function shownPath(name) {
  const found = pathFindings(name);
  return found.length ? mask(name, found) : name;
}

/**
 * The text of one tracked file to scan, and whether its line numbers mean
 * anything. A UTF-16 byte-order mark is decoded; any other file holding a NUL
 * byte is reduced to its printable-ASCII runs of 4 or more bytes, like strings(1).
 */
export function textOf(data) {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return { text: data.subarray(2).toString("utf16le"), lines: true };
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return { text: Buffer.from(data.subarray(2, 2 + ((data.length - 2) & ~1))).swap16().toString("utf16le"), lines: true };
  if (!data.includes(0)) return { text: data.toString("utf8"), lines: true };
  return { text: data.toString("latin1").match(/[\x20-\x7e\t]{4,}/gu)?.join("\n") ?? "", lines: false };
}

/**
 * Run `git ARGS` (git looked up on PATH) and return its stdout. On failure print only the subcommand and the exit
 * status and exit 2: never git's output or the error object, which can hold a banned value and CI logs are
 * public (#60 r4 item 2).
 */
function git(...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    const status = r.status ?? (r.signal ? `signal ${r.signal}` : "none");
    console.log(`no-real-names: git ${args[0]} failed (exit ${status})`);
    process.exit(2); // 2, not 1: the check could not run, which is not a finding
  }
  return r.stdout;
}

function trackedFiles() {
  const names = git("ls-files", "-z").split("\0").filter(Boolean);
  const files = [];
  for (const name of names) {
    let data;
    try { data = readFileSync(path.join(root, name)); } catch { continue; } // deleted in the tree, or not a file
    files.push({ name, ...textOf(data) });
  }
  return { names, files };
}

/** One hit per offending line, in file order, with its categories. LINES false (a binary file) reports the file once. */
function scanDetailed(files) {
  const hits = [];
  for (const { name, text, lines: numbered = true } of files) {
    const shown = shownPath(name);
    const lines = text.split("\n");
    const kept = KEPT.get(name);
    const all = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (kept !== undefined && sha(line) === kept) continue;
      const found = findings(line);
      if (!found.length) continue;
      if (numbered) hits.push({ ref: `${shown}:${i + 1}`, found });
      else all.push(...found);
    }
    if (all.length) hits.push({ ref: shown, found: all });
  }
  return hits;
}

/** The `file:line` of every hit (`file` for a binary file), each line once, in file order. Never the value or text. */
export function scan(files) {
  return scanDetailed(files).map((h) => h.ref);
}

/**
 * AI attribution in a commit message (#60 item 7, r3 item 7): a co-author trailer naming an AI model or assistant (an
 * anthropic.com or openai.com address included), a line starting "Generated with" that names an AI, a session line.
 */
const AI_NAME = /\b(?:claude|fable|opus|sonnet|haiku|anthropic|openai|chatgpt|gpt(?:-?\d\w*)?|codex|copilot|gemini|llm|ai)\b/iu;
export function aiAttribution(message) {
  return message.split("\n").some((line) =>
    (/^\s*co-authored-by\s*:/iu.test(line) && AI_NAME.test(line))
    // the line starts with it (after any emoji or punctuation), so prose that mentions the phrase is not refused
    || /^[^A-Za-z0-9]*generated with\b.*\b(?:claude|ai)\b/iu.test(line)
    || /^\s*claude-session\s*:/iu.test(line));
}

/**
 * The categories under which an author or committer NAME (or EMAIL) is banned:
 * a login (the bare login as the whole name, or a home directory) or an email,
 * never the banned word, because the owner commits under their own name (#56,
 * owner decision 4b). Commit messages are checked for the word as well.
 */
function personFindings(name, email) {
  const found = findings(name, { addresses: false }).map((f) => f.category).filter((c) => c !== "word");
  if (bannedLogin(name.trim().toLowerCase())) found.push("login");
  if (bannedEmail(email)) found.push("email");
  // git's automatic identity is <login>@<host> (#60 r3 item 5)
  const at = email.lastIndexOf("@");
  if (at > 0 && bannedLogin(email.slice(0, at).trim().toLowerCase())) found.push("login");
  return [...new Set(found)];
}

/** A person trailer: `Signed-off-by:`, `Reviewed-by:`, `Co-authored-by:` and the other `<Something>-by:` lines. */
const PERSON_TRAILER = /^(\s*[A-Za-z][A-Za-z-]*-by\s*:)([^<]*)/iu;

/**
 * Everything banned or private in one line of a commit message (#60 r3 items 6 and 8). The name part of a person
 * trailer may carry the banned word, as an author name may (owner decision 4b); a login as that whole name, a login
 * as an address's local part, and a banned email or private address anywhere are refused.
 */
export function messageFindings(line) {
  let found = findings(line);
  const trailer = PERSON_TRAILER.exec(line);
  if (trailer) {
    const nameStart = trailer[1].length;
    const nameEnd = nameStart + trailer[2].length;
    found = found.filter((f) => f.category !== "word" || f.start < nameStart || f.end > nameEnd);
    if (bannedLogin(trailer[2].trim().toLowerCase())) found.push({ category: "login", start: nameStart, end: nameEnd });
  }
  if (loginAsLocalPart(line)) found.push({ category: "login", start: 0, end: 0 });
  return found;
}

/* `<short id> author|committer|message (<categories>)` for every commit reachable
   from HEAD with a banned login or email in the author or committer name or
   email (a login also as the email's local part), a banned word, login, email or
   private address in the full message (trailers included; the banned word is
   allowed in a person trailer's name), or AI attribution. Never the value. A
   shallow clone cannot see the whole history, so it is refused rather than passed. */
function commitHits() {
  if (git("rev-parse", "--is-shallow-repository").trim() === "true") return null;
  const hits = [];
  const fields = git("log", "-z", "--format=%h%x00%ae%x00%ce%x00%an%x00%cn%x00%B", "HEAD").split("\0");
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const [id, ae, ce, an, cn, message] = fields.slice(i, i + 6);
    const author = personFindings(an, ae);
    if (author.length) hits.push(`${id} author (${author.join(", ")})`);
    const committer = personFindings(cn, ce);
    if (committer.length) hits.push(`${id} committer (${committer.join(", ")})`);
    const found = message.split("\n").flatMap(messageFindings);
    if (found.length) hits.push(`${id} message (${categories(found)})`);
    if (aiAttribution(message)) hits.push(`${id} message (AI attribution)`);
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { names, files } = trackedFiles();
  const hits = scanDetailed(files);
  for (const h of hits) console.log(`   ${h.ref} (${categories(h.found)})`);
  if (hits.length) console.log(`no-real-names: ${hits.length} line(s) hold a real name, host login, banned email or private address (#56, #60): use an invented name, ~/..., <project root> or a documentation address (192.0.2.x, 198.51.100.x, 203.0.113.x, 2001:db8::)`);
  const paths = scanPaths(names);
  for (const p of paths) console.log(`   ${p}`);
  if (paths.length) console.log(`no-real-names: ${paths.length} tracked path(s) hold a real name, host login, banned email or private address (#60), shown masked as ***: rename them`);
  const commits = commitHits() ?? (console.log("no-real-names: the clone is shallow, so the history cannot all be checked: fetch the whole history (GIT_DEPTH: 0)"), [""]);
  for (const h of commits.filter(Boolean)) console.log(`   ${h}`);
  if (commits.some(Boolean)) console.log(`no-real-names: ${commits.length} commit part(s) carry a banned word, login or email, a private address, or AI attribution (#56, #60): a branch cut before the history rewrite of 2026-10-14 is rebased onto the current dev; otherwise reword the commit`);
  if (hits.length || paths.length || commits.length) process.exit(1);
  console.log("no-real-names: ok");
}
