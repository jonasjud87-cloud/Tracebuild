/** Ergänzende Negativtests (Review): Token in keinem Fehlerpfad, fremde Antworten, Cache, Client-Grenze. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTtlCache } from "./cache";
import { checkAccess, loadCard } from "./service";
import { PROVIDER_KEYS, type CardResult, type FetchImpl, type MonitoringEnv, type ProviderDeps, type RpcFn } from "./types";

const NOW = new Date("2026-11-10T12:00:00Z");
const SECRET = "tok_GEHEIM_987654";

/** Alle Tokens gesetzt, alle mit demselben Geheimnis. */
const ALL_ENV: MonitoringEnv = {
  MONITORING_VERCEL_TOKEN: SECRET,
  MONITORING_VERCEL_PROJECT_ID: "prj_1",
  MONITORING_VERCEL_TEAM_ID: "team_1",
  MONITORING_GITHUB_TOKEN: SECRET,
  MONITORING_RESEND_API_KEY: SECRET,
  MONITORING_SUPABASE_PAT: SECRET,
  ANTHROPIC_API_KEY: SECRET,
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_SERVICE_KEY: SECRET,
  NEXT_PUBLIC_SITE_URL: "https://www.tracebuild.ch",
};

async function card(provider: string, env: MonitoringEnv, d: ProviderDeps): Promise<CardResult> {
  const r = await loadCard(provider, { env, deps: d, cache: createTtlCache(), usdToChf: 0.8 });
  assert.equal(r.status, 200);
  if (r.status !== 200) throw new Error("unerwartet");
  return r.data;
}

/** Fremde Antworten und Fehler, die das Geheimnis enthalten (Echo von Header, URL oder Body). */
const LEAKY_FETCHES: [string, FetchImpl][] = [
  ["401 mit Echo im JSON", async () => new Response(JSON.stringify({ error: { message: `bad token ${SECRET}` } }), { status: 401 })],
  ["500 HTML mit Echo", async () => new Response(`<html>Authorization: Bearer ${SECRET}</html>`, { status: 500 })],
  ["200 HTML statt JSON mit Echo", async () => new Response(`<html>${SECRET}</html>`, { status: 200 })],
  ["200 JSON falsche Form mit Echo", async () => new Response(JSON.stringify({ unexpected: SECRET }), { status: 200 })],
  ["fetch wirft mit Token in Meldung", async url => { throw new TypeError(`fetch failed for ${url} Bearer ${SECRET}`); }],
  ["fetch wirft Nicht-Error", async () => { throw `string ${SECRET}`; }],
  ["Abbruch mit Token", async () => { throw Object.assign(new Error(`aborted ${SECRET}`), { name: "AbortError" }); }],
  ["Body-Lesen wirft", async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => { throw new Error(SECRET); } }) as unknown as Response],
];

const LEAKY_RPCS: [string, RpcFn][] = [
  ["RPC-Fehler mit Token", async () => ({ data: null, error: { message: `permission denied ${SECRET}` } })],
  ["RPC wirft", async () => { throw new Error(`connect ECONNREFUSED ${SECRET}`); }],
  ["RPC liefert falsche Form", async () => ({ data: { db_bytes: "x", tables: SECRET, available: SECRET }, error: null })],
];

for (const [fname, fetchImpl] of LEAKY_FETCHES) {
  for (const [rname, rpc] of LEAKY_RPCS) {
    test(`Kein Token im Resultat: ${fname} / ${rname}`, async () => {
      const d: ProviderDeps = {
        fetchImpl,
        now: () => NOW,
        rpc,
        tls: async () => { throw new Error(`tls ${SECRET}`); },
        timeoutMs: 8000,
      };
      for (const p of PROVIDER_KEYS) {
        const c = await card(p, ALL_ENV, d);
        const s = JSON.stringify(c);
        assert.ok(!s.includes(SECRET), `${p}: Token im Resultat`);
        assert.ok(!s.includes("Bearer"), `${p}: Header-Text im Resultat`);
        assert.ok(!s.includes("<html"), `${p}: Rohtext der Gegenstelle im Resultat`);
        assert.notEqual(c.state, "unconfigured", p);
      }
    });
  }
}

test("Token nie in einer abgerufenen URL (nur im Header)", async () => {
  const urls: string[] = [];
  const fetchImpl: FetchImpl = async url => {
    urls.push(url);
    return new Response("{}", { status: 404 });
  };
  const d: ProviderDeps = { fetchImpl, now: () => NOW, rpc: async () => ({ data: null, error: null }), tls: async () => ({ validTo: "2027-01-01T00:00:00Z", authorized: true }) };
  for (const p of PROVIDER_KEYS) await card(p, ALL_ENV, d);
  assert.ok(urls.length > 0);
  for (const u of urls) {
    assert.ok(!u.includes(SECRET), u);
    assert.ok(u.startsWith("https://"), u);
  }
});

