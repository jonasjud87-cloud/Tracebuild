/** Provider mit Attrappen für fetch, RPC und TLS. Kein Netzaufruf. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtlCache } from "./cache";
import { loadCard } from "./service";
import type { CardResult, FetchImpl, MonitoringEnv, ProviderDeps, RpcFn } from "./types";

const NOW = new Date("2026-11-10T12:00:00Z");
const SECRET = "tok_GEHEIM_123456";

type Handler = (url: string) => Response | Error | Promise<Response | Error>;

function fakeFetch(routes: [string, Handler][]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes.find(([part]) => url.includes(part));
    if (!route) return new Response("{}", { status: 404 });
    const out = await route[1](url);
    if (out instanceof Error) throw out;
    return out;
  };
  return { impl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const timeoutError = () => Object.assign(new Error("signal timed out"), { name: "TimeoutError" });

function deps(fetchImpl: FetchImpl, extra: Partial<ProviderDeps> = {}): ProviderDeps {
  return { fetchImpl, now: () => NOW, timeoutMs: 8000, ...extra };
}

async function card(provider: string, env: MonitoringEnv, d: ProviderDeps): Promise<CardResult> {
  const r = await loadCard(provider, { env, deps: d, cache: createTtlCache(), usdToChf: 0.8 });
  assert.equal(r.status, 200);
  if (r.status !== 200) throw new Error("unerwartet");
  return r.data;
}

const STATUS_OK = { status: { indicator: "none", description: "All Systems Operational" }, components: [] };

test("Ohne Env: Karten unconfigured und kein fetch", async () => {
  const f = fakeFetch([]);
  let rpcCalls = 0;
  const rpc: RpcFn = async () => {
    rpcCalls++;
    return { data: null, error: null };
  };
  for (const p of ["vercel", "supabase", "github", "resend", "anthropic", "domain", "geoportal"]) {
    const c = await card(p, {}, deps(f.impl, { rpc, tls: async () => { throw new Error("darf nicht laufen"); } }));
    assert.equal(c.state, "unconfigured", p);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(rpcCalls, 0);
});

test("Vercel: 401 → error deutsch, Token nie im Resultat", async () => {
  const f = fakeFetch([["api.vercel.com", () => json({ error: { message: `invalid token ${SECRET}` } }, 401)]]);
  const c = await card("vercel", { MONITORING_VERCEL_TOKEN: SECRET, MONITORING_VERCEL_PROJECT_ID: "prj_1" }, deps(f.impl));
  assert.equal(c.state, "error");
  assert.equal(c.message, "HTTP 401: Token ungültig oder abgelaufen");
  assert.ok(!JSON.stringify(c).includes(SECRET));
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${SECRET}`);
});

for (const [name, handler, expected] of [
  ["403", () => json({}, 403), "HTTP 403: Keine Berechtigung für diese Abfrage"],
  ["429", () => json({}, 429), "HTTP 429: Anfragelimit erreicht"],
  ["500", () => new Response("<html>Fehler mit Details</html>", { status: 500 }), "HTTP 500: Dienst gestört"],
  ["Timeout", () => timeoutError(), "Zeitüberschreitung nach 8 s"],
  ["Netz", () => new TypeError("fetch failed"), "Dienst nicht erreichbar"],
  ["kein JSON", () => new Response("<html>login</html>", { status: 200 }), "Ungültige Antwort (kein JSON)"],
] as [string, Handler, string][]) {
  test(`Resend: ${name} → error mit fester Meldung`, async () => {
    const f = fakeFetch([["api.resend.com", handler]]);
    const c = await card("resend", { MONITORING_RESEND_API_KEY: SECRET }, deps(f.impl));
    assert.equal(c.state, "error");
    assert.equal(c.message, expected);
    assert.ok(!JSON.stringify(c).includes(SECRET));
    assert.ok(!JSON.stringify(c).includes("Details"));
  });
}

test("Resend: daily.limit null ok, Monatslimit aus Plan, Domain nicht verifiziert → warn", async () => {
  const f = fakeFetch([
    ["/usage", () => json({ emails: { daily: { used: 99, limit: null }, monthly: { used: 2500 } } })],
    ["/domains", () => json({ data: [{ id: "d1", name: "tracebuild.ch", status: "pending" }] })],
  ]);
  const c = await card("resend", { MONITORING_RESEND_API_KEY: SECRET }, deps(f.impl));
  const daily = c.metrics.find(m => m.label === "E-Mails heute");
  const monthly = c.metrics.find(m => m.label === "E-Mails im Monat");
  assert.equal(daily?.state, "ok");
  assert.equal(daily?.source, "api");
  assert.match(daily?.value ?? "", /ohne Limit/);
  assert.equal(monthly?.source, "plan");
  assert.equal(monthly?.state, "warn");
  assert.equal(c.metrics.find(m => m.label.startsWith("Domain"))?.state, "warn");
  assert.equal(c.state, "warn");
  assert.ok(c.notes.some(n => n.includes("info@tracebuild.ch")));
});

test("Resend: /usage 404 → Planwerte und Hinweis, Domain verifiziert", async () => {
  const f = fakeFetch([["/domains", () => json({ data: [{ name: "tracebuild.ch", status: "verified" }] })]]);
  const c = await card("resend", { MONITORING_RESEND_API_KEY: SECRET }, deps(f.impl));
  assert.equal(c.metrics.find(m => m.label === "E-Mails heute")?.source, "plan");
  assert.ok(c.notes.some(n => n.startsWith("Nutzung nicht abrufbar: HTTP 404")));
  assert.equal(c.state, "warn");
});

const GH_ENV = { MONITORING_GITHUB_TOKEN: SECRET };

test("GitHub: Dependabot 403 → nicht aktiviert, kein Fehler", async () => {
  const f = fakeFetch([
    ["/actions/runs", () => json({ workflow_runs: [{ name: "CI", status: "completed", conclusion: "success" }] }, 200, { "x-ratelimit-remaining": "4999" })],
    ["/pulls", () => json([{ id: 1 }, { id: 2 }])],
    ["/dependabot/alerts", () => json({ message: "Dependabot alerts are disabled" }, 403)],
    ["/commits/main", () => json({ sha: "abcdef1234", html_url: "https://github.com/x", commit: { author: { date: "2026-11-10T10:00:00Z" } } })],
  ]);
  const c = await card("github", GH_ENV, deps(f.impl));
  assert.equal(c.state, "ok");
  assert.equal(c.metrics.find(m => m.label === "Dependabot-Warnungen")?.value, "Nicht aktiviert");
  assert.equal(c.metrics.find(m => m.label === "Offene Pull Requests")?.value, "2");
  assert.ok(f.calls.every(x => x.url.startsWith("https://api.github.com/repos/jonasjud87-cloud/Tracebuild/")));
});

test("GitHub: CI-Fehler und hohe Warnungen → warn", async () => {
  const f = fakeFetch([
    ["/actions/runs", () => json({ workflow_runs: [{ name: "CI", conclusion: "failure" }] })],
    ["/pulls", () => json([])],
    ["/dependabot/alerts", () => json([{ security_advisory: { severity: "high" } }])],
    ["/commits/main", () => json({ sha: "abc" })],
  ]);
  const c = await card("github", GH_ENV, deps(f.impl));
  assert.equal(c.state, "warn");
});

test("GitHub: ungültiges Repo → error ohne fetch", async () => {
  const f = fakeFetch([]);
  const c = await card("github", { ...GH_ENV, MONITORING_GITHUB_REPO: "../../evil" }, deps(f.impl));
  assert.equal(c.state, "error");
  assert.equal(f.calls.length, 0);
});

const VERCEL_ENV = { MONITORING_VERCEL_TOKEN: SECRET, MONITORING_VERCEL_PROJECT_ID: "prj_1", MONITORING_GITHUB_TOKEN: "gh_x" };

test("Vercel: Produktion auf anderem SHA als main → warn", async () => {
  const f = fakeFetch([
    ["/v6/deployments", () => json({ deployments: [{ uid: "d1", created: 1, readyState: "READY", meta: { githubCommitSha: "old" } }] })],
    ["/commits/main", () => json({ sha: "new" })],
  ]);
  const c = await card("vercel", VERCEL_ENV, deps(f.impl));
  assert.equal(c.state, "warn");
  assert.equal(c.message, "Produktion ist hinter main");
  assert.ok(c.notes.includes("Abrechnung nur mit MONITORING_VERCEL_TEAM_ID"));
  assert.ok(!f.calls.some(x => x.url.includes("billing")));
  assert.match(f.calls[0].url, /projectId=prj_1&target=production&limit=10/);
});

test("Vercel: gleicher SHA ok, Billing mit Team-ID summiert", async () => {
  const jsonl = [JSON.stringify({ BilledCost: 2 }), JSON.stringify({ BilledCost: -0.5 })].join("\n");
  const f = fakeFetch([
    ["/v6/deployments", () => json({ deployments: [{ uid: "d1", created: 1, readyState: "READY", meta: { githubCommitSha: "same" } }] })],
    ["/commits/main", () => json({ sha: "same" })],
    ["/v1/billing/charges", () => new Response(jsonl, { status: 200 })],
  ]);
  const c = await card("vercel", { ...VERCEL_ENV, MONITORING_VERCEL_TEAM_ID: "team_1" }, deps(f.impl));
  assert.equal(c.state, "ok");
  assert.equal(c.costs.find(x => x.source === "api")?.usd, 1.5);
  const billing = f.calls.find(x => x.url.includes("billing"));
  assert.match(billing?.url ?? "", /from=2026-11-01T00%3A00%3A00\.000Z/);
  assert.match(billing?.url ?? "", /teamId=team_1/);
});

test("Vercel: letztes Deployment fehlgeschlagen → error", async () => {
  const f = fakeFetch([
    ["/v6/deployments", () => json({ deployments: [{ uid: "d2", created: 2, readyState: "ERROR" }, { uid: "d1", created: 1, readyState: "READY" }] })],
  ]);
  const c = await card("vercel", { MONITORING_VERCEL_TOKEN: SECRET, MONITORING_VERCEL_PROJECT_ID: "prj_1" }, deps(f.impl));
  assert.equal(c.state, "error");
});

const SB_ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_KEY: SECRET };

test("Supabase: Migration fehlt → warn mit Hinweis, kein fetch ohne PAT", async () => {
  const f = fakeFetch([]);
  const rpc: RpcFn = async () => ({ data: null, error: { message: "Could not find the function public.monitoring_db_stats without parameters in the schema cache" } });
  const c = await card("supabase", SB_ENV, deps(f.impl, { rpc }));
  assert.equal(c.state, "warn");
  assert.match(c.message ?? "", /Migration fehlt/);
  assert.equal(f.calls.length, 0);
});

test("Supabase: DB-Kennzahlen, Cron-Fehler → warn, PAT-Abrufe mit Ref", async () => {
  const rpc: RpcFn = async () => ({
    data: {
      db_bytes: 100 * 1024 * 1024,
      tables: [{ name: "analyses", bytes: 1000, rows: 5 }],
      storage: [{ bucket: "documents", bytes: 2048, objects: 2 }],
      auth_users: 10,
      auth_active_30d: 4,
      cron: [{ jobname: "analysis-dispatch", active: true, last_status: "failed", last_start: "2026-11-10T11:00:00Z", last_message: "boom", failed_24h: 2 }],
      net: [{ status_code: 200, n: 5, timed_out: 0 }],
    },
    error: null,
  });
  const f = fakeFetch([
    ["/health", () => json([{ name: "db", healthy: true, status: "ACTIVE_HEALTHY" }])],
    ["/disk/util", () => json({ metrics: { fs_size_bytes: 100, fs_avail_bytes: 10, fs_used_bytes: 90 } })],
    ["usage.api-counts", () => json({ result: [{ total_rest_requests: 7 }] })],
  ]);
  const c = await card("supabase", { ...SB_ENV, MONITORING_SUPABASE_PAT: "sbp_x" }, deps(f.impl, { rpc }));
  assert.equal(c.metrics.find(m => m.label === "Datenbank")?.state, "ok");
  assert.equal(c.metrics.find(m => m.label === "Cron: analysis-dispatch")?.state, "warn");
  assert.equal(c.metrics.find(m => m.label === "Disk")?.state, "warn");
  assert.equal(c.state, "warn");
  assert.ok(f.calls.every(x => x.url.startsWith("https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/")));
  assert.ok(!JSON.stringify(c).includes(SECRET));
});

test("Claude: Ping ok, Kosten aus DB je Quelle", async () => {
  const f = fakeFetch([
    ["api.anthropic.com/v1/models", () => json({ data: [{ id: "claude-x" }] })],
    ["status.claude.com", () => json(STATUS_OK)],
  ]);
  const rpc: RpcFn = async (fn, args) => {
    assert.equal(fn, "monitoring_ai_costs");
    assert.equal(args?.p_since, "2026-11-01T00:00:00.000Z");
    return {
      data: [
        { source: "analyses", day: "2026-11-10", cost_usd: 1.2, calls: 2 },
        { source: "analyses", day: "2026-11-09", cost_usd: 0.8, calls: 1 },
        { source: "chat", day: "2026-11-10", cost_usd: "0.1", calls: 4 },
      ],
      error: null,
    };
  };
  const c = await card("anthropic", { ...SB_ENV, ANTHROPIC_API_KEY: SECRET }, deps(f.impl, { rpc }));
  assert.equal(c.state, "ok");
  assert.deepEqual(c.costs.map(x => [x.label, x.usd]), [["Plananalysen", 2], ["Chat", 0.1]]);
  assert.equal(c.metrics.find(m => m.label === "Kosten heute")?.value, "1.30 USD");
  assert.equal(c.usdToChf, 0.8);
  assert.ok(!JSON.stringify(c).includes(SECRET));
});

test("Claude: Schlüssel ungültig → error", async () => {
  const f = fakeFetch([
    ["api.anthropic.com", () => json({ type: "error" }, 401)],
    ["status.claude.com", () => json(STATUS_OK)],
  ]);
  const c = await card("anthropic", { ANTHROPIC_API_KEY: SECRET }, deps(f.impl));
  assert.equal(c.state, "error");
  assert.equal(c.message, "HTTP 401: Token ungültig oder abgelaufen");
});

test("Domain: Zertifikat 10 Tage → warn, nicht vertraut → error", async () => {
  const env = { NEXT_PUBLIC_SITE_URL: "https://www.tracebuild.ch/app" };
  const f = fakeFetch([]);
  let host = "";
  const warn = await card("domain", env, deps(f.impl, { tls: async h => { host = h; return { validTo: "2026-11-20T12:00:00Z", authorized: true, issuer: "Let's Encrypt" }; } }));
  assert.equal(host, "www.tracebuild.ch");
  assert.equal(warn.state, "warn");
  const bad = await card("domain", env, deps(f.impl, { tls: async () => ({ validTo: "2027-06-01T00:00:00Z", authorized: false }) }));
  assert.equal(bad.state, "error");
  const unc = await card("domain", { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, deps(f.impl));
  assert.equal(unc.state, "unconfigured");
});

test("Geoportal: Kanton ohne Erfolg → warn; Tabelle fehlt → warn", async () => {
  const f = fakeFetch([]);
  const rpc: RpcFn = async () => ({
    data: { available: true, cantons: [{ canton: "SG", calls: 10, ok: 5, error_pct: 50, last_ok: null }], dead: [{ canton: "NE", calls: 3, last_attempt: "2026-11-09T10:00:00Z" }], geodata: [] },
    error: null,
  });
  const c = await card("geoportal", SB_ENV, deps(f.impl, { rpc }));
  assert.equal(c.state, "warn");
  assert.equal(c.metrics.find(m => m.label === "Fehlerquote (24 h)")?.value, "50.0 %");
  const none = await card("geoportal", SB_ENV, deps(f.impl, { rpc: async () => ({ data: { available: false }, error: null }) }));
  assert.equal(none.state, "warn");
});

test("Statusseiten: eine nicht erreichbar → warn, alle → error", async () => {
  const some = fakeFetch([
    ["vercel-status", () => json(STATUS_OK)],
    ["status.supabase.com", () => json({ status: { indicator: "major", description: "Major Outage" } })],
    ["githubstatus", () => timeoutError()],
    ["status.claude.com", () => json(STATUS_OK)],
    ["resend-status", () => json(STATUS_OK)],
  ]);
  const c = await card("status", {}, deps(some.impl));
  assert.equal(c.state, "error");
  assert.equal(c.metrics.find(m => m.label === "GitHub")?.state, "warn");
  const none = fakeFetch([["", () => new TypeError("fetch failed")]]);
  const all = await card("status", {}, deps(none.impl));
  assert.equal(all.state, "error");
  assert.equal(all.message, "Keine Statusseite erreichbar");
});
