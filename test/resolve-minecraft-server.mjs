/**
 * Maps the addon's "…from \"@minecraft/server\"" import onto the test double, so
 * the tests exercise scripts/main.js itself rather than a copy of it.
 */
const stub = new URL("./stub/minecraft-server.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@minecraft/server") {
    return { url: stub, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
