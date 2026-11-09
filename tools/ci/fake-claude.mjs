/*
 * The fake Claude API for the translation job's tests (#125 stage 2, spec section 6). A local HTTP server that
 * answers the three calls tools/ci/translate.mjs makes to the Batches API and records everything it is sent, so no
 * test calls the real API or needs a real key:
 *
 *   POST /v1/messages/batches            {requests:[{custom_id, params}]}  -> the batch (ended after `polls` GETs)
 *   GET  /v1/messages/batches/{id}       -> processing_status in_progress, then ended with a results_url
 *   GET  /v1/messages/batches/{id}/results  -> JSONL, one line per request, keyed by custom_id
 *   POST /v1/messages/batches/{id}/cancel   -> recorded
 *   GET  /v1/messages/batches            -> {data: [every batch, newest first], has_more: false} (the list call)
 *
 * The Batches API only accepts custom_id matching ^[a-zA-Z0-9_-]{1,64}$: a batch with any other custom_id is a 400
 * and nothing is made (spec amendment 1). The tool names requests r0000-<key>, r0001-<key>, ... by index and the run's key (#140: they were bare r0000, ...), so the fake derives
 * each request's LOGICAL id from its content: q.customId is "docs/<slug>/<id>@<lang>" for a section and
 * "site/<lang>/<n>@<lang>" for a catalogue chunk (n counts the chunks of that language in the batch from 1, as the
 * tool does, and a retry request, which says "previous answer broke", keeps the id of the chunk its keys came from,
 * so attempt counts continue); the id on the wire is q.wireId. `script` and the tests speak logical ids. Results go back keyed by wire id.
 *
 * Every request must carry x-api-key equal to the key the fake was started with (a wrong or missing one is a 401).
 *
 * What each result says comes from `script(customId, attempt, request, answer)`: attempt counts the times that
 * custom_id has been sent (1, 2), request is {customId, lang, system, user, params, item} and answer is the default
 * (correct) answer object for the item. It returns undefined (use the default answer) or one of
 *   { answer: <object or string> }   the model's JSON (an object is stringified; a string is sent as it is)
 *   { errored: true } | { expired: true } | { canceled: true } | { refusal: true } | { cutoff: true }
 *   (cutoff: the model ran out of max_tokens, stop_reason "max_tokens", half an answer)
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
  if (how === "canceled") return { custom_id: customId, result: { type: "canceled" } };
  if (how === "cutoff") return { custom_id: customId, result: { type: "succeeded", message: { ...base, content: [{ type: "text", text: '{"title":"cut off' }], stop_reason: "max_tokens" } } };
  if (how === "refusal") return { custom_id: customId, result: { type: "succeeded", message: { ...base, content: [], stop_reason: "refusal" } } };
  const text = typeof answer === "string" ? answer : JSON.stringify(answer);
  return { custom_id: customId, result: { type: "succeeded", message: { ...base, content: [{ type: "text", text }], stop_reason: "end_turn" } } };
}

/*
 * startFake({ key, script, polls, never, status, drop, corrupt, endAs })
 *   polls   GETs of a batch before it reads as ended (default 1)
 *   never   the batch never ends; a number n: the batches numbered n and up (from 0) never end, the earlier ones do
 *   status  answer every POST /v1/messages/batches with this HTTP status (e.g. 401)
 *   drop    destroy the connection of the first `drop` POSTs (a network failure)
 *   corrupt how the results are mangled: "shuffle" (reverse order), "unknown" (one custom_id the batch never had),
 *           "duplicate" (one custom_id twice), "notjson" (a line that is not JSON), "nocustomid" (a line with no
 *           custom_id), "nourl" (the batch ends with no results_url). fake.corrupt is settable: it is read when a
 *           batch is made, so a test can make one malformed batch and then flip it off for the next (#140)
 *   endAs   the batch ends with every request "errored" | "expired" | "canceled" (results lines of that type)
 *   lose    the first `lose` POSTs of a batch are done (the batch exists) but the connection is destroyed before the
 *           answer: a lost response
 *   redirectResults  the results call answers 302 to this URL (another origin)
 *   flood   "results" | "status": that call answers with a body that does not end, 1 MiB at a time, up to 256 MiB;
 *           fake.flooded is { sent, aborted }: the bytes written and whether the reader hung up before the end
 *   hang    "status": GET of a batch never answers
 * A batch's request_counts are the real ones, counted from the results it will hold: succeeded (a refusal and a
 * max_tokens cut-off are succeeded too), errored, expired, canceled; processing while it runs.
 * fake.never is settable: flip it to false and the next poll sees the batch ended (a resume).
 * Returns { url, requests, batches, posts, cancels, close() }. url is the --api-base.
 */
