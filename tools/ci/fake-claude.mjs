/*
 * The fake Claude API for the translation job's tests (#125 stage 2, spec section 6). A local HTTP server that
 * answers the three calls tools/ci/translate.mjs makes to the Batches API and records everything it is sent, so no
 * test calls the real API or needs a real key:
 *
 *   POST /v1/messages/batches            {requests:[{custom_id, params}]}  -> the batch (ended after `polls` GETs)
 *   GET  /v1/messages/batches/{id}       -> processing_status in_progress, then ended with a results_url
 *   GET  /v1/messages/batches/{id}/results  -> JSONL, one line per request, keyed by custom_id
 *   POST /v1/messages/batches/{id}/cancel   -> recorded
 *
 * Every request must carry x-api-key equal to the key the fake was started with (a wrong or missing one is a 401).
 *
 * What each result says comes from `script(customId, attempt, request, answer)`: attempt counts the times that
 * custom_id has been sent (1, 2), request is {customId, lang, system, user, params, item} and answer is the default
 * (correct) answer object for the item. It returns undefined (use the default answer) or one of
 *   { answer: <object or string> }   the model's JSON (an object is stringified; a string is sent as it is)
 *   { errored: true } | { expired: true } | { refusal: true }
 * The default answer swaps every "e" outside tags, {placeholders}, entities, <pre> and <code> for "é": the
 * same length, the same skeleton, "Orbit" untouched, so it passes every check of spec 2.2.
 *
 * Not a test itself: tools/ci/translate-*-test.mjs use it.
 */
import { createServer } from "node:http";

export const FAKE_KEY = "sk-ant-FAKE-not-a-real-key";

/* the default "translation" */
export const swap = (s) => String(s).split(/(\{\w+\}|<[^>]+>|&#?\w+;)/).map((p, i) => (i % 2 ? p : p.replace(/e/g, "é"))).join("");
export const translateHtml = (html) =>
  String(html).split(/(<pre\b[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>)/).map((p, i) => (i % 2 ? p : swap(p))).join("");
export function defaultAnswer(item) {
  if (item && Array.isArray(item.items)) return { items: item.items.map((x) => ({ id: x.id, text: swap(x.text) })) };
  return { title: swap(item.title), html: translateHtml(item.html), subs: (item.subs || []).map((s) => ({ id: s.id, title: swap(s.title) })) };
}

const asText = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b === "string" ? b : b.text || "")).join("\n") : "");
export const userText = (params) => (params.messages || []).map((m) => asText(m.content)).join("\n");
export const systemText = (params) => asText(params.system);

/* the item's JSON in a user message: from its first brace to the matching one, strings respected; text after it
   (a retry's "your previous answer broke: ...") is ignored */
export function extractItem(text) {
  const m = /\{\s*"(slug|items)"/.exec(text);
  if (!m) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = m.index; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { try { return JSON.parse(text.slice(m.index, i + 1)); } catch { return null; } }
  }
  return null;
}

const usage = { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 25, output_tokens: 10 };
function resultLine(customId, how, answer) {
  const base = { id: "msg_fake", type: "message", role: "assistant", model: "claude-opus-5-5", usage };
  if (how === "errored") return { custom_id: customId, result: { type: "errored", error: { type: "error", error: { type: "api_error", message: "fake error" } } } };
  if (how === "expired") return { custom_id: customId, result: { type: "expired" } };
  if (how === "refusal") return { custom_id: customId, result: { type: "succeeded", message: { ...base, content: [], stop_reason: "refusal" } } };
  const text = typeof answer === "string" ? answer : JSON.stringify(answer);
  return { custom_id: customId, result: { type: "succeeded", message: { ...base, content: [{ type: "text", text }], stop_reason: "end_turn" } } };
}

/*
 * startFake({ key, script, polls, never, status, drop })
 *   polls   GETs of a batch before it reads as ended (default 1)
 *   never   the batch never ends
 *   status  answer every POST /v1/messages/batches with this HTTP status (e.g. 401)
 *   drop    destroy the connection of the first `drop` POSTs (a network failure)
 * Returns { url, requests, batches, posts, cancels, close() }. url is the --api-base.
 */
