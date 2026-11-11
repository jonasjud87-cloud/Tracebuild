// Ergänzende Tests (Review): Supabase-Abfrage der Wiederholung und Randfälle von planRetry.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planRetry, supabaseRetryDeps, type RetryDeps, type RetrySource } from "./analysis-retry";
import { ORPHAN_AFTER_MS } from "./admin-analyses/constants";
import { analysisFailureText } from "../components/analysis-error-logic";
import { REASON_ACCOUNT, REASON_COST, REASON_CRASHES, REASON_OVERLOAD, REASON_STAGES } from "./analysis-stages/run-stage";

// ── Fake-Client: zeichnet Tabelle, Select und Filter auf ─────────────────────

interface Call { table: string; select: string; filters: [string, string, unknown][] }

function fakeAdmin(result: (c: Call) => { data: unknown; error: { message: string } | null }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, select: "", filters: [] };
      calls.push(call);
      const b = {
        select(s: string) { call.select = s; return b; },
        eq(col: string, v: unknown) { call.filters.push(["eq", col, v]); return b; },
        maybeSingle() { return Promise.resolve(result(call)); },
        then<T>(ok: (v: { data: unknown; error: { message: string } | null }) => T) { return Promise.resolve(result(call)).then(ok); },
      };
      return b;
    },
  };
  return { admin: client as unknown as SupabaseClient, calls };
}