export async function startFake({ key = FAKE_KEY, script = () => undefined, polls = 1, never = false, status = 0, drop = 0, corrupt = "", endAs = "", lose = 0, redirectResults = "", flood = "", hang = "" } = {}) {
  const state = { never, corrupt, flooded: { sent: 0, aborted: false } };
  let lost = 0;
  const keyChunk = {};
  const requests = [], batches = [];
  let posts = 0;
  const neverFor = (n) => (state.never === true || (typeof state.never === "number" && n >= state.never));
  const batchView = (b, origin) => {
    const ended = !neverFor(batches.indexOf(b)) && b.gets >= polls && !b.cancelled;
    return { id: b.id, type: "message_batch", processing_status: ended ? "ended" : b.cancelled ? "canceling" : "in_progress",
      request_counts: ended ? { succeeded: 0, errored: 0, canceled: 0, expired: 0, ...b.counts } : { processing: b.lines.length }, results_url: ended && !b.noUrl ? `${origin}/v1/messages/batches/${b.id}/results` : null };
  };
  /* a body that does not end: 1 MiB at a time up to 256 MiB, waiting for each chunk to be taken; records whether the
     reader hung up before the end */
  const streamFlood = (res, type, head) => {
    const MiB = 1 << 20, total = 256;
    state.flooded = { sent: 0, aborted: false };
    res.writeHead(200, { "content-type": type });
    let done = false;
    res.on("close", () => { if (!done) state.flooded.aborted = true; });
    const chunk = Buffer.alloc(MiB, 97);
    let n = 0;
    const pump = () => {
      while (!res.destroyed && n < total) {
        const ok = res.write(n === 0 && head ? Buffer.concat([Buffer.from(head), chunk]) : chunk);
        state.flooded.sent += MiB; n++;
        if (!ok) return res.once("drain", pump);
      }
      if (!res.destroyed) { done = true; res.end(); }
    };
    pump();
  };
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
          if (item && item.items) {
            /* the tool numbers the chunks of a language from 1 in the order of its request list; a retry carries only the
               keys that broke, so it takes the number its first key had when it was sent whole */
            const first = item.items[0] && item.items[0].id, retry = /previous answer broke/i.test(user);
            if (!(retry && `${lang}|${first}` in keyChunk)) {
              const n = 1 + sent.filter((x) => x.item && x.item.items && x.lang === lang && !/previous answer broke/i.test(x.user)).length;
              for (const x of item.items) keyChunk[`${lang}|${x.id}`] = n;
            }
            logical = `site/${lang}/${keyChunk[`${lang}|${first}`]}@${lang}`;
          }
          else if (item) logical = `docs/${item.slug}/${item.id}@${lang}`;
          const attempt = 1 + batches.reduce((n, b) => n + b.requests.filter((x) => x.customId === logical).length, 0) + sent.filter((x) => x.customId === logical).length;
          const q = { customId: logical, wireId: r.custom_id, lang, system: systemText(r.params), user, params: r.params, item };
          sent.push(q);
          const answer = item ? defaultAnswer(item) : {};
          const s = script(logical, attempt, q, answer) || {};
          lines.push(resultLine(r.custom_id, endAs ? endAs : s.errored ? "errored" : s.expired ? "expired" : s.canceled ? "canceled" : s.refusal ? "refusal" : s.cutoff ? "cutoff" : "ok", s.answer !== undefined ? s.answer : answer));
        }
        /* the counts the real API reports, from what each request ended as (before any scripted corruption of the file) */
        const counts = { succeeded: 0, errored: 0, canceled: 0, expired: 0 };
        for (const l of lines) counts[l.result.type] = (counts[l.result.type] || 0) + 1;
        const corrupt = state.corrupt;   /* read when the batch is made, so a test can flip it between batches */
        if (corrupt === "shuffle") lines.reverse();
        if (corrupt === "unknown" && lines.length) lines[0] = { ...lines[0], custom_id: "r9999" };
        if (corrupt === "duplicate" && lines.length > 1) lines.push({ ...lines[0] });
        if (corrupt === "notjson" && lines.length) lines[0] = "{this line is not json";
        if (corrupt === "nocustomid" && lines.length) { const { custom_id, ...rest } = lines[0]; lines[0] = rest; }
        batches.push({ id, requests: sent, lines, counts, gets: 0, cancelled: false, noUrl: corrupt === "nourl" });
        if (lost < lose) { lost++; req.socket.destroy(); return; }
        return send(200, { id, type: "message_batch", processing_status: "in_progress", request_counts: { processing: sent.length }, results_url: null });
      }
      if (req.method === "GET" && path === "/v1/messages/batches") {
        const view = (b) => batchView(b, origin);
        return send(200, { data: [...batches].reverse().map(view), has_more: false, first_id: batches.length ? batches[batches.length - 1].id : null, last_id: batches.length ? batches[0].id : null });
      }
      if (req.method === "GET" && (m = /^\/v1\/messages\/batches\/([\w-]+)$/.exec(path))) {
        const b = batches.find((x) => x.id === m[1]);
        if (!b) return send(404, { type: "error", error: { type: "not_found_error", message: "no such batch" } });
        if (hang === "status") return; /* never answered */
        if (flood === "status") return streamFlood(res, "application/json", '{"id":"x","pad":"');
        b.gets++;
        return send(200, batchView(b, origin));
      }
      if (req.method === "GET" && (m = /^\/v1\/messages\/batches\/([\w-]+)\/results$/.exec(path))) {
        const b = batches.find((x) => x.id === m[1]);
        if (!b) return send(404, { type: "error", error: { type: "not_found_error", message: "no such batch" } });
        if (redirectResults) { res.writeHead(302, { location: redirectResults }); return res.end(); }
        if (flood === "results") return streamFlood(res, "application/x-jsonl", "");
        return send(200, b.lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n", "application/x-jsonl");
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
    get corrupt() { return state.corrupt; }, set corrupt(v) { state.corrupt = v; },
    get flooded() { return state.flooded; },
    get posts() { return requests.filter((r) => r.method === "POST" && r.path.split("?")[0] === "/v1/messages/batches").length; },
    get cancels() { return requests.filter((r) => r.method === "POST" && r.path.endsWith("/cancel")); },
    /* every request of every batch, in the order sent */
    get sent() { return batches.flatMap((b, n) => b.requests.map((q) => ({ ...q, batch: n }))); },
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}
