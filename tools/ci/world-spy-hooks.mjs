/* Module customization hooks for world-wire-test.mjs: install.js's own import of "./world.js" gets the spy
   (world-spy.mjs); every other importer, and the spy's own import of the real file, keep the real one. */
export async function resolve(specifier, context, next) {
  const parent = context.parentURL || "";
  if (specifier === "./world.js" && /\/assets\/js\/install\.js$/.test(parent)) {
    return { url: new URL("./world-spy.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
