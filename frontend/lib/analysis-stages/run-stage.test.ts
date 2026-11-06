import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_STAGES, STATE_VERSION } from "./budget";
import { REASON_ACCOUNT, REASON_COST, REASON_OVERLOAD, REASON_STAGES } from "./run-stage";
import { harness, item } from "./test-fakes";

const calledPositions = (h: ReturnType<typeof harness>) => h.calls.map((c) => c.unit.index);
const failedNorms = (h: ReturnType<typeof harness>) => (h.store.result?.failed_norms ?? []) as { norm_title: string; error: string }[];

test("1 Alles passt in eine Etappe: kein Anstoss, Prüfpunkte erst am Ende, done, konsolidiert", async () => {
  const seen: number[] = [];
  const h = harness({ parts: 3, script: () => ({ onCall: () => seen.push(0) }) });
  const results = await h.run();
  assert.deepEqual(results, ["finished"]);
  assert.equal(h.dispatched, 0);
  assert.equal(h.store.status, "done");
  assert.equal(h.store.items.length, 3);
  assert.equal(h.consolidations, 1);
  assert.equal(h.store.job, null);
  assert.ok(h.store.finishedAt);
  assert.equal((h.store.result?.stages as { count: number }).count, 1);
  assert.equal(h.store.result?.saved_count, 3);
  assert.ok(h.store.result?.active_ms !== undefined);
});

test("1b Bisherige Schlüssel von result_json bleiben erhalten", async () => {
  const h = harness({ parts: 1 });
  await h.run();
  for (const key of ["run_id", "model", "norms_source", "norms_error", "norm_count", "reference_norms", "oereb_context",
    "oereb_snapshot", "geodata_snapshot", "norm_versions", "auto_parts", "item_count", "raw_item_count", "consolidation",
    "saved_count", "duration_ms", "usage", "calls", "failed_norms", "insert_errors", "stages", "preflight"]) {
    assert.ok(key in (h.store.result ?? {}), key);
  }
});

test("2 38 Teile: Etappen wechseln, jeder Teil genau einmal, Reihenfolge stabil, Items erst am Ende", async () => {
  let itemsDuringRun = 0;
  const h = harness({ parts: 38, script: () => ({ onCall: () => { itemsDuringRun += h.store.items.length; } }) });
  const results = await h.run();
  assert.ok(results.filter((r) => r === "handed_off").length >= 1, `Etappen: ${results.join()}`);
  assert.equal(results.at(-1), "finished");
  const positions = calledPositions(h);
  assert.equal(positions.length, 38);
  assert.deepEqual(positions, Array.from({ length: 38 }, (_, i) => i));
  assert.equal(itemsDuringRun, 0);
  assert.equal(h.store.items.length, 38);
  assert.equal(h.dispatched, results.length - 1);
});

test("3 Absturz nach N Teilen: Wiederaufnahme ruft nur Offene, done nie doppelt, unmetered erhöht", async () => {
  const h = harness({ parts: 12 });
  // Vorbereitung und erste Speicherungen laufen, danach ist die DB weg.
  h.store.crashAfterSaves = 14;
  const first = await h.stage("start");
  assert.equal(first, "crashed");
  const doneAtCrash = h.store.parts.filter((p) => p.status === "done").map((p) => p.position);
  const runningAtCrash = h.store.parts.filter((p) => p.status === "running").length;
  assert.ok(doneAtCrash.length > 0 && runningAtCrash > 0, `done ${doneAtCrash.length}, running ${runningAtCrash}`);
  // Lease läuft noch, also noch kein zweiter Lauf.
  h.store.crashAfterSaves = null;
  assert.equal(await h.stage(), null);
  h.clock.t += 331_000;
  h.calls.length = 0;
  const rest = await h.run();
  assert.equal(rest.at(-1), "finished");
  for (const position of doneAtCrash) assert.ok(!calledPositions(h).includes(position), `Teil ${position} doppelt`);
  const stages = h.store.result?.stages as { unmetered_attempts: number };
  assert.equal(stages.unmetered_attempts, runningAtCrash);
  assert.equal(h.store.status, "done");
});