test("Statusseiten: HTML, leere Felder, components null → warn je Seite, keine Rohtexte", async () => {
  const bodies = [
    "<html><body>Wartung</body></html>",
    JSON.stringify({}),
    JSON.stringify({ status: {} }),
    JSON.stringify({ status: { indicator: "" }, components: null }),
    JSON.stringify({ status: { indicator: "none", description: null }, components: [{ name: "API", status: "partial_outage" }] }),
  ];
  let i = 0;
  const fetchImpl: FetchImpl = async () => new Response(bodies[i++ % bodies.length], { status: 200 });
  const c = await card("status", {}, { fetchImpl, now: () => NOW });
  assert.equal(c.metrics.length, 5);
  assert.ok(c.metrics.slice(0, 3).every(m => m.state === "warn" && m.value === "Nicht erreichbar"));
  assert.equal(c.metrics[3].state, "warn", "leerer Indicator → warn");
  // indicator none, aber Komponente gestört: Karte bleibt nach Indicator ok, Hinweis nennt Komponente.
  assert.equal(c.metrics[4].state, "ok");
  assert.match(c.metrics[4].hint ?? "", /API: partial_outage/);
  assert.ok(!JSON.stringify(c).includes("<html"));
});

test("Vercel: leere Deployment-Liste → warn, kein Absturz", async () => {
  const fetchImpl: FetchImpl = async url =>
    url.includes("/deployments") ? new Response(JSON.stringify({ deployments: [] }), { status: 200 }) : new Response("{}", { status: 404 });
  const c = await card("vercel", { MONITORING_VERCEL_TOKEN: SECRET, MONITORING_VERCEL_PROJECT_ID: "prj_1" }, { fetchImpl, now: () => NOW });
  assert.equal(c.state, "warn");
  assert.equal(c.message, "Kein Produktions-Deployment gefunden");
});

