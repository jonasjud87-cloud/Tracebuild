import { test } from "node:test";
import assert from "node:assert/strict";
import type { DocumentSyncResponse, ParcelCandidate } from "../lib/geoadmin/contract";
import { autoPartsWarning, buildReportCsv, buildReportHtml } from "../lib/analysis-report";
import {
  candidateToFields,
  documentMetaParts,
  documentSummaryLine,
  extractStatusInfo,
  oerebReloadNote,
  rejectReasonLabel,
  documentNotices,
  safeExternalUrl,
  authoritativeErrorText,
  similarityPercent,
  nextActiveIndex,
  parcelHitToFields,
  parcelQueryFor,
  rejectedForViewer,
  runDocumentSync,
  sortCandidates,
  summarizeDocuments,
  visibleDocuments,
  zoneNeedsAttention,
  zoneOriginLabel,
} from "./geoportal-logic";

const candidate = (over: Partial<ParcelCandidate> = {}): ParcelCandidate => ({
  egrid: "CH507759798797", number: "C0716", municipality: "St. Gallen", bfs: 3203, canton: "SG",
  e: 2746000, n: 1254000, type: "Liegenschaft", oereb_pdf_url: null, ...over,
});

const response = (over: Partial<DocumentSyncResponse>): DocumentSyncResponse => ({
  available: true, processed: null, in_progress: false, remaining: 0, ...over,
});

function scripted(answers: (DocumentSyncResponse | Error)[]) {
  let calls = 0;
  return {
    post: async () => {
      const a = answers[calls++];
      if (a instanceof Error) throw a;
      return a;
    },
    calls: () => calls,
  };
}

const noSleep = async () => {};

test("Parzellentreffer fragt mit EGRID und Koordinaten, Adresse nur mit Koordinaten", () => {
  assert.equal(parcelQueryFor({ egrid: "CH1", e: 2, n: 3 }), "egrid=CH1&e=2&n=3");
  assert.equal(parcelQueryFor({ egrid: null, e: 2, n: 3 }), "e=2&n=3");
});

test("Kandidat liefert die verbindlichen Felder, Koordinaten notfalls vom Treffer", () => {
  const fields = candidateToFields(candidate({ e: null, n: null }), { e: 1, n: 2 });
  assert.equal(fields.municipality, "St. Gallen");
  assert.deepEqual(fields.identity, { egrid: "CH507759798797", lv95_e: 1, lv95_n: 2, bfs_number: 3203 });
  assert.equal(candidateToFields(candidate({ e: null, n: null })).identity.lv95_e, undefined);
});

test("Rückfall übernimmt die Gemeinde der Suche nicht und gilt nur für Parzellentreffer", () => {
  const hit = {
    id: "1", kind: "parcel" as const, label: "x", e: 1, n: 2, egrid: "CH507759798797",
    number: "C0716", municipality: "Saint-Gall", bfs: 3203, canton: null,
  };
  assert.equal(parcelHitToFields(hit)?.municipality, null);
  assert.equal(parcelHitToFields(hit)?.parcelNumber, "C0716");
  assert.equal(parcelHitToFields({ ...hit, kind: "address", egrid: null }), null);
});

test("Liegenschaften stehen vor Baurechten, sonst bleibt die Reihenfolge", () => {
  const sorted = sortCandidates([
    candidate({ egrid: "A", type: "Baurecht" }),
    candidate({ egrid: "B" }),
    candidate({ egrid: "C", type: null }),
  ]);
  assert.deepEqual(sorted.map((c) => c.egrid), ["B", "A", "C"]);
});

test("Pfeiltasten laufen im Kreis", () => {
  assert.equal(nextActiveIndex(-1, 3, "ArrowDown"), 0);
  assert.equal(nextActiveIndex(2, 3, "ArrowDown"), 0);
  assert.equal(nextActiveIndex(0, 3, "ArrowUp"), 2);
  assert.equal(nextActiveIndex(-1, 3, "ArrowUp"), 2);
  assert.equal(nextActiveIndex(1, 3, "End"), 2);
  assert.equal(nextActiveIndex(1, 0, "ArrowDown"), -1);
});

