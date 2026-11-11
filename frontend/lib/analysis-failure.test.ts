import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FALLBACK_FAILURE_REASON, failureFields, failureReason, updateClosing } from "./analysis-failure";

const NOW = Date.parse("2026-11-11T10:00:00Z");

test("failureReason: nie leer", () => {
  assert.equal(failureReason("Zeitüberschreitung"), "Zeitüberschreitung");
  assert.equal(failureReason(new Error("Kostengrenze erreicht")), "Kostengrenze erreicht");
  assert.equal(failureReason(""), FALLBACK_FAILURE_REASON);
  assert.equal(failureReason("  "), FALLBACK_FAILURE_REASON);
  assert.equal(failureReason(null), FALLBACK_FAILURE_REASON);
  assert.equal(failureReason(new Error("")), FALLBACK_FAILURE_REASON);
});

test("failureFields: Status, Endzeit und Grund, bisheriges result_json bleibt", () => {
  const f = failureFields("", NOW, { run_id: "r1", stages: { count: 2 } });
  assert.equal(f.status, "error");
  assert.equal(f.finished_at, "2026-11-11T10:00:00.000Z");
  assert.deepEqual(f.result_json, { run_id: "r1", stages: { count: 2 }, error: FALLBACK_FAILURE_REASON });
  assert.equal(failureFields("Zeitüberschreitung", NOW).result_json.error, "Zeitüberschreitung");
});

test("updateClosing: schreibt finished_at mit", async () => {
  const calls: Record<string, unknown>[] = [];
  const res = await updateClosing({ status: "error", finished_at: "t", result_json: { error: "x" } }, async (f) => {
    calls.push(f);
    return { error: null };
  });
  assert.equal(res.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].finished_at, "t");
});

test("updateClosing: ohne Spalte finished_at zweiter Versuch ohne, Grund bleibt", async () => {
  const calls: Record<string, unknown>[] = [];
  const res = await updateClosing({ status: "error", finished_at: "t", result_json: { error: "x" } }, async (f) => {
    calls.push(f);
    return calls.length === 1
      ? { error: { message: "Could not find the 'finished_at' column of 'analyses' in the schema cache" } }
      : { error: null };
  });
  assert.equal(res.error, null);
  assert.equal(calls.length, 2);
  assert.equal("finished_at" in calls[1], false);
  assert.deepEqual(calls[1].result_json, { error: "x" });
});

test("updateClosing: andere Fehler werden nicht verschluckt", async () => {
  let n = 0;
  const res = await updateClosing({ status: "error", finished_at: "t" }, async () => {
    n++;
    return { error: { message: "permission denied" } };
  });
  assert.equal(n, 1);
  assert.equal(res.error?.message, "permission denied");
});

test("Route: alle Fehlerabschlüsse mit Grund und finished_at", () => {
  const src = readFileSync(new URL("../app/api/v1/projects/[id]/analyses/route.ts", import.meta.url), "utf8");
  // Kein direktes Schreiben von status 'error' mehr ohne Helfer.
  assert.doesNotMatch(src, /update\(\{\s*status:\s*"error"/);
  assert.match(src, /error: `Analyse ohne Ergebnis: \$\{noResultReason\}`/);
  assert.match(src, /error: failureReason\(message\)/);
  assert.equal((src.match(/finished_at: new Date\(\)\.toISOString\(\)/g) ?? []).length, 2);
  assert.match(src, /failureFields\(message, Date\.now\(\), \{ run_id: runId \}\)/);
});

test("Migration: Trigger setzt Grund und finished_at, ohne Rechte für Clients", () => {
  const raw = readFileSync(new URL("../../supabase/migrations/20261111000003_analyses_error_reason.sql", import.meta.url), "utf8");
  const sql = raw.replace(/--.*$/gm, "");
  assert.match(sql, /SET lock_timeout/);
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.analyses_error_reason\(\) FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(sql, /GRANT/i);
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);
  assert.doesNotMatch(sql, /CREATE TABLE|DROP TABLE|CREATE EXTENSION|cron\.schedule/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS finished_at/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF status ON public\.analyses/);
  assert.match(sql, /NEW\.finished_at := coalesce\(NEW\.finished_at, now\(\)\)/);
  assert.match(sql, /'error', 'Unbekannter Fehler'/);
});
