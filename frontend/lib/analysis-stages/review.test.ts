// Korrekturrunde: Absturz-Schleife, Überlast, bezahlte Ergebnisse, Kostengrenze, Beobachtbarkeit.
import { test } from "node:test";
import assert from "node:assert/strict";

import { RESERVE_CALL_USD, crashBackoffMs } from "./budget";
import { assertNormsUsable } from "./plan";
import { progressFromJob, publicResultJson, type JobProgressRow } from "./progress";
import { REASON_COST, REASON_CRASHES, REASON_OVERLOAD } from "./run-stage";
import { harness, item } from "./test-fakes";

const failedNorms = (h: ReturnType<typeof harness>) => (h.store.result?.failed_norms ?? []) as { error: string }[];
const stages = (h: ReturnType<typeof harness>) => h.store.result?.stages as Record<string, number>;

// ── 2 Absturz-Schleife ──────────────────────────────────────────────────────────

test("Absturz: Kein direkter Anstoss, Backoff über die Datenbank, Grenze endet mit Fehler und Grund", async () => {
  const h = harness({ parts: 1 });
  // Abschluss scheitert immer, Lease-Freigabe geht: genau die Schleife aus dem Review.
  h.store.existingNormIds = async () => { throw new Error("DB-Fehler"); };
  assert.equal(await h.stage("start"), "crashed");
  assert.equal(h.dispatched, 0);
  assert.equal(h.store.job?.crash_count, 1);
  // Vor Ablauf des Backoffs bekommt auch der Browser keinen Claim.
  assert.equal(await h.store.claim("x", null, "l", 330), null);
  assert.equal(h.store.job?.waiting_until, h.clock.t + crashBackoffMs(1));

  const started = h.clock.t;
  assert.equal(await h.stage(), "crashed");
  assert.equal(h.store.job?.crash_count, 2);
  // Der Abschluss der gespeicherten Teile scheitert ebenfalls: Die harte Grenze beendet die Analyse.
  assert.equal((await h.run()).at(-1), "finished");
  assert.equal(h.store.status, "error");
  assert.equal(h.store.result?.error, REASON_CRASHES);
  assert.equal(h.store.job, null);
  assert.equal(h.dispatched, 0);
  assert.ok(h.clock.t - started >= crashBackoffMs(1) + crashBackoffMs(2));
});

test("Funktion stirbt ohne Freigabe: Der Claim zählt mit, nach 3 Mal Fehler", async () => {
  const h = harness({ parts: 2 });
  for (let i = 1; i <= 3; i++) {
    h.store.job!.lease_id = `tot-${i}`;
    h.store.job!.lease_until = h.clock.t - 1;
    if (i < 3) {
      await h.store.claim("x", null, "l", 0);
      assert.equal(h.store.job?.crash_count, i);
      h.store.job!.lease_until = null;
    }
  }
  assert.equal(await h.stage(), "finished");
  assert.equal(h.store.status, "error");
  assert.equal(h.store.result?.error, REASON_CRASHES);
  assert.equal(h.calls.length, 0);
});

test("Absturz mit Fortschritt beginnt neu zu zählen, saubere Übergabe setzt zurück", async () => {
  const h = harness({ parts: 80 });
  assert.equal(await h.stage("start"), "handed_off");
  h.store.job!.crash_count = 2;
  // Ein Teil wird gespeichert, danach ist die DB weg, die Freigabe gelingt wieder.
  const original = h.store.savePart.bind(h.store);
  let saves = 0;
  h.store.savePart = async (...args) => {
    if (++saves > 12) throw new Error("DB weg");
    return original(...args);
  };
  assert.equal(await h.stage(), "crashed");
  assert.equal(h.store.job?.crash_count, 1);
  h.store.savePart = original;
  assert.equal(await h.stage(), "handed_off");
  assert.equal(h.store.job?.crash_count, 0);
});

// ── 3 Filter-Fix ────────────────────────────────────────────────────────────────

test("Normen nicht ladbar: Abbruch statt Prüfung auf Fachwissen", () => {
  assert.throws(() => assertNormsUsable("fallback", new Error("x"), null), /Normen des Projekts/);
  assert.throws(() => assertNormsUsable("fallback", null, { message: "x" }), /Normen des Projekts/);
  assert.doesNotThrow(() => assertNormsUsable("fallback", null, null));
  assert.doesNotThrow(() => assertNormsUsable("project_norms", new Error("x"), { message: "x" }));
});

test("Normen nicht ladbar in der Vorbereitung: Analyse endet als Fehler mit Grund, keine Kosten", async () => {
  const h = harness({ parts: 1, prepareFails: "Die Normen des Projekts konnten nicht geladen werden. Bitte später erneut versuchen." });
  assert.equal(await h.stage("start"), "finished");
  assert.equal(h.store.status, "error");
  assert.match(String(h.store.result?.error), /Normen des Projekts/);
  assert.equal(h.calls.length, 0);
});

