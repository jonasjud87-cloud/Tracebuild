import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_RETRYABLE_HINT, UNKNOWN_FAILURE, analysisFailure, analysisFailureText, failureReference } from "./analysis-error-logic";

test("Fehlertext: bekannte Gründe werden zu Nutzertexten", () => {
  assert.match(analysisFailureText("Analyse ohne Ergebnis: Anthropic dauerhaft überlastet, Teil nicht geprüft"), /überlastet/);
  assert.match(analysisFailureText("Analyse ohne Ergebnis: 429 rate_limit_error"), /überlastet/);
  assert.match(analysisFailureText("Analyse ohne Ergebnis: Kostengrenze erreicht"), /Kostengrenze/);
  assert.match(analysisFailureText("Analyse ohne Ergebnis: Anthropic-Konto verweigert weitere Aufrufe, Teil nicht geprüft"), /Kostengrenze/);
  assert.match(analysisFailureText("Analyse ohne Ergebnis: Keine Prüfpunkte erzeugt"), /keine Prüfpunkte/);
  assert.match(analysisFailureText("Dateien konnten nicht freigegeben werden: Object not found"), /Pläne konnten nicht gelesen/);
  assert.match(analysisFailureText("Die Normen des Projekts konnten nicht geladen werden. Bitte später erneut versuchen."), /Normen/);
  assert.match(analysisFailureText("Die Analyse brach wiederholt ab und wurde beendet. Bitte erneut starten."), /wiederholt abgebrochen/);
  assert.match(analysisFailureText("Analyse wegen Rückrollung abgebrochen. Bitte neu starten."), /Systemaktualisierung/);
  assert.match(analysisFailureText("Analyse ohne Ergebnis: fetch failed"), /Verbindung/);
});

test("Fehlertext: Zeitüberschreitung, auch nur über timed_out", () => {
  assert.match(analysisFailureText("Zeitüberschreitung"), /^Zeitüberschreitung/);
  assert.match(analysisFailureText("Analyse ohne Ergebnis: Zeitbudget der Analyse überschritten"), /^Zeitüberschreitung/);
  assert.match(analysisFailureText("Request timed out."), /^Zeitüberschreitung/);
  assert.match(analysisFailureText(null, true), /^Zeitüberschreitung/);
  assert.match(analysisFailureText("irgendwas", true), /^Zeitüberschreitung/);
});

test("Fehlertext: leer oder fehlend ergibt «Unbekannter Fehler»", () => {
  assert.equal(analysisFailureText(null), UNKNOWN_FAILURE);
  assert.equal(analysisFailureText(undefined), UNKNOWN_FAILURE);
  assert.equal(analysisFailureText(""), UNKNOWN_FAILURE);
  assert.equal(analysisFailureText("   "), UNKNOWN_FAILURE);
  assert.equal(UNKNOWN_FAILURE, "Unbekannter Fehler.");
});

test("Fehlertext: unbekannte Gründe und Interna werden nie durchgereicht", () => {
  const leaks = [
    'duplicate key value violates unique constraint "analysis_jobs_project_id_key"',
    "TypeError: Cannot read properties of undefined (reading 'id')\n    at runStage (/var/task/lib/run-stage.ts:120:5)",
    "invalid input syntax for type uuid: \"sk-ant-api03-geheim\"",
    "Projekt nicht gefunden",
  ];
  for (const raw of leaks) {
    const text = analysisFailureText(raw);
    assert.equal(text, UNKNOWN_FAILURE, raw);
    assert.doesNotMatch(text, /sk-ant|at runStage|constraint|uuid|\/var\/task/);
  }
  // Auch ein bekannter Grund gibt nur den festen Text, nie den Rest der Meldung.
  const mixed = analysisFailureText("Dateien konnten nicht freigegeben werden: https://x.supabase.co/storage/v1/sign?token=abc");
  assert.doesNotMatch(mixed, /supabase|token/);
});

test("Referenz: acht Zeichen der Analyse-ID", () => {
  assert.equal(failureReference("3f2a9c1d-7e4b-4a1c-9d2e-123456789abc"), "3F2A9C1D");
  assert.equal(failureReference(""), "");
});

test("Wiederholbarkeit: kein Retry bei Kostengrenze, gesperrtem Konto oder abgelehnter Prüfung", () => {
  for (const raw of [
    "Analyse ohne Ergebnis: Kostengrenze erreicht",
    "Analyse ohne Ergebnis: Anthropic-Konto verweigert weitere Aufrufe, Teil nicht geprüft",
    "Analyse ohne Ergebnis: Modell hat die Prüfung abgelehnt (cyber)",
    "Your credit balance is too low",
  ]) {
    assert.equal(analysisFailure(raw).retryable, false, raw);
  }
  for (const raw of [null, "", "Zeitüberschreitung", "Analyse ohne Ergebnis: Anthropic dauerhaft überlastet", "Dateien konnten nicht freigegeben werden: x", "irgendwas Internes"]) {
    assert.equal(analysisFailure(raw).retryable, true, String(raw));
  }
  assert.equal(analysisFailure(null, true).retryable, true);
  assert.match(NOT_RETRYABLE_HINT, /Support/);
});
