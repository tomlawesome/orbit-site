/*
 * The small server the picture tools (glows.cjs, docsky.cjs) open for their headless browser: the page they draw in at
 * `/`, and the repository's files beside it. On this machine only (127.0.0.1, never every interface), and never a file
 * outside the root, however the path is spelled (`..`, encoded or not), and nothing to a request addressed to another
 * host (a page elsewhere that points its own name at this machine: DNS rebinding): refused with 403 (#37).
 *
 *   const { server, url } = await localServer({ root, page, types });   // url: http://127.0.0.1:<port>/
 */
const http = require("http"), fs = require("fs"), path = require("path");

function localServer({ root, page, types = {} }) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const end = (code) => { res.writeHead(code); res.end(); };
    const { port } = server.address();
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return end(403);
    let name;
    try { name = decodeURIComponent(req.url.split("?")[0]); } catch { return end(400); }
    if (name.includes("\0")) return end(400);
    if (name === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(page); return; }
    const file = path.resolve(base, "." + name), rel = path.relative(base, file);
    if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return end(403);
    fs.stat(file, (e, s) => {
      if (e || !s.isFile()) return end(404);
      fs.readFile(file, (e2, d) => {
        if (e2) return end(404);
        res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
        res.end(d);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

module.exports = { localServer };
