import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_START_ROLES,
  NOT_RETRYABLE_ERROR,
  STATUS_CHANGED,
  STILL_RUNNING,
  closeOrphan,
  isUuid,
  planRetry,
  type OrphanCloseDeps,
  type RetryDeps,
  type RetrySource,
} from "./analysis-retry";
import { ORPHAN_AFTER_MS } from "./admin-analyses/constants";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const PROJECT = "p1";
const ORG = "org-a";
const MEMBER = { org_id: ORG, role: "member" };

interface Row extends RetrySource { project_id: string; org_id: string }

function row(over: Partial<Row> = {}): Row {
  return {
    id: "a-failed",
    status: "error",
    document_id: "d1",
    created_at: "2026-11-11T11:00:00Z",
    doc_type: "Baugesuch",
    result_json: { error: "Zeitüberschreitung" },
    files: [
      { storage_path: "p1/b.pdf", file_name: "b.pdf", mime_type: "application/pdf", size_bytes: 20, position: 1 },
      { storage_path: "p1/a.pdf", file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 10, position: 0 },
    ],
    project_id: PROJECT,
    org_id: ORG,
    ...over,
  };
}

/** Bildet die Filter der Supabase-Abfrage nach: Analyse nur im eigenen Projekt und in der eigenen Org. */
function fakeDeps(rows: Row[], jobs: Record<string, { lease_until: string | null }> = {}): RetryDeps {
  return {
    async loadAnalysis(projectId, orgId, analysisId) {
      return rows.find((r) => r.id === analysisId && r.project_id === projectId && r.org_id === orgId) ?? null;
    },
    async loadJob(analysisId) {
      return jobs[analysisId] ?? null;
    },
    async siblings(documentId) {
      return rows.filter((r) => r.document_id === documentId).map((r) => ({ id: r.id, status: r.status }));
    },
  };
}

const input = (over: Partial<{ analysisId: string; user: { org_id: string; role: string } }> = {}) => ({
  projectId: PROJECT,
  analysisId: "a-failed",
  user: MEMBER,
  ...over,
});

test("Retry: fehlgeschlagene Analyse liefert dieselben Pläne in Upload-Reihenfolge", async () => {
  const plan = await planRetry(fakeDeps([row()]), input(), NOW);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.documentId, "d1");
  assert.equal(plan.docType, "Baugesuch");
  assert.equal(plan.closeOld, false);
  assert.deepEqual(plan.files, [
    { path: "p1/a.pdf", name: "a.pdf", type: "application/pdf", size: 10 },
    { path: "p1/b.pdf", name: "b.pdf", type: "application/pdf", size: 20 },
  ]);
});

test("Retry: alle Rollen, die starten dürfen, dürfen wiederholen", async () => {
  for (const role of ANALYSIS_START_ROLES) {
    const plan = await planRetry(fakeDeps([row()]), input({ user: { org_id: ORG, role } }), NOW);
    assert.equal(plan.ok, true, role);
  }
});

test("Retry: unbekannte Rolle 403, vor jedem Datenzugriff", async () => {
  let touched = false;
  const deps = fakeDeps([row()]);
  const spy: RetryDeps = { ...deps, loadAnalysis: async (...a) => { touched = true; return deps.loadAnalysis(...a); } };
  const plan = await planRetry(spy, input({ user: { org_id: ORG, role: "viewer" } }), NOW);
  assert.deepEqual(plan, { ok: false, status: 403, error: "Zugriff verweigert" });
  assert.equal(touched, false);
});

test("Retry: fremde Organisation oder fremdes Projekt 404", async () => {
  const foreignOrg = await planRetry(fakeDeps([row({ org_id: "org-b" })]), input(), NOW);
  assert.deepEqual(foreignOrg, { ok: false, status: 404, error: "Analyse nicht gefunden" });
  const otherUser = await planRetry(fakeDeps([row()]), input({ user: { org_id: "org-b", role: "org_admin" } }), NOW);
  assert.equal(!otherUser.ok && otherUser.status, 404);
  const foreignProject = await planRetry(fakeDeps([row({ project_id: "p2" })]), input(), NOW);
  assert.equal(!foreignProject.ok && foreignProject.status, 404);
  const missing = await planRetry(fakeDeps([]), input(), NOW);
  assert.equal(!missing.ok && missing.status, 404);
});

test("Retry: nur status error; done und cancelled nicht", async () => {
  for (const status of ["done", "cancelled", "pending"]) {
    const plan = await planRetry(fakeDeps([row({ status })]), input(), NOW);
    assert.equal(plan.ok, false, status);
    if (!plan.ok) {
      assert.equal(plan.status, 409);
      assert.match(plan.error, /Nur fehlgeschlagene/);
    }
  }
});

test("Retry: laufende Analyse mit Lebenszeichen ist kein Fehler (409)", async () => {
  const recent = new Date(NOW - 60_000).toISOString();
  const plan = await planRetry(fakeDeps([row({ status: "running", created_at: recent, result_json: { last_activity_at: recent } })]), input(), NOW);
  assert.equal(!plan.ok && plan.status, 409);
  assert.match(!plan.ok ? plan.error : "", /läuft noch/);
});

test("Retry: laufende Analyse mit aktiver Etappe ist kein Fehler (409)", async () => {
  const old = new Date(NOW - ORPHAN_AFTER_MS - 60_000).toISOString();
  const lease = new Date(NOW + 30_000).toISOString();
  const plan = await planRetry(
    fakeDeps([row({ status: "running", created_at: old, result_json: { last_activity_at: old } })], { "a-failed": { lease_until: lease } }),
    input(),
    NOW,
  );
  assert.equal(!plan.ok && plan.status, 409);
});

