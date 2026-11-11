import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalysisRunProgress } from "../lib/analysis-stages/contract";
import {
  INITIAL_RUN_POLL,
  applyPoll,
  applyResumeResult,
  buildPreflight,
  consolidationFailed,
  findActiveRun,
  interpretStatusResponse,
  isInterruptedRun,
  nextPercent,
  pollDelayMs,
  preflightNoteText,
  progressLabel,
  readPreflight,
  runProgressView,
  safetyLimitHint,
  selectionAfterRun,
  shouldResume,
  sortAnalysisItems,
  type RunPollState,
} from "./analysis-run-view";

const progress = (over: Partial<AnalysisRunProgress> = {}): AnalysisRunProgress => ({
  phase: "checking",
  percent: 50,
  parts_done: 12,
  parts_total: 38,
  stalled: false,
  background: true,
  needs_resume: false,
  ...over,
});

const statusPoll = (status: "running" | "done" | "error" | "cancelled", p: AnalysisRunProgress | null) => ({
  kind: "status" as const,
  status: { id: "a", status, progress: p, error_message: null },
});

test("findActiveRun nimmt die neueste laufende Analyse", () => {
  const list = [
    { id: "alt", status: "running", created_at: "2026-11-01T10:00:00Z" },
    { id: "fertig", status: "done", created_at: "2026-11-05T10:00:00Z" },
    { id: "neu", status: "running", created_at: "2026-11-03T10:00:00Z" },
  ];
  assert.equal(findActiveRun(list)?.id, "neu");
  assert.equal(findActiveRun(list.filter((a) => a.status === "done")), null);
});

test("sortAnalysisItems: Norm-Reihenfolge, dann Schwere; ohne norm_versions nur Schwere", () => {
  const items = [
    { id: "1", norm_id: "b", status: "fail" },
    { id: "2", norm_id: "a", status: "ok" },
    { id: "3", norm_id: "a", status: "fail" },
    { id: "4", norm_id: null, status: "fail" },
  ];
  const ordered = sortAnalysisItems(items, [{ norm_id: "a" }, { norm_id: "b" }]);
  assert.deepEqual(ordered.map((i) => i.id), ["3", "2", "1", "4"]);
  assert.deepEqual(sortAnalysisItems(items, undefined).map((i) => i.id), ["1", "3", "4", "2"]);
  assert.equal(items[0].id, "1", "Eingabe bleibt unverändert");
});

test("selectionAfterRun: Ergebnis oder Fehler zeigen, Abbruch fällt auf letztes Ergebnis zurück", () => {
  const done = { id: "v1", status: "done" };
  const finished = { id: "run", status: "done" };
  const failed = { id: "run", status: "error" };
  const running = { id: "run", status: "running" };
  assert.equal(selectionAfterRun([finished, done], "run", null), finished);
  assert.equal(selectionAfterRun([failed, done], "run", done), failed);
  assert.equal(selectionAfterRun([done], "run", running), done, "abgebrochene Version ist weg");
  assert.equal(selectionAfterRun([], "run", running), null);
  assert.equal(selectionAfterRun([done], "run", done), done, "andere Prüfung läuft: Auswahl bleibt");
  assert.equal(selectionAfterRun([running, done], "run", done), done, "Liste noch nicht nachgeführt");
});

test("interpretStatusResponse unterscheidet Antwort, Löschung und Störung", () => {
  const body = JSON.stringify({ data: { id: "a", status: "running", progress: null, error_message: null } });
  assert.equal(interpretStatusResponse(200, body, "a").kind, "status");
  assert.equal(interpretStatusResponse(404, "{}", "a").kind, "gone");
  assert.equal(interpretStatusResponse(500, body, "a").kind, "failed");
  assert.equal(interpretStatusResponse(200, "<html>Login</html>", "a").kind, "failed", "Login-Umleitung ist kein Erfolg");
  assert.equal(interpretStatusResponse(200, JSON.stringify({ data: { id: "b", status: "done" } }), "a").kind, "failed");
  assert.equal(interpretStatusResponse(200, JSON.stringify({ data: null }), "a").kind, "failed");
});

