/*
 * Test for the matchers in tools/ci/no-real-names.mjs (#56), with invented
 * words only: no digests, no real names, logins or addresses. Addresses are
 * built from parts so this file holds no dotted quad the guard would flag.
 *
 *   node tools/ci/no-real-names-test.mjs
 */
import { IPV4, isPrivateOrShared, loginsOf, scan, wordsOf } from "./no-real-names.mjs";

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

// scan reports file:line only
const hits = scan([{ name: "a.txt", text: `fine\nunder ${quad(10, 1, 2, 3)} here\n` }, { name: "b.txt", text: "nothing\n" }]);
check("scan: reports file:line and nothing else", hits.length === 1 && hits[0] === "a.txt:2", JSON.stringify(hits));

console.log(`${count} checks`);
process.exit(failed ? 1 : 0);
