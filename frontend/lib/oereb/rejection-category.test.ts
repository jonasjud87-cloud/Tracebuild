import { test } from "node:test";
import assert from "node:assert/strict";

import { CATEGORY_INFO, categorizeDocument, categoryGroup, countCategories, type CategorizableDocument } from "./rejection-category";

const rejected = (reason: string | null, extra: Partial<CategorizableDocument> = {}): CategorizableDocument => ({
  status: "rejected", reject_reason: reason, doc_type: "LegalProvision", reject_detail: null, ...extra,
});
const RELEASED = { cantonReleased: true };
const STOPPED = { cantonReleased: false };

test("Gesetz per doc_type: übergeordnetes Recht, im freigegebenen wie im gestoppten Kanton", () => {
  const law = rejected("doc_type", { doc_type: "Law", reject_detail: "Dokumentart Law wird nicht importiert" });
  assert.equal(categorizeDocument(law, RELEASED), "superior_law");
  assert.equal(categorizeDocument(law, STOPPED), "superior_law");
  assert.equal(categorizeDocument(law), "superior_law");
  assert.equal(categoryGroup("superior_law"), "skipped");
});

test("Bundesrecht per Behörde: übergeordnetes Recht", () => {
  assert.equal(categorizeDocument(rejected("authority"), RELEASED), "superior_law");
});

test("Kanton gestoppt: LegalProvision per doc_type ist nicht freigegeben", () => {
  const lp = rejected("doc_type", { reject_detail: "Dokumentart LegalProvision wird nicht importiert" });
  assert.equal(categorizeDocument(lp, STOPPED), "canton_stopped");
  assert.equal(categorizeDocument(rejected("doc_type", { doc_type: "Hint" }), STOPPED), "canton_stopped");
  assert.equal(categoryGroup("canton_stopped"), "skipped");
});

test("Kanton freigegeben: LegalProvision per doc_type abgelehnt ist zu prüfen", () => {
  assert.equal(categorizeDocument(rejected("doc_type"), RELEASED), "check");
});

test("Freigabe unbekannt: LegalProvision per doc_type gilt als Stopp", () => {
  assert.equal(categorizeDocument(rejected("doc_type")), "canton_stopped");
});

test("Hinweis per doc_type im freigegebenen Kanton: Filterregel, ohne Dokumentart zu prüfen", () => {
  assert.equal(categorizeDocument(rejected("doc_type", { doc_type: "Hint" }), RELEASED), "filter_rule");
  assert.equal(categorizeDocument(rejected("doc_type", { doc_type: null }), RELEASED), "check");
});

test("Titel mit Plan-Begriff: Plan, kein Normtext; Entscheid und Bericht getrennt", () => {
  assert.equal(categorizeDocument(rejected("title_negative", { reject_detail: "Titel enthält «=zonenplan»" }), RELEASED), "plan");
  assert.equal(categorizeDocument(rejected("title_negative", { reject_detail: "Titel enthält «paz»" }), RELEASED), "plan");
  assert.equal(categorizeDocument(rejected("title_negative", { reject_detail: "Titel enthält «karte»" }), RELEASED), "plan");
  assert.equal(categorizeDocument(rejected("title_negative", { reject_detail: "Titel enthält «rrb»" }), RELEASED), "decision_report");
  assert.equal(categorizeDocument(rejected("title_negative", { reject_detail: "Titel enthält «dsi-»" }), RELEASED), "filter_rule");
  assert.equal(categorizeDocument(rejected("title_negative"), RELEASED), "filter_rule");
});

test("Ältere Fassung, abgelöst, manuell ausgeschlossen", () => {
  assert.equal(categorizeDocument(rejected("older_version", { reject_detail: "Ältere Fassung von X" })), "older_version");
  assert.equal(categorizeDocument(rejected("superseded")), "older_version");
  assert.equal(categorizeDocument(rejected("manual_exclude")), "manual_exclude");
  assert.equal(categorizeDocument(rejected("no_articles", { manual_decision: "exclude" })), "manual_exclude");
});

