/* Module customization hooks for stale-prove-test.mjs: the engine's own import of "./voyage.js" gets the fake
   (fake-voyage.mjs); every other importer, and the fake's own import of the real file, keep the real one. */
export async function resolve(specifier, context, next) {
  const parent = context.parentURL || "";
  if (specifier === "./voyage.js" && /\/assets\/door\/engine\.js$/.test(parent)) {
    return { url: new URL("./fake-voyage.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
