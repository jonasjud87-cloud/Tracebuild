/** Parser: Antwortformen nach den öffentlichen Dokumentationen (gekürzt), keine Live-Daten. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MonitorError } from "./http";
import {
  parseAiCosts,
  parseApiCounts,
  parseCommit,
  parseDbStats,
  parseDependabot,
  parseDiskUtil,
  parseGeoportalHealth,
  parseLatestRuns,
  parseResendDomains,
  parseResendUsage,
  parseStatusSummary,
  parseSupabaseHealth,
  parseVercelDeployments,
  sumFocusJsonl,
  supabaseRefFromUrl,
  toNumber,
} from "./parse";

test("Statuspage: Doku-Beispiel mit Gruppen", () => {
  const s = parseStatusSummary({
    page: { id: "x", name: "Vercel" },
    status: { indicator: "minor", description: "Minor Service Outage" },
    components: [
      { name: "API", status: "operational" },
      { name: "Builds", status: "degraded_performance" },
      { name: "Region", status: "partial_outage", group: true },
    ],
    incidents: [],
  });
  assert.deepEqual(s, { indicator: "minor", description: "Minor Service Outage", degraded: [{ name: "Builds", status: "degraded_performance" }] });
});

test("Statuspage: Supabase ohne incidents und ohne components", () => {
  const s = parseStatusSummary({ status: { indicator: "none", description: "All Systems Operational" } });
  assert.equal(s.indicator, "none");
  assert.deepEqual(s.degraded, []);
});

test("Statuspage: fehlendes status-Feld wirft feste Meldung", () => {
  assert.throws(() => parseStatusSummary({ page: {} }), (e: unknown) => e instanceof MonitorError && e.message === "Unerwartetes Antwortformat");
  assert.throws(() => parseStatusSummary("<html>"), MonitorError);
});

test("Vercel: readyState oder state, neueste zuerst", () => {
  const d = parseVercelDeployments({
    deployments: [
      { uid: "dpl_1", created: 1000, state: "READY", meta: { githubCommitSha: "aaa" } },
      { uid: "dpl_2", created: 2000, readyState: "error", errorCode: "BUILD_FAILED", inspectorUrl: "https://vercel.com/x", meta: {} },
      { uid: "dpl_3", created: 1500 },
    ],
    pagination: {},
  });
  assert.deepEqual(d.map(x => [x.id, x.state, x.sha]), [["dpl_2", "ERROR", null], ["dpl_3", "UNKNOWN", null], ["dpl_1", "READY", "aaa"]]);
  assert.equal(d[0].errorCode, "BUILD_FAILED");
  assert.throws(() => parseVercelDeployments({ error: { code: "forbidden" } }), MonitorError);
});

test("FOCUS-JSONL: Summe mit Gutschrift, leere Zeilen, kaputte Zeilen", () => {
  const text = [
    JSON.stringify({ BilledCost: 1.5, ChargeCategory: "Usage" }),
    "",
    JSON.stringify({ BilledCost: "2.25" }),
    JSON.stringify({ BilledCost: -0.75, ChargeCategory: "Credit" }),
    "{kaputt",
    JSON.stringify({ EffectiveCost: 3 }),
  ].join("\r\n");
  assert.deepEqual(sumFocusJsonl(text), { totalUsd: 3, lines: 3, invalid: 2 });
});

test("FOCUS-JSONL: leer ergibt 0", () => {
  assert.deepEqual(sumFocusJsonl(""), { totalUsd: 0, lines: 0, invalid: 0 });
  assert.deepEqual(sumFocusJsonl("\n\n"), { totalUsd: 0, lines: 0, invalid: 0 });
});

test("toNumber: USD-Text und Zahl, keine Cent-Umrechnung", () => {
  assert.equal(toNumber("0.0123"), 0.0123);
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber(""), null);
  assert.equal(toNumber("abc"), null);
  assert.equal(toNumber(Number.POSITIVE_INFINITY), null);
});

test("Supabase-Ref nur aus *.supabase.co", () => {
  assert.equal(supabaseRefFromUrl("https://abcdefghijklmnopqrst.supabase.co"), "abcdefghijklmnopqrst");
  assert.equal(supabaseRefFromUrl("https://db.example.ch"), null);
  assert.equal(supabaseRefFromUrl("https://abcdefghijklmnopqrst.supabase.co.evil.ch"), null);
  assert.equal(supabaseRefFromUrl("http://localhost:54321"), null);
  assert.equal(supabaseRefFromUrl("kein url"), null);
  assert.equal(supabaseRefFromUrl(undefined), null);
});

test("Supabase Management: health, disk, api-counts", () => {
  assert.deepEqual(parseSupabaseHealth([{ name: "db", healthy: true, status: "ACTIVE_HEALTHY" }, { name: "auth", healthy: false, status: "UNHEALTHY" }]), [
    { name: "db", healthy: true, status: "ACTIVE_HEALTHY" },
    { name: "auth", healthy: false, status: "UNHEALTHY" },
  ]);
  assert.deepEqual(parseDiskUtil({ timestamp: "x", metrics: { fs_size_bytes: 8e9, fs_avail_bytes: 6e9, fs_used_bytes: 2e9 } }), { usedBytes: 2e9, sizeBytes: 8e9 });
  assert.equal(parseDiskUtil({ metrics: {} }), null);
  assert.equal(parseDiskUtil("<html>"), null);
  assert.equal(parseApiCounts({ result: [{ timestamp: "t", total_rest_requests: 10, total_auth_requests: "5" }, { total_storage_requests: 1 }] }), 16);
  assert.equal(parseApiCounts({ error: "x" }), null);
});

test("DB-Statistik: cron und net dürfen null sein", () => {
  const s = parseDbStats({ db_bytes: 1234, tables: [{ name: "analyses", bytes: 100, rows: 3 }], storage: [], auth_users: 4, auth_active_30d: 2, cron: null, net: null });
  assert.equal(s.db_bytes, 1234);
  assert.equal(s.cron, null);
  assert.throws(() => parseDbStats(null), MonitorError);
});

test("Kosten: numeric als Text, Tag gekürzt; null ergibt leere Liste", () => {
  assert.deepEqual(parseAiCosts([{ source: "chat", day: "2026-11-10", cost_usd: "0.5", calls: 3 }]), [{ source: "chat", day: "2026-11-10", costUsd: 0.5, calls: 3 }]);
  assert.deepEqual(parseAiCosts(null), []);
  assert.throws(() => parseAiCosts({}), MonitorError);
});

test("Geoportal: available false ohne Listen", () => {
  assert.equal(parseGeoportalHealth({ available: false }).available, false);
  assert.throws(() => parseGeoportalHealth({}), MonitorError);
});

test("GitHub: neuester Lauf je Workflow, Dependabot nach Schwere, Commit", () => {
  const runs = parseLatestRuns({
    total_count: 3,
    workflow_runs: [
      { name: "CI", status: "completed", conclusion: "failure", created_at: "2026-11-10T10:00:00Z" },
      { name: "CI", status: "completed", conclusion: "success" },
      { name: "Lint", status: "in_progress", conclusion: null },
    ],
  });
  assert.deepEqual(runs.map(r => [r.name, r.conclusion]), [["CI", "failure"], ["Lint", null]]);
  assert.deepEqual(parseDependabot([{ security_advisory: { severity: "high" } }, { security_vulnerability: { severity: "low" } }, {}]), { high: 1, low: 1, unknown: 1 });
  assert.equal(parseCommit({ sha: "abc", commit: { author: { date: "2026-11-10" } } }).date, "2026-11-10");
  assert.throws(() => parseCommit({ message: "Not Found" }), MonitorError);
});

test("Resend: daily.limit null = ohne Limit, fehlendes Limit = undefined", () => {
  const u = parseResendUsage({
    emails: { daily: { used: 12, limit: null, resets_at: "2026-11-11T00:00:00Z" }, monthly: { used: 300 } },
    domains: { used: 1, limit: 1 },
  });
  assert.deepEqual(u.daily, { used: 12, limit: null, resetsAt: "2026-11-11T00:00:00Z" });
  assert.equal(u.monthly?.limit, undefined);
  assert.equal(u.domains?.limit, 1);
  assert.deepEqual(parseResendUsage({}), { daily: null, monthly: null, domains: null });
});

test("Resend: Domains klein geschrieben", () => {
  assert.deepEqual(parseResendDomains({ data: [{ id: "1", name: "Tracebuild.ch", status: "verified" }] }), [{ name: "tracebuild.ch", status: "verified" }]);
  assert.throws(() => parseResendDomains([]), MonitorError);
});