test("Sync läuft seriell bis remaining 0 und zählt die Ergebnisse", async () => {
  const s = scripted([
    response({ processed: { id: "1", title: "A", outcome: "imported" }, remaining: 2 }),
    response({ processed: { id: "2", title: "B", outcome: "rejected" }, remaining: 1 }),
    response({ processed: { id: "3", title: "C", outcome: "imported" }, remaining: 0 }),
  ]);
  const seen: string[] = [];
  const result = await runDocumentSync({
    post: s.post, signal: new AbortController().signal, initialPending: 3,
    onProgress: (p) => seen.push(`${p.processed}/${p.total}`),
  });
  assert.equal(result.end, "done");
  assert.deepEqual(seen, ["1/3", "2/3", "3/3"]);
  assert.deepEqual(result.progress.outcomes, { imported: 2, rejected: 1 });
  assert.equal(s.calls(), 3);
});

test("Fehler beendet den Lauf, ohne zu werfen", async () => {
  const s = scripted([
    response({ processed: { id: "1", title: "A", outcome: "imported" }, remaining: 1 }),
    new Error("HTTP 500"),
  ]);
  const result = await runDocumentSync({ post: s.post, signal: new AbortController().signal });
  assert.equal(result.end, "error");
  assert.equal(result.error, "HTTP 500");
  assert.equal(result.progress.processed, 1);
});