test("Vercel: Billing-Antwort HTML → Zeilen ungültig, Summe 0, kein Rohtext", async () => {
  const fetchImpl: FetchImpl = async url => {
    if (url.includes("/deployments")) return new Response(JSON.stringify({ deployments: [{ uid: "d1", readyState: "READY", created: 1 }] }), { status: 200 });
    if (url.includes("/billing/charges")) return new Response(`<html>${SECRET}</html>`, { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const c = await card("vercel", { MONITORING_VERCEL_TOKEN: SECRET, MONITORING_VERCEL_PROJECT_ID: "prj_1", MONITORING_VERCEL_TEAM_ID: "team_1" }, { fetchImpl, now: () => NOW });
  const usage = c.costs.find(x => x.source === "api");
  assert.equal(usage?.usd, 0);
  assert.match(usage?.note ?? "", /nicht lesbar/);
  assert.ok(!JSON.stringify(c).includes(SECRET));
});

test("Supabase: PAT mit eigener Domain → kein Management-Abruf, Hinweis", async () => {
  const urls: string[] = [];
  const fetchImpl: FetchImpl = async url => {
    urls.push(url);
    return new Response("{}", { status: 200 });
  };
  const rpc: RpcFn = async () => ({ data: { db_bytes: 1, tables: [], storage: [], auth_users: 0, auth_active_30d: 0, cron: null, net: null }, error: null });
  const c = await card(
    "supabase",
    { NEXT_PUBLIC_SUPABASE_URL: "https://db.tracebuild.ch", SUPABASE_SERVICE_KEY: SECRET, MONITORING_SUPABASE_PAT: SECRET },
    { fetchImpl, now: () => NOW, rpc }
  );
  assert.equal(urls.length, 0);
  assert.ok(c.notes.some(n => /Projekt-Ref/.test(n)));
  assert.ok(!JSON.stringify(c).includes(SECRET));
});

test("Supabase: Antwort enthält keine E-Mail-Adressen, nur Zahlen zu Konten", async () => {
  const rpc: RpcFn = async () => ({
    data: { db_bytes: 1, tables: [], storage: [], auth_users: 3, auth_active_30d: 1, cron: null, net: null, users: [{ email: "a@b.ch" }] },
    error: null,
  });
  const c = await card("supabase", { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_KEY: SECRET }, { fetchImpl: async () => new Response("{}"), now: () => NOW, rpc });
  assert.ok(!JSON.stringify(c).includes("@"));
});

test("Claude: ohne Schlüssel, Migration fehlt → warn statt error, kein Ping", async () => {
  const urls: string[] = [];
  const fetchImpl: FetchImpl = async url => {
    urls.push(url);
    return new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 });
  };
  const rpc: RpcFn = async () => ({ data: null, error: { message: "Could not find the function public.monitoring_ai_costs(p_since) in the schema cache" } });
  const c = await card("anthropic", { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_KEY: SECRET }, { fetchImpl, now: () => NOW, rpc });
  assert.equal(c.state, "warn");
  assert.match(c.message ?? "", /Migration fehlt/);
  assert.ok(urls.every(u => !u.includes("api.anthropic.com")));
});

test("Geoportal: RPC liefert null → Formatfehler, state error", async () => {
  const c = await card("geoportal", { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_KEY: SECRET }, {
    fetchImpl: async () => new Response("{}"),
    now: () => NOW,
    rpc: async () => ({ data: null, error: null }),
  });
  assert.equal(c.state, "error");
  assert.equal(c.message, "Unerwartetes Antwortformat");
});

test("Cache: fresh während laufendem Abruf teilt den Loader", async () => {
  const cache = createTtlCache(() => 0);
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>(r => (release = r));
  const loader = async () => {
    calls++;
    await gate;
    return calls;
  };
  const a = cache.get("k", 1000, loader);
  const b = cache.get("k", 1000, loader, { fresh: true });
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(ra.value, rb.value);
});

test("Cache: Fehler nach 30 s neu, fresh innerhalb 30 s wirkt nicht zweimal", async () => {
  let t = 0;
  const cache = createTtlCache(() => t);
  let n = 0;
  const loader = async () => ({ state: "error", n: ++n });
  const opts = { isError: (v: { state: string }) => v.state === "error" };
  await cache.get("k", 300_000, loader, opts);
  await cache.get("k", 300_000, loader, { ...opts, fresh: true });
  assert.equal(n, 2);
  t = 10_000;
  const hit = await cache.get("k", 300_000, loader, { ...opts, fresh: true });
  assert.equal(hit.cached, true, "zweites fresh innerhalb 30 s kommt aus dem Cache");
  t = 31_000;
  await cache.get("k", 300_000, loader, opts);
  assert.equal(n, 3, "Fehlerresultat nach 30 s abgelaufen");
});

test("Rollen: unbekannte oder leere Rolle → 403", () => {
  for (const role of ["", "SUPER_ADMIN", "super_admin "] as unknown as ("super_admin")[]) {
    assert.equal(checkAccess({ role })?.status, 403, JSON.stringify(role));
  }
});

test("Unbekannter Dienst: Prototyp-Schlüssel und Gross-/Kleinschreibung → 400", async () => {
  const d: ProviderDeps = { fetchImpl: async () => { throw new Error("kein Netz"); }, now: () => NOW };
  for (const p of ["constructor", "toString", "hasOwnProperty", "Vercel", "vercel ", "", "../vercel"]) {
    const r = await loadCard(p, { env: ALL_ENV, deps: d, cache: createTtlCache(), usdToChf: 0.8 });
    assert.equal(r.status, 400, JSON.stringify(p));
  }
});

// ── Client-Grenze: Client-Komponenten importieren keinen Server-Code ─────────
const FRONTEND = fileURLToPath(new URL("../../", import.meta.url));

function clientFiles(): string[] {
  const dirs = [join(FRONTEND, "components", "admin", "tools"), join(FRONTEND, "components", "admin", "overview")];
  const out: string[] = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (!/\.(tsx?|jsx?)$/.test(f) || f.endsWith(".test.ts")) continue;
      const p = join(dir, f);
      if (/^\s*["']use client["']/.test(readFileSync(p, "utf8"))) out.push(p);
    }
  }
  return out;
}

test("Client-Komponenten: nur Typen aus lib/tool-monitoring, kein runtime/service/providers/admin", () => {
  const files = clientFiles();
  assert.ok(files.length >= 3);
  for (const p of files) {
    const src = readFileSync(p, "utf8");
    for (const m of Array.from(src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm))) {
      const isType = Boolean(m[1]);
      const spec = m[2];
      assert.ok(!/tool-monitoring\/(runtime|service|providers|http|tls|registry|cache|parse)/.test(spec), `${p}: ${spec}`);
      assert.ok(!/supabase\/admin|node:/.test(spec), `${p}: ${spec}`);
      if (spec.includes("tool-monitoring/")) assert.ok(isType, `${p}: Wertimport ${spec}`);
    }
    assert.ok(!/MONITORING_|SUPABASE_SERVICE_KEY|ANTHROPIC_API_KEY/.test(src), `${p}: Env-Name im Client`);
  }
});

// ── Fremde Links: nur https als href ──
test("Links aus fremden Antworten nur https", async () => {
  const fetchImpl: FetchImpl = async url =>
    url.includes("/deployments")
      ? new Response(JSON.stringify({ deployments: [{ uid: "d1", readyState: "ERROR", created: 2, inspectorUrl: "javascript:alert(1)" }] }), { status: 200 })
      : new Response("{}", { status: 404 });
  const c = await card("vercel", { MONITORING_VERCEL_TOKEN: SECRET, MONITORING_VERCEL_PROJECT_ID: "prj_1" }, { fetchImpl, now: () => NOW });
  assert.ok(c.links.every(l => l.href.startsWith("https://")), JSON.stringify(c.links));
});
