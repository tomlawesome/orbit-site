// The lint's `types` section (#30): every module in assets/door/ passes
// TypeScript's checkJs in strict mode, with the settings in
// tools/ci/tsconfig.door.json. Orbit copies the folder unchanged and
// type-checks its own code strictly, so a renamed option or a wrong argument
// shows here, not in Orbit's import. TypeScript comes from tools/node_modules
// (npm ci --prefix tools), or NODE_PATH in a scratch copy; without it this fails.
// Sets exitCode rather than calling exit(), which can cut a piped log short.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function findTsc() {
  try {
    // its exports map hides bin/, so read the path from its package.json
    const pkg = createRequire(new URL("../package.json", import.meta.url)).resolve("typescript/package.json");
    return join(dirname(pkg), JSON.parse(readFileSync(pkg, "utf8")).bin.tsc);
  } catch {
    return null;
  }
}

const tsc = findTsc();
if (!tsc) {
  console.log("   cannot find TypeScript; run npm ci --prefix tools --ignore-scripts first");
  process.exitCode = 1;
} else {
  const r = spawnSync(process.execPath, [tsc, "-p", "tools/ci/tsconfig.door.json", "--pretty", "false"],
    { encoding: "utf8", maxBuffer: 64 << 20 });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (out) console.log(out.replace(/^/gm, "   "));
  if (r.status !== 0) {
    if (!out) console.log(`   tsc stopped with no output (${r.error ? r.error.message : `exit ${r.status}, signal ${r.signal}`})`);
    process.exitCode = 1;
  }
}