test("in_progress wartet höchstens sechsmal", async () => {
  const s = scripted(Array.from({ length: 10 }, () => response({ in_progress: true, remaining: 1 })));
  const waits: number[] = [];
  const result = await runDocumentSync({
    post: s.post, signal: new AbortController().signal,
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(result.end, "busy");
  assert.equal(s.calls(), 7);
  assert.deepEqual(waits, Array(6).fill(5_000));
});

test("Ein Erfolg setzt den Wartezähler zurück", async () => {
  const answers: DocumentSyncResponse[] = [];
  for (let i = 0; i < 6; i++) answers.push(response({ in_progress: true, remaining: 2 }));
  answers.push(response({ processed: { id: "1", title: "A", outcome: "unchanged" }, remaining: 1 }));
  for (let i = 0; i < 6; i++) answers.push(response({ in_progress: true, remaining: 1 }));
  answers.push(response({ processed: { id: "2", title: "B", outcome: "unchanged" }, remaining: 0 }));
  const s = scripted(answers);
  const result = await runDocumentSync({ post: s.post, signal: new AbortController().signal, sleep: noSleep });
  assert.equal(result.end, "done");
});

test("Offen, aber nichts zu holen: kein Kreisen", async () => {
  const s = scripted([response({ remaining: 2 })]);
  const result = await runDocumentSync({ post: s.post, signal: new AbortController().signal });
  assert.equal(result.end, "stalled");
  assert.equal(s.calls(), 1);
});

test("Fehlende Tabellen melden unavailable", async () => {
  const s = scripted([response({ available: false })]);
  const result = await runDocumentSync({ post: s.post, signal: new AbortController().signal });
  assert.equal(result.end, "unavailable");
});

test("Abbruch stoppt die Schleife, auch wenn der Request deswegen wirft", async () => {
  const controller = new AbortController();
  const result = await runDocumentSync({
    post: async () => { controller.abort(); throw new DOMException("Abgebrochen", "AbortError"); },
    signal: controller.signal,
  });
  assert.equal(result.end, "aborted");
  assert.equal(result.error, null);

  const already = new AbortController();
  already.abort();
  const s = scripted([]);
  assert.equal((await runDocumentSync({ post: s.post, signal: already.signal })).end, "aborted");
  assert.equal(s.calls(), 0);
});

test("maxRequests begrenzt eine Antwort, deren remaining nie sinkt", async () => {
  let calls = 0;
  const result = await runDocumentSync({
    post: async () => { calls++; return response({ processed: { id: "1", title: "A", outcome: "failed" }, remaining: 5 }); },
    signal: new AbortController().signal, maxRequests: 4,
  });
  assert.equal(result.end, "stalled");
  assert.equal(calls, 4);
});

test("Zusammenfassung trennt Scans von Filtergründen", () => {
  const summary = summarizeDocuments([
    { status: "imported", reject_reason: null },
    { status: "rejected", reject_reason: "title_negative" },
    { status: "rejected", reject_reason: "title_negative" },
    { status: "rejected", reject_reason: "scan_or_short" },
    { status: "failed", reject_reason: null },
    { status: "pending", reject_reason: null },
  ]);
  assert.equal(summary.filtered, 2);
  assert.equal(summary.scans, 1);
  assert.equal(
    documentSummaryLine(summary, { showFiltered: true }),
    "1 importiert · 2 herausgefiltert (2 × Titel deutet auf Plan, Bericht oder Entscheid) · 1 Scan ohne lesbaren Text · 1 mit Fehler · 1 noch offen",
  );
});

test("Filtergründe erscheinen nie als Rohwert", () => {
  for (const reason of ["kept_old", "duplicate_content", "decision_document", "too_many_redirects", "not_in_force", "superseded", "cap_reached", "private_address", "gibt_es_noch_nicht"]) {
    assert.doesNotMatch(rejectReasonLabel(reason), /_/, reason);
  }
  assert.equal(rejectReasonLabel("gibt_es_noch_nicht"), "anderer Filtergrund");
  assert.equal(rejectReasonLabel(null), "ohne Angabe");
});

test("fetched false: Mindestabstand, fehlende Parzelle und Fehler werden unterschieden", () => {
  const now = Date.parse("2026-11-05T10:00:30Z");
  const recent = { last_attempt_at: "2026-11-05T10:00:10Z", status: "ok" as const };
  const old = { last_attempt_at: "2026-11-05T09:00:00Z", status: "ok" as const, last_error: "HTTP 503" };
  assert.match(oerebReloadNote({ fetched: false, extract: recent }, true, now) ?? "", /weniger als 30 Sekunden/);
  assert.match(oerebReloadNote({ fetched: false, extract: old }, true, now) ?? "", /nicht abgerufen werden: HTTP 503/);
  assert.match(oerebReloadNote({ fetched: false, extract: null }, true, now) ?? "", /nicht abgerufen werden\./);
  assert.match(oerebReloadNote({ fetched: false, extract: recent }, false, now) ?? "", /fehlt eine Parzelle/);
  assert.match(oerebReloadNote({ fetched: false, extract: recent, used_stale: true, stale_fetched_at: "2026-10-01T10:00:00Z" }, true, now) ?? "", /schlug fehl, es gilt weiter der Stand vom 01\.10\.2026/);
  assert.match(oerebReloadNote({ fetched: true, used_stale: true }, true, now) ?? "", /Aktualisierung fehlgeschlagen/);
  assert.equal(oerebReloadNote({ fetched: true }, true, now), null);
});

test("Ausgelassene Reglementteile stehen in Warnung, PDF und CSV", () => {
  const autoParts = { total: 30, run: 24, skipped: 6, skipped_titles: ["Baureglement <Herisau>"] };
  const meta = { projectName: "P", canton: "AR", municipality: "Herisau", parcel: null, bauzone: null, planType: "Baugesuch", version: 1, createdAt: "2026-11-05T10:00:00Z", autoParts };
  assert.equal(
    autoPartsWarning(autoParts),
    "Vom Reglement wurden 24 von 30 Teilen geprüft, der Rest ist in dieser Analyse nicht berücksichtigt. Betroffen: Baureglement <Herisau>.",
  );
  assert.equal(autoPartsWarning({ total: 3, run: 3, skipped: 0, skipped_titles: [] }), "");
  assert.equal(autoPartsWarning(null), "");
  const html = buildReportHtml(meta, []);
  assert.match(html, /24 von 30 Teilen/);
  assert.match(html, /Baureglement &lt;Herisau&gt;/);
  assert.match(buildReportCsv(meta, []), /Unvollständig geprüft;.*24 von 30 Teilen/);
  assert.doesNotMatch(buildReportHtml({ ...meta, autoParts: null }, []), /Unvollständig/);
  assert.doesNotMatch(buildReportCsv({ ...meta, autoParts: null }, []), /Unvollständig/);
});

test("Jeder Status hat einen Text, BS und NE einen eigenen", () => {
  const all = ["ok", "no_egrid", "ambiguous", "unreachable", "parse_error", "no_cadastre", "access_restricted"] as const;
  for (const status of all) assert.ok(extractStatusInfo(status, "ZH").text.length > 0, status);
  assert.match(extractStatusInfo("unreachable", "BS").title, /Basel-Stadt/);
  assert.match(extractStatusInfo("access_restricted", "NE").title, /Neuenburg/);
  assert.equal(extractStatusInfo("access_restricted", "NE").offerPdf, true);
  assert.equal(extractStatusInfo("ambiguous", "SH").choose, true);
});

test("Bauzone: fehlend und low brauchen Aufmerksamkeit, manuell nicht", () => {
  assert.equal(zoneNeedsAttention({ bauzone: null }), true);
  assert.equal(zoneNeedsAttention({ bauzone: "W2", zone_source: "oereb", zone_confidence: "low" }), true);
  assert.equal(zoneNeedsAttention({ bauzone: "W2", zone_source: "oereb", zone_confidence: "exact" }), false);
  assert.equal(zoneNeedsAttention({ bauzone: "W2", zone_source: "manual", zone_confidence: "low" }), false);
  assert.equal(zoneOriginLabel({ bauzone: "W2", zone_source: "oereb", zone_confidence: "low" }), "unsicher, bitte prüfen");
});

test("Hinweise: Scan ohne Norm, Ablehnungen je Grund, beide Fassungen", () => {
  const notices = documentNotices([
    { status: "rejected", reject_reason: "scan_or_short", norm_id: null, version_note: null },
    { status: "rejected", reject_reason: "scan_or_short", norm_id: "n1", version_note: null },
    { status: "rejected", reject_reason: "older_version", norm_id: null, version_note: null },
    { status: "rejected", reject_reason: "older_version", norm_id: null, version_note: null },
    { status: "rejected", reject_reason: "decision_document", norm_id: null, version_note: null },
    { status: "imported", reject_reason: null, norm_id: "n2", version_note: "Mögliche weitere Fassung, beide übernommen" },
  ]);
  assert.equal(notices.scans.length, 1);
  assert.deepEqual(notices.rejected.map((g) => [g.reason, g.items.length]), [["decision_document", 1]]);
  assert.deepEqual(notices.skipped.map((g) => [g.category, g.items.length]), [["older_version", 2]]);
  assert.doesNotMatch(notices.rejected.map((g) => g.label).join(), /_/);
  assert.equal(notices.bothKept.length, 1);
});

test("Hinweise: bewusst ausgelassene getrennt von echten Ablehnungen", () => {
  const item = (reject_reason: string, kind: string | null, reject_detail: string | null = null) =>
    ({ status: "rejected" as const, reject_reason, kind, reject_detail, norm_id: null, version_note: null });
  const notices = documentNotices([
    item("doc_type", "Law", "Dokumentart Law wird nicht importiert"),
    item("doc_type", "Law"),
    item("doc_type", "LegalProvision", "Dokumentart LegalProvision wird nicht importiert"),
    item("title_negative", "LegalProvision", "Titel enthält «=zonenplan»"),
    item("no_articles", "LegalProvision"),
    item("unbekannter_grund", "LegalProvision"),
    { status: "duplicate_manual" as const, reject_reason: null, kind: "LegalProvision", norm_id: null, version_note: null },
  ]);
  assert.deepEqual(notices.skipped.map((g) => [g.category, g.items.length]), [["superior_law", 2], ["canton_stopped", 1], ["plan", 1]]);
  assert.deepEqual(notices.rejected.map((g) => [g.reason, g.items.length]), [["no_articles", 1], ["unbekannter_grund", 1]]);
  assert.doesNotMatch(notices.skipped.map((g) => g.label).join(), /_/);
});

test("Externe Links nur über http und https", () => {
  assert.equal(safeExternalUrl("https://oerebdocs.zh.ch/a.pdf"), "https://oerebdocs.zh.ch/a.pdf");
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("kein link"), null);
  assert.equal(safeExternalUrl(null), null);
});

test("Fehler beim Festlegen sind je Antwort verständlich", () => {
  const texts = [400, 404, 409, 500, undefined].map(authoritativeErrorText);
  assert.equal(new Set(texts).size, 4);
  assert.match(authoritativeErrorText(409), /Gemeinde-Normen/);
});

test("Ähnlichkeit als ganze Prozent, Unsinn ohne Angabe", () => {
  assert.equal(similarityPercent(0.873), 87);
  assert.equal(similarityPercent(null), null);
  assert.equal(similarityPercent(1.4), null);
});

test("review: eigene Zeile, nicht unter herausgefiltert, und eigener Hinweis", () => {
  const items = [
    { status: "review" as const, reject_reason: "no_articles", norm_id: null, version_note: null },
    { status: "imported" as const, reject_reason: null, norm_id: "n", version_note: null },
  ];
  const summary = summarizeDocuments(items);
  assert.equal(summary.review, 1);
  assert.equal(summary.filtered, 0);
  assert.match(documentSummaryLine(summary, { showFiltered: true }), /1 zur Prüfung vorgemerkt/);
  assert.equal(documentNotices(items).review.length, 1);
  assert.equal(documentNotices(items).rejected.length, 0);
});

test("Hinweise: Sicherheits- und Inhaltsgründe bleiben echte Ablehnungen, Summe vollständig", () => {
  const item = (reject_reason: string, kind: string | null = "LegalProvision", extra: Record<string, unknown> = {}) =>
    ({ status: "rejected" as const, reject_reason, kind, reject_detail: null, norm_id: null, version_note: null, ...extra });
  const items = [
    item("host_not_allowed"), item("private_address"), item("too_many_redirects"), item("kept_old"), item("cap_reached"),
    item("decision_document"), item("doc_type", "Law"), item("older_version"), item("duplicate_content"),
    item("no_articles", "LegalProvision", { manual_decision: "exclude" }),
    item("scan_or_short"),
  ];
  const notices = documentNotices(items);
  const rejectedReasons = notices.rejected.map((g) => g.reason);
  for (const r of ["host_not_allowed", "private_address", "too_many_redirects", "kept_old", "cap_reached", "decision_document"]) {
    assert.ok(rejectedReasons.includes(r), r);
  }
  const counted = notices.rejected.reduce((n, g) => n + g.items.length, 0) + notices.skipped.reduce((n, g) => n + g.items.length, 0) + notices.scans.length;
  assert.equal(counted, items.length);
  assert.deepEqual(notices.skipped.map((g) => g.category), ["superior_law", "older_version", "manual_exclude", "filter_rule"]);
});

test("Hinweise: leere Liste und nur importierte ergeben keine Gruppen", () => {
  assert.deepEqual(documentNotices([]).skipped, []);
  const notices = documentNotices([{ status: "imported" as const, reject_reason: null, norm_id: "n", version_note: null }]);
  assert.equal(notices.rejected.length + notices.skipped.length, 0);
});

test("Endnutzer: bewusst ausgelassene Dokumente und Filterzeile ausgeblendet, Admins sehen alles", () => {
  const item = (status: "rejected" | "imported" | "duplicate_manual", reject_reason: string | null, kind: string | null) =>
    ({ status, reject_reason, kind, reject_detail: null, norm_id: null, version_note: null });
  const items = [
    item("imported", null, "LegalProvision"),
    item("duplicate_manual", null, "LegalProvision"),
    item("rejected", "doc_type", "Law"),
    item("rejected", "title_negative", "LegalProvision"),
    item("rejected", "no_articles", "LegalProvision"),
    item("rejected", "scan_or_short", "LegalProvision"),
  ];
  const user = visibleDocuments(items, false);
  // Übergeordnetes Recht und Plan weg; echte Ablehnung und Scan bleiben sichtbar.
  assert.deepEqual(user.map((i) => i.reject_reason), [null, null, "no_articles", "scan_or_short"]);
  assert.equal(visibleDocuments(items, true).length, items.length);

  const line = documentSummaryLine(summarizeDocuments(user), { showFiltered: false });
  assert.equal(line, "1 importiert · 1 bereits von Hand erfasst · 1 abgelehnt, bitte prüfen · 1 Scan ohne lesbaren Text");
  assert.doesNotMatch(line, /herausgefiltert/);
  assert.match(documentSummaryLine(summarizeDocuments(items), { showFiltered: true }), /3 herausgefiltert/);
});

// ── Sichtbarkeit für Endnutzer (fix/oereb-hinweis-entfernen) ────────────────

type VisItem = {
  status: "rejected" | "imported" | "duplicate_manual" | "removed" | "review" | "failed" | "pending";
  reject_reason: string | null; kind: string | null; reject_detail: string | null;
  manual_decision: string | null; norm_id: string | null; version_note: string | null;
};
const vis = (over: Partial<VisItem> = {}): VisItem => ({
  status: "rejected", reject_reason: null, kind: "LegalProvision", reject_detail: null,
  manual_decision: null, norm_id: null, version_note: null, ...over,
});

test("Endnutzer: jede bewusst ausgelassene Kategorie ist ausgeblendet", () => {
  const skipped = [
    vis({ reject_reason: "doc_type", kind: "Law" }),
    vis({ reject_reason: "doc_type", kind: "LegalProvision" }), // Kanton ohne Freigabe
    vis({ reject_reason: "doc_type", kind: "Hint" }),
    vis({ reject_reason: "authority" }),
    vis({ reject_reason: "title_negative", reject_detail: "Titel enthält «Zonenplan»" }),
    vis({ reject_reason: "title_negative", reject_detail: "Titel enthält «Genehmigung»" }),
    vis({ reject_reason: "title_negative" }),
    vis({ reject_reason: "older_version" }),
    vis({ reject_reason: "superseded" }),
    vis({ reject_reason: "title_exact" }),
    vis({ reject_reason: "not_in_force" }),
    vis({ reject_reason: "duplicate_content" }),
    vis({ reject_reason: "manual_exclude" }),
    vis({ reject_reason: "no_articles", manual_decision: "exclude" }),
  ];
  assert.deepEqual(visibleDocuments(skipped, false), []);
  assert.equal(visibleDocuments(skipped, true).length, skipped.length);
  // Nach dem Filter bleibt für Endnutzer kein Kasten «bewusst ausgelassen».
  assert.deepEqual(documentNotices(visibleDocuments(skipped, false)).skipped, []);
});

test("Endnutzer: echte Ablehnungen, Scans, review, Fehler und Offene bleiben sichtbar", () => {
  const kept = [
    vis({ reject_reason: "scan_or_short" }),
    vis({ reject_reason: "scan_or_short", manual_decision: "exclude" }),
    vis({ reject_reason: "no_articles" }),
    vis({ reject_reason: "decision_document" }),
    vis({ reject_reason: "host_not_allowed" }),
    vis({ reject_reason: "ganz_neuer_grund" }),
    vis({ reject_reason: null }),
    vis({ reject_reason: "doc_type", kind: null }),
    vis({ reject_reason: "doc_type", kind: "Unbekannt" }),
    vis({ status: "review", reject_reason: "no_articles" }),
    vis({ status: "failed" }),
    vis({ status: "pending" }),
    vis({ status: "imported", norm_id: "n" }),
    vis({ status: "imported", norm_id: "n", version_note: "beide Fassungen" }),
  ];
  assert.equal(visibleDocuments(kept, false).length, kept.length);
  const notices = documentNotices(visibleDocuments(kept, false));
  assert.equal(notices.scans.length, 2);
  assert.equal(notices.review.length, 1);
  assert.equal(notices.bothKept.length, 1);
  assert.equal(notices.rejected.reduce((s, g) => s + g.items.length, 0), 7);
});

test("Endnutzer: leere Liste und Reihenfolge bleiben erhalten, Eingabe unverändert", () => {
  assert.deepEqual(visibleDocuments([], false), []);
  assert.deepEqual(visibleDocuments([], true), []);
  const items = [vis({ reject_reason: "no_articles" }), vis({ reject_reason: "doc_type", kind: "Law" }), vis({ status: "imported" })];
  const shown = visibleDocuments(items, false);
  assert.deepEqual(shown, [items[0], items[2]]);
  assert.equal(items.length, 3);
});

test("Endnutzer: Zeile ohne «herausgefiltert» und ohne Filtergründe, auch bei nur Ausgelassenen", () => {
  const items = [vis({ reject_reason: "doc_type", kind: "Law" }), vis({ reject_reason: "older_version" })];
  const shown = visibleDocuments(items, false);
  assert.equal(documentSummaryLine(summarizeDocuments(shown), { showFiltered: false }), "");
  // Selbst ohne Vorfilter: showFiltered false nennt keine Filtergründe.
  const line = documentSummaryLine(summarizeDocuments(items), { showFiltered: false });
  assert.doesNotMatch(line, /herausgefiltert|Gesetz|ältere Fassung/);
  // Admins: Standard bleibt sichtbar.
  assert.doesNotMatch(documentSummaryLine(summarizeDocuments(items)), /herausgefiltert/);
  assert.match(documentSummaryLine(summarizeDocuments(items), { showFiltered: true }), /2 herausgefiltert/);
});

test("Endnutzer: echte Ablehnung zählt in der Statuszeile mit", () => {
  const shown = visibleDocuments([vis({ status: "imported" }), vis({ reject_reason: "no_articles" })], false);
  const line = documentSummaryLine(summarizeDocuments(shown), { showFiltered: false });
  assert.match(line, /abgelehnt|prüfen/);
});

test("Endnutzer: vom Admin entfernte Dokumente ausgeblendet, Admins sehen sie", () => {
  const removed = { status: "removed" as const, reject_reason: null, kind: "LegalProvision", reject_detail: null, norm_id: null, version_note: null };
  const kept = { ...removed, status: "duplicate_manual" as const };
  assert.deepEqual(visibleDocuments([removed, kept], false), [kept]);
  assert.equal(visibleDocuments([removed, kept], true).length, 2);
});

// ── Ablehnungsgründe nur für Plattform-Admins (Gesamt-QG) ────────────────────

const meta = (over: Partial<Parameters<typeof documentMetaParts>[0]> = {}): Parameters<typeof documentMetaParts>[0] => ({
  status: "rejected", reject_reason: "no_articles", reject_detail: "0 Artikel auf 12 Seiten", scope: "municipal",
  last_update_status: null, version_note: null, ...over,
});

test("Dokumentliste: Admins sehen Grund und Detail", () => {
  const parts = documentMetaParts(meta(), true, "01.02.2026");
  assert.deepEqual(parts, ["Grund: keine Artikel erkannt", "0 Artikel auf 12 Seiten", "gilt für die Gemeinde", "Stand 01.02.2026"]);
  assert.equal(documentMetaParts(meta({ status: "review" }), true, null)[0], "Grund: keine Artikel erkannt");
});

test("Dokumentliste: Endnutzer ohne Grund und ohne Detail, übrige Angaben bleiben", () => {
  for (const status of ["rejected", "review", "failed", "pending"] as const) {
    const parts = documentMetaParts(meta({ status }), false, "01.02.2026");
    assert.ok(!parts.some((x) => x.startsWith("Grund:") || x.includes("Artikel auf")), `${status}: ${parts.join(" · ")}`);
    assert.deepEqual(parts, ["gilt für die Gemeinde", "Stand 01.02.2026"]);
  }
  assert.deepEqual(
    documentMetaParts(meta({ status: "imported", scope: "parcel", last_update_status: "fetch_failed", version_note: "beide Fassungen" }), false, null),
    ["gilt nur für dieses Grundstück", "beide Fassungen", "letzte Prüfung fehlgeschlagen, bisheriger Stand bleibt"],
  );
});

test("Dokumentliste: importiert ohne Detail, auch für Admins", () => {
  assert.deepEqual(documentMetaParts(meta({ status: "imported", scope: null }), true, null), []);
});

test("Kasten abgelehnt: Admins je Grund, Endnutzer eine Gruppe ohne Grund", () => {
  const items = [vis({ reject_reason: "no_articles" }), vis({ reject_reason: "host_not_allowed" }), vis({ reject_reason: "no_articles" })];
  const groups = documentNotices(items).rejected;
  assert.equal(groups.length, 2);
  assert.deepEqual(rejectedForViewer(groups, true), groups);
  const user = rejectedForViewer(groups, false);
  assert.equal(user.length, 1);
  assert.equal(user[0].label, null);
  assert.equal(user[0].items.length, 3);
  assert.deepEqual(rejectedForViewer([], false), []);
  assert.deepEqual(rejectedForViewer([], true), []);
});
