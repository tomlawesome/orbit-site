/*
 * Test for the local static server (tools/local-server.cjs): it listens on this
 * machine only, serves the page at "/" and files under its root, and refuses
 * every request that reaches outside the root.
 *
 *   node tools/ci/local-server-test.mjs
 *
 * No dependencies. Paths are sent raw (http.request does not tidy them), so
 * "../" and encoded variants reach the server exactly as written.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

let failed = false;
let stage = "start";
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const deadline = setTimeout(() => {
  console.log(`FAIL deadline: still running after 20 s, at case "${stage}"`);
  process.exit(1);
}, 20000);
deadline.unref();

let localServer;
try {
  ({ localServer } = createRequire(import.meta.url)("../local-server.cjs"));
  if (typeof localServer !== "function") throw new Error("it does not export localServer");
} catch (e) {
  console.log(`FAIL load tools/local-server.cjs: ${e.code === "MODULE_NOT_FOUND" ? "module not found" : e.message}`);
  process.exit(1);
}

const get = (port, p, extra = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "GET", ...extra }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "local-server-test-"));
let server;
try {
  const root = path.join(tmp, "r");
  const other = path.join(tmp, "r-other");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.mkdirSync(other);
  const marker1 = "SECRET-MARKER-one-7f3a91";
  const marker2 = "SECRET-MARKER-two-c20d4e";
  fs.writeFileSync(path.join(tmp, "secret.txt"), marker1);
  fs.writeFileSync(path.join(other, "secret.txt"), marker2);
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 10, 13, 255, 65, 66]);
  fs.writeFileSync(path.join(root, "sub", "file.js"), bytes);
  fs.writeFileSync(path.join(root, "sub", "thing.zzz"), "unknown");
  const page = "<!doctype html><title>page</title><p>hello</p>\n";
  const types = { ".js": "text/javascript; charset=utf-8" };

  stage = "1 listen";
  let url;
  ({ server, url } = await localServer({ root, page, types }));
  const addr = server.address();
  const port = addr.port;
  check("listens on this machine only", addr.address === "127.0.0.1", `address ${addr.address} (want 127.0.0.1)`);
  check("url is http://127.0.0.1:<port>/", /^http:\/\/127\.0\.0\.1:\d+\/$/.test(url) && url === `http://127.0.0.1:${port}/`, `${url} (port ${port})`);

  stage = "2 page";
  let r = await get(port, "/");
  check("GET / is 200", r.status === 200, `status ${r.status}`);
  check("GET / is text/html", r.type.startsWith("text/html"), `content-type ${r.type}`);
  check("GET / body is the page", r.body.toString() === page, `${r.body.length} bytes (want ${Buffer.byteLength(page)})`);

  stage = "3 files";
  r = await get(port, "/sub/file.js");
  check("file inside root is 200", r.status === 200, `status ${r.status}`);
  check("file type comes from types", r.type === types[".js"], `content-type ${r.type} (want ${types[".js"]})`);
  check("file body is byte for byte", r.body.equals(bytes), `${r.body.length} bytes (want ${bytes.length})`);
  r = await get(port, "/sub/file.js?x=1");
  check("a query string is ignored", r.status === 200 && r.body.equals(bytes), `status ${r.status}, ${r.body.length} bytes`);
  r = await get(port, "/sub/thing.zzz");
  check("unknown extension is octet-stream", r.status === 200 && r.type.startsWith("application/octet-stream"), `status ${r.status}, content-type ${r.type}`);

  stage = "4 escapes";
  const escapes = [
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e%2fsecret.txt",
    "/sub/../../secret.txt",
    "/../r-other/secret.txt",
    "/%2e%2e%2fr-other%2fsecret.txt",
  ];
  for (const p of escapes) {
    stage = `4 escape ${p}`;
    r = await get(port, p);
    const body = r.body.toString("latin1");
    const leaked = body.includes(marker1) || body.includes(marker2);
    check(`escape ${p}`, r.status === 403 && !leaked, `status ${r.status} (want 403), ${leaked ? "LEAKED the secret" : "no secret in body"}`);
  }

  stage = "5 inside after ..";
  r = await get(port, "/sub/../sub/file.js");
  check("/sub/../sub/file.js stays inside", r.status === 200, `status ${r.status} (want 200)`);

  stage = "6 missing and directory";
  r = await get(port, "/sub/nope.js");
  check("missing file is 404", r.status === 404, `status ${r.status}`);
  r = await get(port, "/sub/");
  check("directory /sub/ is 404", r.status === 404, `status ${r.status}`);
  r = await get(port, "/sub");
  check("directory /sub is 404", r.status === 404, `status ${r.status}`);

  stage = "7 malformed";
  r = await get(port, "/%E0%A4%A");
  check("bad percent-encoding is 400", r.status === 400, `status ${r.status}`);
  r = await get(port, "/sub/file.js%00.png");
  check("NUL is 400 or 404, never 200", r.status === 400 || r.status === 404, `status ${r.status}`);
  r = await get(port, "/");
  check("still serving after bad requests", r.status === 200 && r.body.toString() === page, `status ${r.status}`);

  stage = "8 host header";
  // DNS rebinding: only requests addressed to this server (its own port) are answered.
  const hosts = [
    ["evil.example", { headers: { host: "evil.example" } }],
    [`evil.example:${port}`, { headers: { host: `evil.example:${port}` } }],
    [`127.0.0.1:${port + 1}`, { headers: { host: `127.0.0.1:${port + 1}` } }],
    ["127.0.0.1", { headers: { host: "127.0.0.1" } }],
    ["localhost", { headers: { host: "localhost" } }],
    ["(empty)", { headers: { host: "" } }],
    ["(no Host header)", { setHost: false }],
  ];
  const served = (b) => b.toString("latin1").includes("<title>page</title>") || b.includes(bytes);
  for (const [label, extra] of hosts) {
    for (const p of ["/", "/sub/file.js"]) {
      stage = `8 Host ${label} ${p}`;
      try {
        r = await get(port, p, extra);
      } catch (e) {
        check(`Host ${label} ${p}`, false, `request failed: ${e.message}`);
        continue;
      }
      // With no Host header at all, node's own parser may answer 400 before the handler runs: still a refusal.
      const refused = label === "(no Host header)" ? r.status === 403 || r.status === 400 : r.status === 403;
      check(`Host ${label} ${p} is refused`, refused && !served(r.body), `status ${r.status} (want 403), ${served(r.body) ? "SERVED content" : "no content in body"}`);
    }
  }
  for (const h of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    for (const p of ["/", "/sub/file.js"]) {
      stage = `8 control Host ${h} ${p}`;
      r = await get(port, p, { headers: { host: h } });
      check(`Host ${h} ${p} is answered`, r.status === 200, `status ${r.status} (want 200)`);
    }
  }
} catch (e) {
  check(`case "${stage}"`, false, `threw ${e && e.message ? e.message : e}`);
} finally {
  if (server) await new Promise((ok) => { server.close(ok); server.closeAllConnections?.(); });
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