test("nextPercent bleibt steigend und im Bereich", () => {
  assert.equal(nextPercent(null, 5), 5);
  assert.equal(nextPercent(40, 30), 40);
  assert.equal(nextPercent(40, 130), 100);
  assert.equal(nextPercent(null, Number.NaN), 0);
});

test("applyPoll: Prozent steigend, Fehler zählen, Ende wird erkannt", () => {
  let s: RunPollState = applyPoll(INITIAL_RUN_POLL, statusPoll("running", progress({ percent: 40 })));
  assert.equal(s.percent, 40);
  s = applyPoll(s, statusPoll("running", progress({ percent: 20 })));
  assert.equal(s.percent, 40);

  s = applyPoll(s, { kind: "failed" });
  s = applyPoll(s, { kind: "failed" });
  assert.equal(s.failures, 2);
  assert.equal(s.ended, false, "Netzfehler heisst nie, die Analyse sei zu Ende");
  assert.equal(s.percent, 40);

  const noJob = applyPoll(s, statusPoll("running", null));
  assert.equal(noJob.failures, 0);
  assert.equal(noJob.progress?.percent, 20, "letzter Stand bleibt, wenn der Job gerade verschwindet");

  assert.equal(applyPoll(s, statusPoll("done", null)).ended, true);
  assert.equal(applyPoll(s, statusPoll("error", null)).ended, true);
  assert.equal(applyPoll(s, statusPoll("cancelled", null)).ended, true);
  assert.equal(applyPoll(s, { kind: "gone" }).ended, true);
});

test("shouldResume nur auf Wunsch des Servers und höchstens alle 30 s", () => {
  assert.equal(shouldResume(progress(), null, 1000), false);
  assert.equal(shouldResume(null, null, 1000), false);
  assert.equal(shouldResume(progress({ needs_resume: true }), null, 1000), true);
  assert.equal(shouldResume(progress({ needs_resume: true }), 1000, 30_999), false);
  assert.equal(shouldResume(progress({ needs_resume: true }), 1000, 31_000), true);
});

test("isInterruptedRun trifft nur Altläufe ohne Fortschrittsdaten", () => {
  const created = "2026-11-05T10:00:00Z";
  const now = Date.parse(created) + 7 * 60_000;
  const known = applyPoll(INITIAL_RUN_POLL, statusPoll("running", null));
  assert.equal(isInterruptedRun(known, created, now), true);
  assert.equal(isInterruptedRun(known, created, Date.parse(created) + 60_000), false, "noch jung");
  assert.equal(isInterruptedRun(INITIAL_RUN_POLL, created, now), false, "noch keine Antwort");
  const staged = applyPoll(INITIAL_RUN_POLL, statusPoll("running", progress()));
  assert.equal(isInterruptedRun(staged, created, now), false, "lange Läufe mit Daten sind gesund");
});

test("pollDelayMs: sichtbar schnell, verdeckt langsam als Rückfall, unterbrochen selten", () => {
  assert.equal(pollDelayMs(false, false), 5_000);
  assert.equal(pollDelayMs(true, false), 30_000);
  assert.equal(pollDelayMs(false, true), 60_000);
});

test("progressLabel: Wortlaut je Phase", () => {
  assert.equal(progressLabel(progress({ phase: "preparing" })), "Analyse wird vorbereitet…");
  assert.equal(progressLabel(progress()), "Pläne werden gegen die Normen geprüft (12 von 38)…");
  assert.equal(progressLabel(progress({ parts_total: 0, parts_done: 0 })), "Pläne werden gegen die Normen geprüft…");
  assert.equal(progressLabel(progress({ phase: "consolidating" })), "Ergebnisse werden zusammengeführt…");
  assert.equal(progressLabel(progress({ phase: "finalizing" })), "Ergebnis wird gespeichert…");
  assert.equal(progressLabel(null), "Analyse läuft…");
});