test("Status imported, duplicate_manual, pending, removed", () => {
  assert.equal(categorizeDocument({ status: "imported", reject_reason: null, doc_type: "LegalProvision" }), "imported");
  assert.equal(categorizeDocument({ status: "duplicate_manual", reject_reason: null, doc_type: "LegalProvision" }), "manual_duplicate");
  assert.equal(categorizeDocument({ status: "pending", reject_reason: null, doc_type: "LegalProvision" }), "open");
  assert.equal(categorizeDocument({ status: "removed", reject_reason: null, doc_type: "LegalProvision" }), "removed");
  assert.equal(categoryGroup("manual_duplicate"), "skipped");
});

test("Echte Ablehnungen und Fehler sind zu prüfen", () => {
  for (const reason of ["no_articles", "too_large", "not_pdf", "host_not_allowed", "private_address", "pdf_unreadable", "scan_or_short", "cap_reached", "kept_old", "decision_document"]) {
    assert.equal(categorizeDocument(rejected(reason), RELEASED), "check", reason);
  }
  assert.equal(categorizeDocument({ status: "failed", reject_reason: null, doc_type: "LegalProvision" }), "check");
  assert.equal(categorizeDocument({ status: "review", reject_reason: "no_articles", doc_type: "LegalProvision" }), "check");
});

test("Unbekannter Grund oder Status: zu prüfen", () => {
  assert.equal(categorizeDocument(rejected("ganz_neu"), RELEASED), "check");
  assert.equal(categorizeDocument(rejected(null), RELEASED), "check");
  assert.equal(categorizeDocument({ status: "seltsam", reject_reason: null, doc_type: null }), "check");
  assert.equal(categoryGroup("check"), "check");
});

test("Zählung in fester Reihenfolge, nur vorkommende, Beschriftung ohne Rohwerte", () => {
  const counts = countCategories([
    rejected("doc_type", { doc_type: "Law" }),
    rejected("doc_type", { doc_type: "Law" }),
    rejected("no_articles"),
    { status: "imported", reject_reason: null, doc_type: "LegalProvision" },
  ], RELEASED);
  assert.deepEqual(counts.map((c) => [c.category, c.count, c.group]), [
    ["check", 1, "check"], ["imported", 1, "imported"], ["superior_law", 2, "skipped"],
  ]);
  for (const info of Object.values(CATEGORY_INFO)) assert.doesNotMatch(info.label, /_/);
});

// ── Ergänzt durch Review: reale Kombinationen, Vollständigkeit, Kopplung an import-filter ──

test("Produktion: reale Kombinationen", () => {
  const ar = { cantonReleased: false };
  const cases: [CategorizableDocument, typeof RELEASED | typeof ar, string][] = [
    [rejected("doc_type", { doc_type: "Law", reject_detail: "Dokumentart Law wird nicht importiert" }), RELEASED, "superior_law"],
    [rejected("doc_type", { doc_type: "LegalProvision", reject_detail: "Dokumentart LegalProvision wird nicht importiert" }), ar, "canton_stopped"],
    [rejected("title_negative", { reject_detail: "Titel enthält «=zonenplan»" }), RELEASED, "plan"],
    [rejected("older_version", { reject_detail: "Ältere Fassung" }), RELEASED, "older_version"],
    [{ status: "duplicate_manual", reject_reason: null, doc_type: "LegalProvision" }, RELEASED, "manual_duplicate"],
    [{ status: "imported", reject_reason: null, doc_type: "LegalProvision" }, RELEASED, "imported"],
  ];
  for (const [doc, ctx, expected] of cases) assert.equal(categorizeDocument(doc, ctx), expected, JSON.stringify(doc));
});

test("Sicherheits- und Abrufgründe sind nie bewusst ausgelassen, in jedem Kontext", async () => {
  const { FORCE_BLOCKING_REASONS } = await import("./manual-decision");
  const reasons = [
    ...Array.from(FORCE_BLOCKING_REASONS),
    "host_not_allowed", "private_address", "too_large", "not_pdf", "too_many_redirects", // FetchRejectReason
    "scan_or_short", "decision_document", "no_articles", "too_long", // ContentReason
    "kept_old", "cap_reached", "foreign_place", "pdf_unreadable",
  ];
  for (const reason of reasons) {
    for (const ctx of [RELEASED, STOPPED, { cantonReleased: null }]) {
      for (const doc_type of ["Law", "LegalProvision", "Hint", null]) {
        const c = categorizeDocument(rejected(reason, { doc_type }), ctx);
        assert.equal(categoryGroup(c), "check", `${reason}/${doc_type}/${ctx.cantonReleased}`);
      }
    }
  }
});

