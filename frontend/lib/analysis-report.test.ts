import { test } from "node:test";
import assert from "node:assert/strict";

import { autoPartsWarning, buildReportCsv, buildReportHtml, failedNormLines, preflightLines } from "./analysis-report";

const meta = {
  projectName: "P", canton: "AR", municipality: "Herisau", parcel: null, bauzone: null,
  planType: "Baugesuch", version: 1, createdAt: "2026-11-05T10:00:00Z",
};

test("Ausfälle stehen in PDF und CSV, HTML ist maskiert", () => {
  const failedNorms = [{ norm_title: "Baureglement <Herisau> (Teil 2/3)", error: "Kostengrenze erreicht" }];
  const html = buildReportHtml({ ...meta, failedNorms }, []);
  assert.match(html, /Ergebnis unvollständig/);
  assert.match(html, /Baureglement &lt;Herisau&gt; \(Teil 2\/3\): Kostengrenze erreicht/);
  assert.match(buildReportCsv({ ...meta, failedNorms }, []), /Ergebnis unvollständig;.*Kostengrenze erreicht/);
});

test("CSV: Ein Ausfalltext kann keine Formel einschleusen", () => {
  const csv = buildReportCsv({ ...meta, failedNorms: [{ norm_title: "=HYPERLINK(1)", error: "x" }] }, []);
  assert.doesNotMatch(csv, /;=HYPERLINK/);
});

test("Rückfall alte Analysen: ohne Angaben keine Zusatzzeilen", () => {
  assert.deepEqual(failedNormLines(undefined), []);
  assert.deepEqual(failedNormLines(null), []);
  for (const out of [buildReportHtml(meta, []), buildReportCsv(meta, [])]) {
    assert.doesNotMatch(out, /Ergebnis unvollständig|Dubletten|Hinweis;/);
  }
});

test("Vorprüfung: Einschränkungen im Bericht, Normalfall ohne Zeile", () => {
  assert.deepEqual(preflightLines({ oereb: "ok", documents: "done", stale_fetched_at: null }), []);
  assert.deepEqual(preflightLines({ oereb: "ok", documents: "not_needed", stale_fetched_at: null }), []);
  assert.deepEqual(preflightLines(null), []);
  const preflight = { oereb: "stale", documents: "error", stale_fetched_at: "2026-10-01T10:00:00Z" } as const;
  const lines = preflightLines(preflight);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /ältere Stand vom 01\.10\.2026/);
  assert.match(buildReportHtml({ ...meta, preflight }, []), /nicht vollständig übernommen/);
  assert.match(buildReportCsv({ ...meta, preflight }, []), /Hinweis;.*ältere Stand/);
});

test("Dubletten nicht zusammengeführt steht im Bericht", () => {
  assert.match(buildReportHtml({ ...meta, consolidationFailed: true }, []), /Dubletten nicht zusammengeführt/);
  assert.match(buildReportCsv({ ...meta, consolidationFailed: true }, []), /Dubletten nicht zusammengeführt/);
});

test("Sicherheitsgrenze nur, wenn limit gesetzt, Wortlaut sonst unverändert", () => {
  const p = { total: 38, run: 30, skipped: 8, skipped_titles: [] };
  assert.equal(autoPartsWarning(p), "Vom Reglement wurden 30 von 38 Teilen geprüft, der Rest ist in dieser Analyse nicht berücksichtigt.");
  assert.match(autoPartsWarning({ ...p, limit: 30 }), /30 von 38 Teilen geprüft \(Sicherheitsgrenze\)/);
});