test("Retry: verwaister Lauf (unterbrochen oder festgefahren) wird geschlossen und neu gestartet", async () => {
  const old = new Date(NOW - ORPHAN_AFTER_MS - 60_000).toISOString();
  const expired = new Date(NOW - 10_000).toISOString();
  const withJob = await planRetry(
    fakeDeps([row({ status: "running", created_at: old, result_json: { last_activity_at: old } })], { "a-failed": { lease_until: expired } }),
    input(),
    NOW,
  );
  assert.equal(withJob.ok && withJob.closeOld, true);
  const legacy = await planRetry(fakeDeps([row({ status: "running", created_at: old, result_json: null })]), input(), NOW);
  assert.equal(legacy.ok && legacy.closeOld, true);
});

test("Retry: Doppelklick oder zweiter Tab, wenn für dieselben Pläne schon ein Lauf läuft (409)", async () => {
  const rows = [row(), row({ id: "a-new", status: "running", created_at: "2026-11-11T11:59:00Z" })];
  const plan = await planRetry(fakeDeps(rows), input(), NOW);
  assert.deepEqual(plan, { ok: false, status: 409, error: "Für diese Pläne läuft bereits eine neue Analyse." });
  // Ein abgeschlossener oder fehlgeschlagener neuerer Lauf sperrt nicht.
  const settled = [row(), row({ id: "a-new", status: "error" }), row({ id: "a-old", status: "done" })];
  assert.equal((await planRetry(fakeDeps(settled), input(), NOW)).ok, true);
});

test("Retry: ohne gespeicherte Pläne kein Start", async () => {
  const plan = await planRetry(fakeDeps([row({ files: [] })]), input(), NOW);
  assert.equal(!plan.ok && plan.status, 409);
  assert.match(!plan.ok ? plan.error : "", /neu hoch/);
});

// ── Nicht wiederholbare Gründe, ungültige ID, verwaister Lauf ────────────────

test("Retry: Kostengrenze, gesperrtes Konto oder abgelehnte Prüfung → 409 mit fester Meldung", async () => {
  const reasons = [
    "Analyse ohne Ergebnis: Kostengrenze erreicht",
    "Analyse ohne Ergebnis: Anthropic-Konto verweigert weitere Aufrufe, Teil nicht geprüft",
    "Analyse ohne Ergebnis: Modell hat die Prüfung abgelehnt (cyber)",
    "Analyse ohne Ergebnis: 400 credit balance is too low",
  ];
  for (const error of reasons) {
    const plan = await planRetry(fakeDeps([row({ result_json: { error } })]), input(), NOW);
    assert.deepEqual(plan, { ok: false, status: 409, error: NOT_RETRYABLE_ERROR }, error);
  }
  // Überlast, Zeitüberschreitung und unbekannte Gründe bleiben wiederholbar.
  for (const error of ["Analyse ohne Ergebnis: Anthropic dauerhaft überlastet, Teil nicht geprüft", "Zeitüberschreitung", ""]) {
    assert.equal((await planRetry(fakeDeps([row({ result_json: { error } })]), input(), NOW)).ok, true, error);
  }
});

test("isUuid: nur echte UUIDs, sonst 404 statt Datenbankfehler", () => {
  assert.equal(isUuid("3f2a9c1d-7e4b-4a1c-9d2e-123456789abc"), true);
  for (const bad of ["", "x", "a-failed", "3f2a9c1d-7e4b-4a1c-9d2e-123456789abc' or 1=1", "3f2a9c1d7e4b4a1c9d2e123456789abc"]) {
    assert.equal(isUuid(bad), false, bad);
  }
});

function orphanDeps(claim: "claimed" | "busy" | "none", closes = true) {
  const log: string[] = [];
  const deps: OrphanCloseDeps = {
    async claimJob(id, lease) { log.push(`claim:${id}:${lease}`); return claim; },
    async closeClaimed(id, lease, reason) { log.push(`closeClaimed:${id}:${lease}:${reason}`); return closes; },
    async closeWithoutJob(id, cutoff, reason) { log.push(`closeWithoutJob:${id}:${cutoff}:${reason}`); return closes; },
  };
  return { deps, log };
}

test("closeOrphan: Job wird zuerst atomar übernommen, dann mit Lease geschlossen", async () => {
  const { deps, log } = orphanDeps("claimed");
  assert.deepEqual(await closeOrphan(deps, "a1", "L1", "Zeitüberschreitung", NOW), { ok: true });
  assert.deepEqual(log, ["claim:a1:L1", "closeClaimed:a1:L1:Zeitüberschreitung"]);
});

test("closeOrphan: Wettlauf, Wächter oder anderer Tab hat den Job geclaimt → 409, nichts geschlossen", async () => {
  const { deps, log } = orphanDeps("busy");
  assert.deepEqual(await closeOrphan(deps, "a1", "L1", "Zeitüberschreitung", NOW), { ok: false, status: 409, error: STILL_RUNNING });
  assert.deepEqual(log, ["claim:a1:L1"]);
});

test("closeOrphan: Altlauf ohne Job wird nur geschlossen, wenn er noch verwaist ist", async () => {
  const { deps, log } = orphanDeps("none");
  assert.deepEqual(await closeOrphan(deps, "a1", "L1", "Zeitüberschreitung", NOW), { ok: true });
  assert.equal(log[1], `closeWithoutJob:a1:${new Date(NOW - ORPHAN_AFTER_MS).toISOString()}:Zeitüberschreitung`);
});

test("closeOrphan: Status hat sich inzwischen geändert → 409", async () => {
  for (const claim of ["claimed", "none"] as const) {
    const { deps } = orphanDeps(claim, false);
    assert.deepEqual(await closeOrphan(deps, "a1", "L1", "x", NOW), { ok: false, status: 409, error: STATUS_CHANGED });
  }
});