// ── 4 Fehlerzweig nach Aktivierung ──────────────────────────────────────────────

const NOW = Date.parse("2026-11-05T12:00:00Z");
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
const row = (over: Partial<JobProgressRow> = {}): JobProgressRow => ({
  phase: "parts", parts_total: 38, parts_done: 19, lease_until: null, waiting_since: iso(1_000),
  dispatch_url: "https://www.tracebuild.ch/x", last_progress_at: iso(1_000), created_at: iso(60_000), ...over,
});

test("Steht die Kette, verspricht die Anzeige keinen Hintergrundlauf mehr", () => {
  assert.equal(progressFromJob(row(), NOW).background, true);
  const stuck = progressFromJob(row({ waiting_since: iso(121_000) }), NOW);
  assert.equal(stuck.background, false);
  assert.equal(stuck.needs_resume, true);
  // dispatch_url vom Wächter geleert
  const fallback = progressFromJob(row({ dispatch_url: null }), NOW);
  assert.deepEqual([fallback.background, fallback.needs_resume], [false, true]);
});

test("Während Backoff oder Überlast-Pause stösst niemand an", () => {
  for (const dispatch_url of [null, "https://www.tracebuild.ch/x"]) {
    const paused = progressFromJob(row({ waiting_since: iso(-300_000), dispatch_url }), NOW);
    assert.equal(paused.needs_resume, false, String(dispatch_url));
  }
  assert.equal(progressFromJob(row({ waiting_since: iso(-300_000) }), NOW).background, true);
});

test("Auslöser meldet unavailable: dispatch_url weg", async () => {
  const h = harness({ parts: 80, dispatcher: () => "unavailable" });
  await h.stage("start");
  assert.equal(h.store.job?.dispatch_url, null);
});

// ── 6 Überlast ──────────────────────────────────────────────────────────────────

test("Langes retry-after: Pause überlebt die Übergabe, kein direkter Anstoss, Analyse endet nicht", async () => {
  const h = harness({
    parts: 2,
    script: (req, nth) => (req.unit.index === 1 && nth <= 2 ? { durationMs: 1_000, error: { cls: "overload", retryAfterMs: 5 * 60_000 } } : {}),
  });
  assert.equal(await h.stage("start"), "handed_off");
  assert.equal(h.dispatched, 0);
  assert.ok(h.store.job!.waiting_until! - h.clock.t > 3 * 60_000);
  assert.equal(await h.store.claim("x", null, "l", 330), null);
  const started = h.clock.t;
  const results = await h.run();
  assert.equal(results.at(-1), "finished");
  assert.ok(h.clock.t - started >= 5 * 60_000);
  assert.equal(h.store.status, "done");
  assert.equal(h.store.items.length, 2);
  assert.equal(failedNorms(h).length, 0);
  assert.ok(stages(h).overload_wait_ms >= 10 * 60_000);
});

test("Überlast-Etappen zählen nicht als Stillstand, Grenze bleibt overload_wait_ms", async () => {
  const h = harness({
    parts: 2,
    script: (req) => (req.unit.index === 0 ? {} : { durationMs: 1_000, error: { cls: "overload", retryAfterMs: 200_000 } }),
  });
  const results = await h.run();
  assert.ok(results.length > 3, results.join());
  assert.equal(h.store.status, "done");
  assert.ok(failedNorms(h).some((f) => f.error === REASON_OVERLOAD), JSON.stringify(failedNorms(h)));
});

// ── 7 Bezahltes Ergebnis ────────────────────────────────────────────────────────

test("savePart scheitert zweimal: Ergebnis bleibt, kein zweiter Aufruf", async () => {
  const h = harness({ parts: 1, script: () => ({ onCall: () => { h.store.failNextSaves = 2; } }) });
  assert.deepEqual(await h.run(), ["finished"]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.store.items.length, 1);
  assert.equal(h.store.status, "done");
});

test("Echter Lease-Verlust wird nicht wiederholt", async () => {
  const h = harness({ parts: 1, script: () => ({ onCall: () => { h.store.parts[0].lease_id = "fremd"; h.store.job!.lease_id = "fremd"; } }) });
  const original = h.store.savePart.bind(h.store);
  let saves = 0;
  h.store.savePart = async (...args) => { saves++; return original(...args); };
  assert.equal(await h.stage("start"), "lease_lost");
  assert.equal(saves, 2); // Start und ein Speicherversuch
});