test("4 Zwei Claims gleichzeitig: nur einer gewinnt", async () => {
  const h = harness({ parts: 1 });
  const [a, b] = await Promise.all([
    h.store.claim("x", null, "lease-a", 330),
    h.store.claim("x", null, "lease-b", 330),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
});

test("4b Einmal-Token: falscher Hash verliert, gültiger gewinnt und ist danach entwertet", async () => {
  const h = harness({ parts: 1 });
  h.store.job!.token = "hash";
  assert.equal(await h.store.claim("x", "falsch", "l1", 330), null);
  assert.ok(await h.store.claim("x", "hash", "l2", 330));
  h.store.job!.lease_until = null;
  assert.equal(await h.store.claim("x", "hash", "l3", 330), null);
});

test("5 Zombie mit fremder lease_id schreibt nichts", async () => {
  const h = harness({
    parts: 1,
    script: () => ({
      onCall: () => {
        h.store.job!.lease_id = "fremd";
        h.store.parts[0].lease_id = "fremd";
      },
    }),
  });
  const r = await h.stage("start");
  assert.equal(r, "lease_lost");
  assert.equal(h.store.parts[0].items, null);
  assert.equal(h.store.parts[0].status, "running");
  assert.equal(h.store.status, "running");
  assert.equal(h.dispatched, 0);
});

test("6 429 mit retry-after: Drosselung ohne gezählten Versuch", async () => {
  const h = harness({
    parts: 2,
    script: (req, nth) => (req.unit.index === 1 && nth === 1 ? { durationMs: 1_000, error: { cls: "overload", retryAfterMs: 40_000 } } : {}),
  });
  const results = await h.run();
  assert.equal(results.at(-1), "finished");
  assert.equal(h.store.status, "done");
  assert.equal(h.store.items.length, 2);
  const calls = h.store.result?.calls as { retried: boolean; norm_id: string }[];
  assert.equal(calls.find((c) => c.norm_id === "n1")?.retried, false);
  assert.equal(failedNorms(h).length, 0);
});

test("6b Überlast über der Grenze: Teile failed, Abschluss done mit failed_norms", async () => {
  const h = harness({
    parts: 3,
    script: (req) => (req.unit.index === 1 ? { durationMs: 1_000, error: { cls: "overload", retryAfterMs: 20 * 60_000 } } : {}),
  });
  await h.run();
  assert.equal(h.store.status, "done");
  const failed = failedNorms(h);
  assert.ok(failed.some((f) => f.error === REASON_OVERLOAD), JSON.stringify(failed));
  assert.ok(h.store.items.length >= 1);
});

test("7 enforced_spend_limit_reached: sofortiger Abschluss ohne Warten und ohne weitere Aufrufe", async () => {
  const h = harness({
    parts: 20,
    script: (req) => (req.unit.index === 0 ? { items: [item("n0")], durationMs: 1_000, error: { cls: "fatal_account", message: "Limit" } } : {}),
  });
  const started = h.clock.now();
  const results = await h.run();
  assert.deepEqual(results, ["finished"]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.dispatched, 0);
  assert.ok(h.clock.now() - started < 60_000);
  assert.ok(failedNorms(h).some((f) => f.error === REASON_ACCOUNT));
  assert.equal(failedNorms(h).length, 20);
});

test("8 Abbruch während des Aufrufs: cancelled, keine Items, Kosten erhalten, Job weg", async () => {
  const h = harness({
    parts: 3,
    script: () => ({ onCall: () => { h.store.status = "cancelled"; }, tokens: { output_tokens: 777 } }),
  });
  const r = await h.stage("start");
  assert.equal(r, "cancelled");
  assert.equal(h.store.status, "cancelled");
  assert.equal(h.store.items.length, 0);
  assert.ok(h.store.cost > 0);
  assert.equal(h.store.result?.cancelled, true);
  assert.equal(h.store.job, null);
  assert.equal(h.dispatched, 0);
});

test("8b Abbruch zwischen den Etappen: Claim trifft nichts, Kosten stehen schon", async () => {
  const h = harness({ parts: 38 });
  assert.equal(await h.stage("start"), "handed_off");
  const cost = h.store.cost;
  assert.ok(cost > 0);
  h.store.status = "cancelled";
  assert.equal(await h.stage(), null);
  assert.equal(h.store.status, "cancelled");
  assert.equal(h.store.cost, cost);
  assert.equal(h.store.items.length, 0);
});

test("8c Admin schliesst als Zeitüberschreitung: Text bleibt, Status wird nicht überschrieben", async () => {
  const h = harness({ parts: 2, script: () => ({ onCall: () => { h.store.status = "error"; h.store.result = { error: "Zeitüberschreitung" }; } }) });
  await h.stage("start");
  assert.equal(h.store.status, "error");
  assert.equal(h.store.result?.error, "Zeitüberschreitung");
  assert.ok(h.store.cost > 0);
});

test("9 DB-Fehler im Cancel-Poll ist kein Abbruch", async () => {
  const h = harness({ parts: 2 });
  h.store.statusError = true;
  const results = await h.run();
  assert.equal(results.at(-1), "finished");
  assert.equal(h.store.status, "done");
  assert.ok(h.warnings.some((w) => w.includes("Cancel-Poll")));
});

test("10 Analyse gelöscht: kein Wurf, kein Anstoss", async () => {
  const h = harness({
    parts: 3,
    script: () => ({ onCall: () => { h.store.status = null; h.store.job = null; h.store.parts = []; } }),
  });
  const r = await h.stage("start");
  assert.equal(r, "gone");
  assert.equal(h.dispatched, 0);
});

test("11 Timeout: Wiederholung mit low, besserer Versuch gewinnt, Tokens beider zählen", async () => {
  const h = harness({
    parts: 1,
    script: (_req, nth) => nth === 1
      ? { durationMs: 300_000, tokens: { output_tokens: 111 } }
      : { durationMs: 10_000, tokens: { output_tokens: 222 }, items: [item("n0", "a"), item("n0", "b")] },
  });
  await h.run();
  assert.equal(h.calls[0].effort, null);
  assert.equal(h.calls[1].effort, "low");
  assert.equal(h.store.items.length, 2);
  assert.equal((h.store.result?.usage as { output_tokens: number }).output_tokens, 333 + 100);
  const call = (h.store.result?.calls as { ok: boolean; retried: boolean; output_tokens: number }[])[0];
  assert.deepEqual([call.ok, call.retried, call.output_tokens], [true, true, 333]);
});

test("11b Von der Etappengrenze abgeschnitten: gleiche Denktiefe", async () => {
  const h = harness({
    parts: 2,
    script: (req, nth) => (req.unit.index === 0 && nth === 1 ? { durationMs: 145_000, error: { cls: "timeout" } } : {}),
  });
  await h.run();
  const second = h.calls.filter((c) => c.unit.index === 0)[1];
  assert.equal(second.effort, null);
  assert.equal(h.store.status, "done");
});

test("12 Konsolidierung reicht nicht: Übergabe, genau ein Aufruf, Absturz danach zahlt nicht erneut", async () => {
  // 300 Punkte brauchen 185 s + 10 s Reserve. Nach 100 s Teilen reicht die Etappe nicht mehr.
  const many = Array.from({ length: 300 }, () => item("n0"));
  const h = harness({ parts: 1, script: () => ({ durationMs: 100_000, items: many }) });
  assert.equal(await h.stage("start"), "handed_off");
  assert.equal(h.consolidations, 0);
  assert.equal(h.store.job?.phase, "consolidate");

  h.store.crashAfterSaves = h.store.saves; // Abschluss stürzt ab, Ergebnis der Konsolidierung ist aber schon da
  h.store.crashAfterSaves = null;
  const closeBefore = h.store.closeAnalysis.bind(h.store);
  let failedOnce = false;
  h.store.closeAnalysis = async (id, f) => {
    if (!failedOnce) { failedOnce = true; throw new Error("DB weg"); }
    return closeBefore(id, f);
  };
  assert.equal(await h.stage(), "crashed");
  assert.equal(h.consolidations, 1);
  assert.equal(h.store.job?.phase, "finalize");
  assert.equal(await h.stage(), "finished");
  assert.equal(h.consolidations, 1);
  assert.equal(h.store.status, "done");
});

test("12b Konsolidierung zweimal gescheitert: Rohpunkte, applied=false, Status done", async () => {
  const h = harness({ parts: 3, consolidate: () => ({ applied: false }) });
  await h.run();
  assert.equal(h.consolidations, 2);
  assert.equal(h.store.status, "done");
  assert.equal(h.store.items.length, 3);
  assert.equal((h.store.result?.consolidation as { applied: boolean }).applied, false);
  assert.ok((h.store.result?.usage as { input_tokens: number }).input_tokens >= 3200);
});

test("12c Konsolidierung bekommt eine Kopie: Rohpunkte bleiben unverändert", async () => {
  const h = harness({
    parts: 2,
    consolidate: (_n, items) => { items[0].status = "ok"; return { applied: false }; },
  });
  await h.run();
  assert.ok(h.store.items.every((i) => i.status === "warn"));
});

test("13 System, Referenz, Grenzmarker und URLs sind in allen Etappen byte-identisch", async () => {
  const h = harness({ parts: 80 });
  const results = await h.run();
  assert.ok(results.length >= 3, results.join());
  assert.equal(new Set(h.calls.map((c) => c.system)).size, 1);
  assert.equal(new Set(h.calls.map((c) => c.referenceText)).size, 1);
  assert.equal(new Set(h.calls.map((c) => c.boundary)).size, 1);
  assert.equal(new Set(h.calls.map((c) => JSON.stringify(c.files))).size, 1);
  assert.equal(h.signs, 0);
});

test("14 URL mit weniger als 30 min Rest wird neu signiert", async () => {
  const h = harness({ parts: 1, urlsExpireInMs: 10 * 60_000 });
  await h.run();
  assert.equal(h.signs, 1);
  assert.match(JSON.stringify(h.calls[0].files), /signed-new-1/);
});

test("14b file_fetch: einmal je Etappe neu signieren, danach Fehler", async () => {
  const h = harness({
    parts: 1,
    script: () => ({ durationMs: 1_000, error: { cls: "file_fetch", message: "could not fetch url" } }),
  });
  await h.run();
  assert.equal(h.signs, 1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.store.status, "error");
  assert.match(String(h.store.result?.error), /could not fetch url/);
});

test("15 Kostengrenze: offene Teile failed mit Grund", async () => {
  const h = harness({ parts: 20, maxRunCostUsd: 0.5 });
  await h.run();
  assert.equal(h.store.status, "done");
  assert.ok(h.calls.length < 20);
  assert.ok(failedNorms(h).some((f) => f.error === REASON_COST));
});

test("15b MAX_STAGES: offene Teile failed, weiter zum Abschluss", async () => {
  const h = harness({ parts: 2 });
  assert.equal(await h.stage("start"), "finished");
  const j = harness({ parts: 2, job: { stage_no: MAX_STAGES, phase: "prepare" } });
  assert.equal(await j.stage(), "finished");
  assert.equal(j.store.status, "error"); // ohne Snapshot gibt es nichts zu retten
  const k = harness({ parts: 38 });
  assert.equal(await k.stage("start"), "handed_off");
  k.store.job!.stage_no = MAX_STAGES;
  assert.equal(await k.stage(), "finished");
  assert.equal(k.store.status, "done");
  assert.ok(failedNorms(k).some((f) => f.error === REASON_STAGES));
});

test("15c Drei Etappen ohne Fortschritt: Abschluss mit Grund", async () => {
  const h = harness({ parts: 2 });
  assert.equal(await h.stage("start"), "finished");
  const k = harness({ parts: 80 });
  assert.equal(await k.stage("start"), "handed_off");
  k.store.job!.no_progress_stages = 3;
  assert.equal(await k.stage(), "finished");
  assert.equal(k.store.status, "done");
  assert.ok(failedNorms(k).some((f) => f.error === REASON_STAGES));
});

test("15d Zu neue state_version: Fehlermeldung statt falscher Ergebnisse", async () => {
  const h = harness({ parts: 2, job: { state_version: STATE_VERSION + 1 } });
  assert.equal(await h.stage(), "finished");
  assert.equal(h.store.status, "error");
  assert.match(String(h.store.result?.error), /neueren Programmversion/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.job, null);
});

test("16 Keine Prüfpunkte: error mit Grund", async () => {
  const h = harness({ parts: 1, script: () => ({ durationMs: 1_000, error: { cls: "refusal", message: "abgelehnt" } }) });
  await h.run();
  assert.equal(h.store.status, "error");
  assert.match(String(h.store.result?.error), /Analyse ohne Ergebnis: abgelehnt/);
  assert.equal(h.calls.length, 1);
});

test("Vorbereitung scheitert: Fehler mit Grund, kein Anstoss", async () => {
  const h = harness({ parts: 1, prepareFails: "Dateien konnten nicht freigegeben werden" });
  assert.equal(await h.stage("start"), "finished");
  assert.equal(h.store.status, "error");
  assert.match(String(h.store.result?.error), /nicht freigegeben/);
});

test("Auslöser fehlt (Erweiterungen nicht aktiv): dispatch_url weg, Browser übernimmt", async () => {
  const h = harness({ parts: 38, dispatcher: () => "unavailable" });
  assert.equal(await h.stage("start"), "handed_off");
  assert.equal(h.dispatched, 1);
  assert.equal(h.store.job?.dispatch_url, null);
  const results = await h.run();
  assert.equal(results.at(-1), "finished");
  assert.equal(h.dispatched, 1);
  assert.equal(h.store.status, "done");
});

test("Ohne dispatch_url kein Anstoss, Wiederaufnahme wird gezählt", async () => {
  const h = harness({ parts: 80, job: { dispatch_url: null } });
  assert.equal(await h.stage("start"), "handed_off");
  assert.equal(h.dispatched, 0);
  assert.equal(await h.stage("resume"), "handed_off");
  while ((await h.stage("resume")) === "handed_off") { /* weiter */ }
  assert.equal(h.store.status, "done");
  assert.ok((h.store.result?.stages as { resumes: number }).resumes >= 2);
});

test("Erster Aufruf läuft allein, die übrigen warten auf das Tor", async () => {
  const h = harness({ parts: 3 });
  const startTimes: number[] = [];
  const original = h.deps.model.callPart.bind(h.deps.model);
  h.deps.model.callPart = (req) => { startTimes.push(h.clock.now()); return original(req); };
  await h.run();
  assert.ok(startTimes[1] > startTimes[0], "zweiter Aufruf erst nach dem Tor");
  assert.equal(startTimes[1], startTimes[2]);
});

test("Lebenszeichen und laufende Kosten stehen nach jedem Teil auf der Analyse", async () => {
  const h = harness({ parts: 38 });
  await h.stage("start");
  assert.ok(typeof h.store.result?.last_activity_at === "string");
  assert.ok(h.store.cost > 0);
  assert.deepEqual(Object.keys(h.store.result ?? {}).sort(), ["last_activity_at", "run_id", "stages"]);
});