export async function startFake({ key = FAKE_KEY, script = () => undefined, polls = 1, never = false, status = 0, drop = 0 } = {}) {
  const requests = [], batches = [];
  let posts = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let json = null; try { json = bodyText ? JSON.parse(bodyText) : null; } catch { /* kept as text */ }
      const rec = { method: req.method, path: req.url, headers: req.headers, bodyText, json };
      requests.push(rec);
      const origin = `http://${req.headers.host}`;
      const send = (code, body, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
      const path = req.url.split("?")[0];
      if (req.method === "POST" && path === "/v1/messages/batches" && drop > posts) { posts++; req.socket.destroy(); return; }
      if (req.method === "POST" && path === "/v1/messages/batches") posts++;
      if (req.headers["x-api-key"] !== key || (status && req.method === "POST" && path === "/v1/messages/batches")) {
        return send(status || 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      }
      let m;
      if (req.method === "POST" && path === "/v1/messages/batches") {
        const id = `msgbatch_fake_${batches.length + 1}`;
        const sent = [], lines = [];
        for (const r of (json && json.requests) || []) {
          const attempt = 1 + batches.reduce((n, b) => n + b.requests.filter((x) => x.customId === r.custom_id).length, 0) + sent.filter((x) => x.customId === r.custom_id).length;
          const user = userText(r.params), item = extractItem(user);
          const lang = (r.custom_id.split("@").pop()) || "";
          const q = { customId: r.custom_id, lang, system: systemText(r.params), user, params: r.params, item };
          sent.push(q);
          const answer = item ? defaultAnswer(item) : {};
          const s = script(r.custom_id, attempt, q, answer) || {};
          lines.push(resultLine(r.custom_id, s.errored ? "errored" : s.expired ? "expired" : s.refusal ? "refusal" : "ok", s.answer !== undefined ? s.answer : answer));
        }
        batches.push({ id, requests: sent, lines, gets: 0, cancelled: false });
        return send(200, { id, type: "message_batch", processing_status: "in_progress", request_counts: { processing: sent.length }, results_url: null });
      }
      if (req.method === "GET" && (m = /^\/v1\/messages\/batches\/([\w-]+)$/.exec(path))) {
        const b = batches.find((x) => x.id === m[1]);
        if (!b) return send(404, { type: "error", error: { type: "not_found_error", message: "no such batch" } });
        b.gets++;
        const ended = !never && b.gets >= polls && !b.cancelled;
        return send(200, { id: b.id, type: "message_batch", processing_status: ended ? "ended" : b.cancelled ? "canceling" : "in_progress",
          request_counts: ended ? { succeeded: b.lines.length } : { processing: b.lines.length }, results_url: ended ? `${origin}/v1/messages/batches/${b.id}/results` : null });
      }
      if (req.method === "GET" && (m = /^\/v1\/messages\/batches\/([\w-]+)\/results$/.exec(path))) {
        const b = batches.find((x) => x.id === m[1]);
        if (!b) return send(404, { type: "error", error: { type: "not_found_error", message: "no such batch" } });
        return send(200, b.lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "application/x-jsonl");
      }
      if (req.method === "POST" && (m = /^\/v1\/messages\/batches\/([\w-]+)\/cancel$/.exec(path))) {
        const b = batches.find((x) => x.id === m[1]);
        if (b) b.cancelled = true;
        return send(200, { id: m[1], type: "message_batch", processing_status: "canceling" });
      }
      send(404, { type: "error", error: { type: "not_found_error", message: `fake has no ${req.method} ${path}` } });
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, requests, batches,
    get posts() { return requests.filter((r) => r.method === "POST" && r.path.split("?")[0] === "/v1/messages/batches").length; },
    get cancels() { return requests.filter((r) => r.method === "POST" && r.path.endsWith("/cancel")); },
    /* every request of every batch, in the order sent */
    get sent() { return batches.flatMap((b, n) => b.requests.map((q) => ({ ...q, batch: n }))); },
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}