test("Wiederholung erst in der Warteschlange, wenn ihr Stand gespeichert ist", async () => {
  // Parallel: Während der Teil noch speichert, darf er nicht erneut starten.
  const running = new Set<number>();
  let overlap = false;
  const h = harness({
    parts: 2,
    script: (req, nth) => {
      if (running.has(req.unit.index)) overlap = true;
      running.add(req.unit.index);
      return req.unit.index === 1 && nth === 1
        ? { durationMs: 1_000, error: { cls: "transient", message: "kurz" }, onCall: () => { h.store.failNextSaves = 2; } }
        : {};
    },
  });
  const original = h.deps.model.callPart.bind(h.deps.model);
  h.deps.model.callPart = async (req) => {
    const out = await original(req);
    running.delete(req.unit.index);
    return out;
  };
  await h.run();
  assert.equal(overlap, false);
  assert.equal(h.store.status, "done");
  assert.equal(h.store.items.length, 2);
});

// ── 8 Kostengrenze ──────────────────────────────────────────────────────────────

test("Kostengrenze reserviert laufende Aufrufe: Eine Welle überzieht sie nicht", async () => {
  const limit = 1;
  const h = harness({ parts: 40, maxRunCostUsd: limit, script: () => ({ tokens: { output_tokens: 10_000 } }) }); // 0.102 je Aufruf, unter der Reserve
  await h.run();
  assert.ok(h.calls.length < 12, `${h.calls.length} Aufrufe`);
  assert.ok(h.store.cost <= limit, `Kosten ${h.store.cost}`);
  assert.ok(failedNorms(h).some((f) => f.error === REASON_COST));
});

test("Kostengrenze: Unter der Reserve startet kein Aufruf", async () => {
  const h = harness({ parts: 2, maxRunCostUsd: RESERVE_CALL_USD / 2 });
  await h.run();
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.status, "error");
  assert.match(String(h.store.result?.error), /Kostengrenze/);
});

test("Kostengrenze: Abgebrochene und verlorene Versuche zählen pauschal", async () => {
  const h = harness({
    parts: 6,
    maxRunCostUsd: 0.8,
    script: () => ({ durationMs: 300_000, tokens: { output_tokens: 1 } }), // jede Runde Timeout, kaum gemessene Kosten
  });
  await h.run();
  assert.ok(h.store.cost < 0.1, `gemessen ${h.store.cost}`);
  assert.ok(failedNorms(h).some((f) => f.error === REASON_COST), JSON.stringify(failedNorms(h)));
  assert.ok(stages(h).unmetered_attempts >= 1);
});

test("Konsolidierung über der Kostengrenze: kein Aufruf, Rohpunkte, im Bericht ausgewiesen", async () => {
  const many = Array.from({ length: 300 }, () => item("n0"));
  const h = harness({ parts: 1, maxRunCostUsd: 0.2, script: () => ({ durationMs: 10_000, items: many }) });
  await h.run();
  assert.equal(h.consolidations, 0);
  assert.equal(h.store.status, "done");
  assert.equal(h.store.items.length, 300);
  const c = h.store.result?.consolidation as { applied: boolean; error: string };
  assert.deepEqual([c.applied, c.error], [false, REASON_COST]);
});

// ── 11 Beobachtbarkeit ──────────────────────────────────────────────────────────

test("Betriebswerte des Jobs stehen nach dem Löschen in result_json.stages", async () => {
  const h = harness({
    parts: 3,
    job: { dispatch_total: 4 },
    script: (req, nth) => (req.unit.index === 0 && nth === 1
      ? { tokens: { cache_write_tokens: 1000 } }
      : req.unit.index === 2 ? { tokens: { cache_write_tokens: 500 } } : {}),
  });
  await h.run();
  assert.equal(stages(h).dispatch_attempts, 4);
  assert.equal(stages(h).overload_wait_ms, 0);
  assert.equal(stages(h).cold_stages, 1);
  assert.equal(stages(h).cache_write_parts, 2);
});

// ── 13 Abbruch ──────────────────────────────────────────────────────────────────

test("Ein fertiger Lauf wird von einer zweiten Etappe nicht als abgebrochen aufgeräumt", async () => {
  const h = harness({
    parts: 2,
    script: () => ({
      onCall: () => {
        h.store.status = "done";
        h.store.items = [{ note: "fertig" } as never];
        h.store.result = { fertig: true };
      },
    }),
  });
  await h.stage("start");
  assert.equal(h.store.status, "done");
  assert.equal(h.store.items.length, 1);
  assert.deepEqual(h.store.result, { fertig: true });
});

// ── 14 Browser ──────────────────────────────────────────────────────────────────

test("Betriebsdaten gehen nicht an den Browser, fachliche Schlüssel schon", () => {
  const out = publicResultJson({ run_id: "r", stages: { count: 3 }, last_activity_at: "x", active_ms: 1, failed_norms: [], preflight: null });
  assert.deepEqual(out, { run_id: "r", failed_norms: [], preflight: null });
  assert.equal(publicResultJson(null), null);
});