test("runProgressView: Hinweise nur, wenn sie stimmen", () => {
  const created = "2026-11-05T10:00:00Z";
  const now = Date.parse(created) + 60_000;
  const background = applyPoll(INITIAL_RUN_POLL, statusPoll("running", progress()));
  assert.deepEqual(runProgressView(background, created, now).hints, ["Sie können diese Seite schliessen, die Analyse läuft weiter."]);

  const preview = applyPoll(INITIAL_RUN_POLL, statusPoll("running", progress({ background: false })));
  assert.deepEqual(runProgressView(preview, created, now).hints, [], "Preview: kein Versprechen zum Schliessen");

  const stalled = applyPoll(INITIAL_RUN_POLL, statusPoll("running", progress({ stalled: true, background: false })));
  assert.match(runProgressView(stalled, created, now).hints[0], /länger als üblich/);

  let offline = background;
  for (let i = 0; i < 4; i++) offline = applyPoll(offline, { kind: "failed" });
  assert.equal(runProgressView(offline, created, now).hints.some((h) => h.startsWith("Verbindung")), false);
  offline = applyPoll(offline, { kind: "failed" });
  assert.equal(runProgressView(offline, created, now).hints[0].startsWith("Verbindung unterbrochen"), true);

  const old = applyPoll(INITIAL_RUN_POLL, statusPoll("running", null));
  const interrupted = runProgressView(old, created, Date.parse(created) + 10 * 60_000);
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.percent, null);
  assert.equal(interrupted.retryable, true, "Unterbrochen: «Erneut versuchen» anbieten");
  assert.equal(runProgressView(background, created, now).retryable, false, "Gesunder Lauf: kein Retry");
  assert.equal(runProgressView(stalled, created, now).retryable, false, "Nur langsam: kein Retry");
});

test("Texte nennen nie die interne Aufteilung", () => {
  const forbidden = /etappe|stage|lauf-nummer/i;
  const created = "2026-11-05T10:00:00Z";
  const states = [
    progress({ phase: "preparing" }),
    progress({ stalled: true }),
    progress({ phase: "consolidating" }),
    progress({ phase: "finalizing" }),
  ];
  for (const p of states) {
    const view = runProgressView(applyPoll(INITIAL_RUN_POLL, statusPoll("running", p)), created, Date.parse(created));
    assert.doesNotMatch([view.label, ...view.hints].join(" "), forbidden);
  }
  for (const documents of ["timeout", "skipped", "error", "stalled", "unavailable", "busy", "aborted"] as const) {
    assert.doesNotMatch(preflightNoteText({ oereb: "failed", documents, stale_fetched_at: null }), forbidden);
  }
});

test("buildPreflight: verschluckter Sync-Fehler wird festgehalten", () => {
  const oereb = { usedStale: false, staleFetchedAt: null, documentsPending: 2 };
  assert.deepEqual(buildPreflight({ outcome: "done", oereb, syncEnd: "error" }), {
    oereb: "ok", documents: "error", stale_fetched_at: null,
  });
  for (const end of ["stalled", "busy", "unavailable", "aborted", "done"] as const) {
    assert.equal(buildPreflight({ outcome: "done", oereb, syncEnd: end }).documents, end);
  }
});

test("buildPreflight: alle übrigen Ausgänge", () => {
  const noDocs = { usedStale: false, staleFetchedAt: null, documentsPending: 0 };
  assert.deepEqual(buildPreflight({ outcome: "done", oereb: noDocs, syncEnd: null }), {
    oereb: "ok", documents: "not_needed", stale_fetched_at: null,
  });
  assert.deepEqual(
    buildPreflight({ outcome: "done", oereb: { ...noDocs, usedStale: true, staleFetchedAt: "2026-10-01T00:00:00Z" }, syncEnd: null }),
    { oereb: "stale", documents: "not_needed", stale_fetched_at: "2026-10-01T00:00:00Z" },
  );
  assert.deepEqual(buildPreflight({ outcome: "failed", oereb: null, syncEnd: null }), {
    oereb: "failed", documents: "not_needed", stale_fetched_at: null,
  });
  assert.deepEqual(buildPreflight({ outcome: "timeout", oereb: null, syncEnd: null }), {
    oereb: "timeout", documents: "timeout", stale_fetched_at: null,
  });
  assert.deepEqual(buildPreflight({ outcome: "skipped", oereb: { ...noDocs, documentsPending: 3 }, syncEnd: null }), {
    oereb: "ok", documents: "skipped", stale_fetched_at: null,
  });
  assert.equal(buildPreflight({ outcome: "timeout", oereb: noDocs, syncEnd: null }).documents, "not_needed");
  assert.equal(
    buildPreflight({ outcome: "failed", oereb: { ...noDocs, documentsPending: 1 }, syncEnd: null }).documents,
    "error",
    "Sync warf eine Ausnahme",
  );
});