test("Abfrage: Analyse nur über Projekt UND Org (inner join), nie nur über die ID", async () => {
  const { admin, calls } = fakeAdmin(() => ({ data: null, error: null }));
  const res = await supabaseRetryDeps(admin).loadAnalysis("p1", "org-a", "a1");
  assert.equal(res, null);
  const c = calls[0];
  assert.equal(c.table, "analyses");
  assert.match(c.select, /documents!inner\(/);
  assert.match(c.select, /projects!inner\(org_id\)/);
  assert.deepEqual(c.filters, [
    ["eq", "id", "a1"],
    ["eq", "documents.project_id", "p1"],
    ["eq", "documents.projects.org_id", "org-a"],
  ]);
});

test("Abfrage: Dateien und doc_type aus dem Dokument, fehlende document_files ergeben leere Liste", async () => {
  const { admin } = fakeAdmin(() => ({
    data: { id: "a1", status: "error", document_id: "d1", created_at: "x", result_json: null, documents: { doc_type: "Baugesuch", document_files: null } },
    error: null,
  }));
  const res = await supabaseRetryDeps(admin).loadAnalysis("p1", "org-a", "a1");
  assert.equal(res?.doc_type, "Baugesuch");
  assert.deepEqual(res?.files, []);
});

test("Abfrage: DB-Fehler (z. B. ungültige UUID in retry_of) wirft, statt still 'nicht gefunden' zu melden", async () => {
  const { admin } = fakeAdmin(() => ({ data: null, error: { message: 'invalid input syntax for type uuid: "x"' } }));
  await assert.rejects(() => supabaseRetryDeps(admin).loadAnalysis("p1", "org-a", "x"), /invalid input syntax/);
});

test("Abfrage: loadJob ohne Etappen-Tabelle ergibt null, andere Fehler werfen", async () => {
  const missing = fakeAdmin(() => ({ data: null, error: { message: 'relation "public.analysis_jobs" does not exist' } }));
  assert.equal(await supabaseRetryDeps(missing.admin).loadJob("a1"), null);
  const broken = fakeAdmin(() => ({ data: null, error: { message: "permission denied" } }));
  await assert.rejects(() => supabaseRetryDeps(broken.admin).loadJob("a1"), /permission denied/);
});

test("Abfrage: siblings-Fehler wirft (sonst würde ein laufender Zweitlauf übersehen)", async () => {
  const { admin } = fakeAdmin(() => ({ data: null, error: { message: "boom" } }));
  await assert.rejects(() => supabaseRetryDeps(admin).siblings("d1"), /boom/);
});

// ── planRetry: Randfälle ─────────────────────────────────────────────────────

const NOW = Date.parse("2026-11-11T12:00:00Z");
const OLD = new Date(NOW - ORPHAN_AFTER_MS - 60_000).toISOString();
const RECENT = new Date(NOW - 60_000).toISOString();

function src(over: Partial<RetrySource> = {}): RetrySource {
  return {
    id: "a1", status: "error", document_id: "d1", created_at: OLD, doc_type: null, result_json: null,
    files: [{ storage_path: "p1/a.pdf", file_name: "a.pdf", mime_type: null, size_bytes: null, position: 0 }],
    ...over,
  };
}

function deps(source: RetrySource | null, opts: { job?: { lease_until: string | null } | null; siblings?: { id: string; status: string }[] } = {}): RetryDeps & { jobLoads: number } {
  const d = {
    jobLoads: 0,
    async loadAnalysis() { return source; },
    async loadJob() { d.jobLoads++; return opts.job ?? null; },
    async siblings() { return opts.siblings ?? (source ? [{ id: source.id, status: source.status }] : []); },
  };
  return d;
}

const MEMBER = { org_id: "org-a", role: "member" };
const input = { projectId: "p1", analysisId: "a1", user: MEMBER };

test("Retry: alter Start, aber frisches Lebenszeichen → läuft noch (409), Job wird nicht einmal gelesen", async () => {
  const d = deps(src({ status: "running", created_at: OLD, result_json: { last_activity_at: RECENT } }));
  const plan = await planRetry(d, input, NOW);
  assert.equal(!plan.ok && plan.status, 409);
  assert.equal(d.jobLoads, 0);
});

test("Retry: unlesbares Lebenszeichen fällt auf created_at zurück", async () => {
  const fresh = await planRetry(deps(src({ status: "running", created_at: RECENT, result_json: { last_activity_at: "kaputt" } })), input, NOW);
  assert.equal(!fresh.ok && fresh.status, 409);
  const stale = await planRetry(deps(src({ status: "running", created_at: OLD, result_json: { last_activity_at: 42 } })), input, NOW);
  assert.equal(stale.ok && stale.closeOld, true);
});

test("Retry: genau an der Grenze (6 min) gilt als verwaist, knapp davor nicht", async () => {
  const at = new Date(NOW - ORPHAN_AFTER_MS).toISOString();
  const before = new Date(NOW - ORPHAN_AFTER_MS + 1).toISOString();
  assert.equal((await planRetry(deps(src({ status: "running", created_at: at })), input, NOW)).ok, true);
  assert.equal((await planRetry(deps(src({ status: "running", created_at: before })), input, NOW)).ok, false);
});

test("Retry: verwaister Lauf, aber Lease ohne Ablaufzeit (null) → schliessbar", async () => {
  const plan = await planRetry(deps(src({ status: "running" }), { job: { lease_until: null } }), input, NOW);
  assert.equal(plan.ok && plan.closeOld, true);
});

test("Retry: verwaister Lauf, aber für dieselben Pläne läuft schon ein neuer Lauf → 409", async () => {
  const plan = await planRetry(
    deps(src({ status: "running" }), { siblings: [{ id: "a1", status: "running" }, { id: "a2", status: "running" }] }),
    input,
    NOW,
  );
  assert.equal(!plan.ok && plan.status, 409);
});

test("Retry: fehlende mime_type/size ergeben leere Werte (Server prüft sie danach mit validatePlanFiles)", async () => {
  const plan = await planRetry(deps(src()), input, NOW);
  assert.equal(plan.ok, true);
  if (plan.ok) assert.deepEqual(plan.files, [{ path: "p1/a.pdf", name: "a.pdf", type: "", size: 0 }]);
});

test("Retry: Rolle leer oder anders geschrieben → 403", async () => {
  for (const role of ["", "Member", "admin", "service_role"]) {
    const plan = await planRetry(deps(src()), { ...input, user: { org_id: "org-a", role } }, NOW);
    assert.equal(!plan.ok && plan.status, 403, role);
  }
});

test("Retry: Fehlermeldungen von planRetry enthalten keine Interna", async () => {
  const cases = [
    await planRetry(deps(null), input, NOW),
    await planRetry(deps(src({ status: "done" })), input, NOW),
    await planRetry(deps(src({ files: [] })), input, NOW),
  ];
  for (const c of cases) {
    assert.equal(c.ok, false);
    if (!c.ok) assert.doesNotMatch(c.error, /a1|d1|p1|uuid|select|documents/);
  }
});

// ── Nutzertexte zu den echten Gründen der Etappen ───────────────────────────

test("Fehlertext: Gründe der Etappen (Konstanten) ergeben nie «Unbekannter Fehler»", () => {
  for (const reason of [REASON_COST, REASON_OVERLOAD, REASON_ACCOUNT, REASON_STAGES, REASON_CRASHES]) {
    const text = analysisFailureText(`Analyse ohne Ergebnis: ${reason}`);
    assert.notEqual(text, "Unbekannter Fehler.", reason);
  }
  assert.notEqual(analysisFailureText(REASON_CRASHES), "Unbekannter Fehler.");
});
