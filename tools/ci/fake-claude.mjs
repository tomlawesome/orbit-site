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
 * The Batches API only accepts custom_id matching ^[a-zA-Z0-9_-]{1,64}$: a batch with any other custom_id is a 400
 * and nothing is made (spec amendment 1). The tool names requests r0000, r0001, ... by index, so the fake derives
 * each request's LOGICAL id from its content: q.customId is "docs/<slug>/<id>@<lang>" for a section and
 * "site/<lang>/<n>@<lang>" for a catalogue chunk (n counts the chunks of that language in first-seen order); the
 * id on the wire is q.wireId. `script` and the tests speak logical ids. Results go back keyed by wire id.
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

export const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const LANG_NAMES = { de: "German", fr: "French", es: "Spanish", pt: "Portuguese", id: "Indonesian", "zh-Hans": "Chinese", ja: "Japanese", ar: "Arabic" };
/* the language of a request: the first English name in the user message before the item's JSON */
function langOf(user) {
  const m = /\{\s*"(slug|items)"/.exec(user), head = m ? user.slice(0, m.index) : user;
  let best = ["", Infinity];
  for (const [code, name] of Object.entries(LANG_NAMES)) { const i = head.indexOf(name); if (i >= 0 && i < best[1]) best = [code, i]; }
  return best[0];
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
 * startFake({ key, script, polls, never, status, drop, corrupt, endAs })
 *   polls   GETs of a batch before it reads as ended (default 1)
 *   never   the batch never ends
 *   status  answer every POST /v1/messages/batches with this HTTP status (e.g. 401)
 *   drop    destroy the connection of the first `drop` POSTs (a network failure)
 *   corrupt how the results are mangled: "shuffle" (reverse order), "unknown" (one custom_id the batch never had),
 *           "duplicate" (one custom_id twice)
 *   endAs   the batch ends with every request "errored" | "expired" | "canceled" (results lines of that type)
 * fake.never is settable: flip it to false and the next poll sees the batch ended (a resume).
 * Returns { url, requests, batches, posts, cancels, close() }. url is the --api-base.
 */
export async function startFake({ key = FAKE_KEY, script = () => undefined, polls = 1, never = false, status = 0, drop = 0, corrupt = "", endAs = "" } = {}) {
  const state = { never };
  const chunkNo = {};
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
        const badId = ((json && json.requests) || []).find((r) => typeof r.custom_id !== "string" || !CUSTOM_ID.test(r.custom_id));
        if (badId) return send(400, { type: "error", error: { type: "invalid_request_error", message: `requests.custom_id: String should match pattern '^[a-zA-Z0-9_-]{1,64}$'` } });
        const id = `msgbatch_fake_${batches.length + 1}`;
        const sent = [], lines = [];
        for (const r of (json && json.requests) || []) {
          const user = userText(r.params), item = extractItem(user);
          const lang = langOf(user);
          let logical = r.custom_id;
          if (item && item.items) { const first = item.items[0] && item.items[0].id; const k = `${lang}|${first}`; if (!(k in chunkNo)) chunkNo[k] = Object.keys(chunkNo).filter((x) => x.startsWith(`${lang}|`)).length; logical = `site/${lang}/${chunkNo[k]}@${lang}`; }
          else if (item) logical = `docs/${item.slug}/${item.id}@${lang}`;
          const attempt = 1 + batches.reduce((n, b) => n + b.requests.filter((x) => x.customId === logical).length, 0) + sent.filter((x) => x.customId === logical).length;
          const q = { customId: logical, wireId: r.custom_id, lang, system: systemText(r.params), user, params: r.params, item };
          sent.push(q);
          const answer = item ? defaultAnswer(item) : {};
          const s = script(r.custom_id, attempt, q, answer) || {};
          lines.push(resultLine(r.custom_id, endAs ? endAs : s.errored ? "errored" : s.expired ? "expired" : s.refusal ? "refusal" : "ok", s.answer !== undefined ? s.answer : answer));
        }
        if (corrupt === "shuffle") lines.reverse();
        if (corrupt === "unknown" && lines.length) lines[0] = { ...lines[0], custom_id: "r9999" };
        if (corrupt === "duplicate" && lines.length > 1) lines.push({ ...lines[0] });
        batches.push({ id, requests: sent, lines, gets: 0, cancelled: false });
        return send(200, { id, type: "message_batch", processing_status: "in_progress", request_counts: { processing: sent.length }, results_url: null });
      }
      if (req.method === "GET" && (m = /^\/v1\/messages\/batches\/([\w-]+)$/.exec(path))) {
        const b = batches.find((x) => x.id === m[1]);
        if (!b) return send(404, { type: "error", error: { type: "not_found_error", message: "no such batch" } });
        b.gets++;
        const ended = !state.never && b.gets >= polls && !b.cancelled;
        const kind = endAs === "errored" ? "errored" : endAs === "expired" ? "expired" : endAs === "canceled" ? "canceled" : "succeeded";
        return send(200, { id: b.id, type: "message_batch", processing_status: ended ? "ended" : b.cancelled ? "canceling" : "in_progress",
          request_counts: ended ? { [kind]: b.lines.length } : { processing: b.lines.length }, results_url: ended ? `${origin}/v1/messages/batches/${b.id}/results` : null });
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
    get never() { return state.never; }, set never(v) { state.never = v; },
    get posts() { return requests.filter((r) => r.method === "POST" && r.path.split("?")[0] === "/v1/messages/batches").length; },
    get cancels() { return requests.filter((r) => r.method === "POST" && r.path.endsWith("/cancel")); },
    /* every request of every batch, in the order sent */
    get sent() { return batches.flatMap((b, n) => b.requests.map((q) => ({ ...q, batch: n }))); },
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}