test("preflightNoteText: leer, wenn alles aktuell war, sonst Klartext", () => {
  assert.equal(preflightNoteText(null), "");
  assert.equal(preflightNoteText({ oereb: "ok", documents: "not_needed", stale_fetched_at: null }), "");
  assert.equal(preflightNoteText({ oereb: "ok", documents: "done", stale_fetched_at: null }), "");
  assert.match(preflightNoteText({ oereb: "ok", documents: "error", stale_fetched_at: null }), /nicht vollständig aktualisiert/);
  assert.match(preflightNoteText({ oereb: "stale", documents: "not_needed", stale_fetched_at: "2026-10-01T12:00:00Z" }), /Stand vom 01\.10\.2026/);
  assert.match(preflightNoteText({ oereb: "skipped", documents: "skipped", stale_fetched_at: null }), /^Ohne Warten gestartet/);
  assert.match(preflightNoteText({ oereb: "timeout", documents: "not_needed", stale_fetched_at: null }), /nicht abgewartet/);
});

test("readPreflight und consolidationFailed vertragen alte Analysen", () => {
  assert.equal(readPreflight(undefined), null);
  assert.equal(readPreflight({ oereb: 1 }), null);
  assert.deepEqual(readPreflight({ oereb: "ok", documents: "done" }), { oereb: "ok", documents: "done", stale_fetched_at: null });
  assert.equal(consolidationFailed(null), false);
  assert.equal(consolidationFailed({ raw_count: 3 }), false);
  assert.equal(consolidationFailed({ applied: false }), true);
});

test("safetyLimitHint erscheint nur, wenn die Grenze wirklich griff", () => {
  assert.equal(safetyLimitHint(null), "");
  assert.equal(safetyLimitHint({ skipped: 8 }), "", "alter Deckel ohne limit");
  assert.equal(safetyLimitHint({ skipped: 0, limit: 30 }), "");
  assert.match(safetyLimitHint({ skipped: 8, limit: 30 }), /Sicherheitsgrenze von 30/);
});

test("Scheitert die Wiederaufnahme dauerhaft, verspricht die Anzeige nichts Automatisches mehr", () => {
  const progress: AnalysisRunProgress = {
    phase: "checking", percent: 40, parts_done: 3, parts_total: 9, stalled: true, background: true, needs_resume: true,
  };
  let state = applyPoll(INITIAL_RUN_POLL, { kind: "status", status: { id: "a", status: "running", progress, error_message: null } });
  assert.match(runProgressView(state, null, 0).hints.join(" "), /automatisch fortgesetzt/);
  state = applyResumeResult(applyResumeResult(state, false), false);
  assert.match(runProgressView(state, null, 0).hints.join(" "), /automatisch fortgesetzt/);
  state = applyResumeResult(state, false);
  const hints = runProgressView(state, null, 0).hints.join(" ");
  assert.doesNotMatch(hints, /automatisch fortgesetzt|schliessen/);
  assert.match(hints, /kommt zurzeit nicht weiter/);
  assert.equal(runProgressView(state, null, 0).retryable, true, "Festgefahren: «Erneut versuchen» anbieten");
  // Der Zustand überlebt weitere Abfragen, solange der Server wartet, und verschwindet, wenn es weitergeht.
  state = applyPoll(state, { kind: "status", status: { id: "a", status: "running", progress, error_message: null } });
  assert.equal(state.resumeFailures, 3);
  state = applyPoll(state, { kind: "status", status: { id: "a", status: "running", progress: { ...progress, needs_resume: false }, error_message: null } });
  assert.equal(state.resumeFailures, 0);
  assert.equal(applyResumeResult({ ...state, resumeFailures: 2 }, true).resumeFailures, 0);
});
