import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtlCache } from "./cache";
import { REGISTRY, type Registry } from "./registry";
import { checkAccess, isHttpsUrl, listProviders, loadCard } from "./service";
import type { ProviderDeps } from "./types";

const deps: ProviderDeps = { fetchImpl: async () => { throw new Error("kein Netz im Test"); }, now: () => new Date("2026-11-10T12:00:00Z") };

test("Rollen: nur super_admin", () => {
  assert.deepEqual(checkAccess(null), { status: 401, error: "Nicht eingeloggt" });
  for (const role of ["org_admin", "project_manager", "member"] as const) {
    assert.equal(checkAccess({ role })?.status, 403, role);
  }
  assert.equal(checkAccess({ role: "super_admin" }), null);
});

test("Unbekannter Dienst → 400", async () => {
  const r = await loadCard("foo", { env: {}, deps, cache: createTtlCache(), usdToChf: 0.8 });
  assert.deepEqual(r, { status: 400, error: "Unbekannter Dienst" });
  const r2 = await loadCard("__proto__", { env: {}, deps, cache: createTtlCache(), usdToChf: 0.8 });
  assert.equal(r2.status, 400);
});

function throwingRegistry(err: unknown, counter: { n: number }): Registry {
  return {
    ...REGISTRY,
    github: {
      ...REGISTRY.github,
      configured: () => true,
      load: async () => {
        counter.n++;
        throw err;
      },
    },
  };
}

test("Provider wirft → state error, Rohtext nicht durchgereicht, kurz gecacht", async () => {
  const counter = { n: 0 };
  const cache = createTtlCache();
  const opts = { env: {}, deps, cache, usdToChf: 0.8, registry: throwingRegistry(new Error("Bearer tok_GEHEIM"), counter) };
  const r = await loadCard("github", opts);
  assert.equal(r.status, 200);
  if (r.status !== 200) return;
  assert.equal(r.data.state, "error");
  assert.equal(r.data.message, "Unerwarteter Fehler beim Abruf");
  assert.ok(!JSON.stringify(r.data).includes("GEHEIM"));
  assert.equal(r.data.checkedAt, "2026-11-10T12:00:00.000Z");
  const again = await loadCard("github", opts);
  assert.equal(again.status === 200 && again.data.cached, true);
  assert.equal(counter.n, 1);
});

test("listProviders: Reihenfolge und konfiguriert", () => {
  const list = listProviders({ MONITORING_GITHUB_TOKEN: "x" });
  assert.deepEqual(list.map(p => p.key), ["status", "vercel", "supabase", "github", "resend", "anthropic", "domain", "geoportal"]);
  assert.equal(list.find(p => p.key === "github")?.configured, true);
  assert.equal(list.find(p => p.key === "vercel")?.configured, false);
  assert.equal(list.find(p => p.key === "status")?.configured, true);
  assert.ok(!JSON.stringify(list).includes("\"x\""));
});

test("isHttpsUrl: nur gültige https-URLs", () => {
  assert.equal(isHttpsUrl("https://vercel.com/x"), true);
  for (const bad of ["http://vercel.com", "javascript:alert(1)", "data:text/html,x", "//vercel.com", "", "kein url"]) {
    assert.equal(isHttpsUrl(bad), false, bad);
  }
});
