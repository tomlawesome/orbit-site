/*
 * What the live browser tests share (#95, ADR-0005 sections 3a and 4). Node built-ins only.
 *
 *   freePort()                               a port the system gives (bind 0, read the number back, close)
 *   browserPlan(env, { own })                { mode: "connect", endpoint } when env.PW_WS_ENDPOINT is set and own is
 *                                            false, else { mode: "launch", headless: env.HEADED !== "1" }
 *   openBrowser(playwright, name, { own, launch })
 *                                            follows the plan for process.env: playwright[name].connect(endpoint), the
 *                                            job's one browser that tools/ci/live-run.mjs started, or
 *                                            playwright[name].launch({ headless, ...launch })
 *
 * A test with its own browser flags (freeze, docs-sky-portrait-live, upload's headless Chromium) passes own: true and
 * launches its own browser; the rest connect when the job has a browser, and each keeps a fresh context per case.
 */
import { createServer } from "node:net";

export const freePort = () => new Promise((ok, no) => {
  const probe = createServer();
  probe.on("error", no);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});

export const browserPlan = (env, { own = false } = {}) =>
  env.PW_WS_ENDPOINT && !own ? { mode: "connect", endpoint: env.PW_WS_ENDPOINT } : { mode: "launch", headless: env.HEADED !== "1" };

export const openBrowser = (playwright, name, { own = false, launch = {} } = {}) => {
  const plan = browserPlan(process.env, { own });
  return plan.mode === "connect" ? playwright[name].connect(plan.endpoint) : playwright[name].launch({ headless: plan.headless, ...launch });
};
