// Resolver für Node-Tests: Imports ohne Endung (tsc/Next-Konvention) auf .ts abbilden.
// Einbinden mit: node --import ./scripts/ts-resolve-hook.mjs --test "lib/**/*.test.ts"
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$|\.json$/.test(specifier)) {
      return nextResolve(specifier, context);
    }
    try {
      return nextResolve(`${specifier}.ts`, context);
    } catch {
      return nextResolve(specifier, context);
    }
  },
});
