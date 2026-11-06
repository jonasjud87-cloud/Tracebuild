// Resolver für Node-Tests: Imports ohne Endung (tsc/Next-Konvention) auf .ts abbilden.
// Einbinden mit: node --import ./scripts/ts-resolve-hook.mjs --test "lib/**/*.test.ts"
import { registerHooks } from "node:module";

// Der Pfad-Alias aus tsconfig.json, damit auch Module mit `@/lib/...` testbar sind.
const ROOT = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(`${new URL(specifier.slice(2), ROOT).href}.ts`, context);
    }
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