test("Jeder Vor-Download-Grund ist eingeteilt; nur host_not_allowed ist zu prüfen", async () => {
  const { PRE_DOWNLOAD_REASONS } = await import("./import-filter");
  for (const reason of Array.from(PRE_DOWNLOAD_REASONS)) {
    const c = categorizeDocument(rejected(reason, { doc_type: "Law" }), RELEASED);
    if (reason === "host_not_allowed") assert.equal(c, "check");
    else assert.equal(categoryGroup(c), "skipped", reason);
  }
});

test("Jeder Status der Admin-Route ist eingeteilt; failed und review zu prüfen", () => {
  const expected: Record<string, string> = {
    pending: "open", imported: "imported", rejected: "check", failed: "check", duplicate_manual: "manual_duplicate", removed: "removed", review: "check",
  };
  for (const [status, category] of Object.entries(expected)) {
    assert.equal(categorizeDocument({ status, reject_reason: null, doc_type: "LegalProvision" }, RELEASED), category, status);
  }
});

test("Titel-Ausschluss mit echtem reject_detail aus decidePreDownload: nie zu prüfen, Pläne erkannt", async () => {
  const { DEFAULT_IMPORT_FILTER, decidePreDownload } = await import("./import-filter");
  const rules = { ...DEFAULT_IMPORT_FILTER, doc_types: ["LegalProvision"] };
  const doc = (title: string) => ({ title, doc_type: "LegalProvision", authority: "Gemeinde", url: "https://geo.zh.ch/a.pdf" });
  const zonenplan = decidePreDownload(doc("Zonenplan"), rules, "ZH");
  assert.equal(zonenplan?.reason, "title_negative");
  assert.equal(categorizeDocument(rejected("title_negative", { reject_detail: zonenplan?.detail }), RELEASED), "plan");
  for (const term of DEFAULT_IMPORT_FILTER.title_negative) {
    const c = categorizeDocument(rejected("title_negative", { reject_detail: `Titel enthält «${term}»` }), RELEASED);
    assert.equal(categoryGroup(c), "skipped", term);
  }
});

test("Format von reject_detail geändert: Titel-Ausschluss bleibt ausgelassen (nur andere Beschriftung)", () => {
  assert.equal(categorizeDocument(rejected("title_negative", { reject_detail: "Title contains 'zonenplan'" }), RELEASED), "filter_rule");
});

test("Manueller Ausschluss schlägt jeden Grund, auch Sicherheitsgründe", () => {
  assert.equal(categorizeDocument(rejected("host_not_allowed", { manual_decision: "exclude" }), RELEASED), "manual_exclude");
  assert.equal(categorizeDocument(rejected("doc_type", { manual_decision: "force_import" }), RELEASED), "check");
});

test("Zählung: Summe gleich Anzahl Dokumente, auch mit Unbekanntem", () => {
  const docs: CategorizableDocument[] = [
    rejected("doc_type", { doc_type: "Law" }), rejected("authority"), rejected("title_negative", { reject_detail: "Titel enthält «karte»" }),
    rejected("older_version"), rejected("superseded"), rejected("manual_exclude"), rejected("duplicate_content"),
    rejected("host_not_allowed"), rejected("ganz_neu"), rejected(null),
    { status: "imported", reject_reason: null, doc_type: "LegalProvision" }, { status: "pending", reject_reason: null, doc_type: null },
    { status: "seltsam", reject_reason: null, doc_type: null }, { status: "removed", reject_reason: null, doc_type: null },
  ];
  for (const ctx of [RELEASED, STOPPED, { cantonReleased: null }]) {
    const counts = countCategories(docs, ctx);
    assert.equal(counts.reduce((n, c) => n + c.count, 0), docs.length);
    assert.equal(new Set(counts.map((c) => c.category)).size, counts.length);
  }
  assert.deepEqual(countCategories([]), []);
});

test("Unbekannte Dokumentart per doc_type ist zu prüfen, Hint bleibt ausgelassen", () => {
  assert.equal(categorizeDocument(rejected("doc_type", { doc_type: "Hint" }), RELEASED), "filter_rule");
  assert.equal(categorizeDocument(rejected("doc_type", { doc_type: "Unbekannt" }), RELEASED), "check");
});
