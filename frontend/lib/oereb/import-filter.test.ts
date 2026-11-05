import { test } from "node:test";
import assert from "node:assert/strict";

import { collectCandidates, isDocumentDue, normalizeDocumentUrl, orderDueDocuments } from "./documents";
import {
  DEFAULT_IMPORT_FILTER as R,
  decideContent,
  decidePreDownload,
  documentPriority,
  isHostAllowed,
  matchesTerm,
  mergeFilterRules,
  resolveFilterRules,
  scopeOf,
  stableJson,
} from "./import-filter";
import { titleKey } from "./title-key";

const pre = (title: string, canton = "ZH", extra: Partial<{ doc_type: string | null; authority: string | null; url: string }> = {}) =>
  decidePreDownload({ title, doc_type: "LegalProvision", authority: "Gemeinde", url: `https://oereblex.${canton.toLowerCase()}.ch/1`, ...extra }, R, canton);

// ── Filter: Titel ────────────────────────────────────────────────────────────

test("positiv schlägt negativ: SZ Baureglement; Genehmigung", () => {
  assert.equal(pre("Baureglement; Genehmigung vom 13. Januar 2026", "SZ"), null);
  assert.equal(scopeOf("Baureglement; Genehmigung vom 13. Januar 2026", R), "municipal");
});

test("neutrale Titel gehen zum Inhaltstest und gelten nur für das Grundstück", () => {
  assert.equal(pre("Herisau", "AR"), null);
  assert.equal(scopeOf("Herisau", R), "parcel");
  assert.equal(pre("Zentrum (Stand 15.10.2024)", "BL"), null);
  assert.equal(scopeOf("Zentrum (Stand 15.10.2024)", R), "parcel");
});

test("negative Titel", () => {
  assert.equal(pre("Entscheid Nr. 126 vom 17. Februar 2026.pdf", "AI")?.reason, "title_negative");
  assert.equal(pre("RRB vom 29.01.2002", "BL")?.reason, "title_negative");
  assert.equal(pre("Totalrevision Erschliessungspläne Plan Nr. 11", "AG")?.reason, "title_negative");
  assert.equal(pre("Décision d'approbation", "FR")?.reason, "title_negative");
  assert.equal(pre("DSI-AAR008, Rathausgasse 1, Rathaus", "AG")?.reason, "title_negative");
  assert.equal(pre("Plan d’affectation des zones", "FR")?.reason, "title_negative");
});

test("Live-Korrekturen: AG-BNO ist positiv, kurze Begriffe nur als Wort", () => {
  assert.equal(scopeOf("Bau- und Nutzungsordnung", R), "municipal");
  assert.equal(pre("Regolamento spazio pubblico", "TI"), null);
  assert.equal(pre("Modification PAZ 29.01.1997", "FR")?.reason, "title_negative");
  assert.equal(matchesTerm("modification paz 1997", "paz"), true);
  assert.equal(matchesTerm("spazio", "paz"), false);
});

test("GE: Loi und Plan über die Datenzeile", () => {
  const rules = resolveFilterRules([{ scope: "GE", rules: { title_reject_exact_add: ["loi", "plan"] } }], "GE");
  const decide = (title: string) =>
    decidePreDownload({ title, doc_type: "LegalProvision", authority: null, url: "https://ge.ch/x" }, rules, "GE");
  assert.equal(decide("Loi")?.reason, "title_exact");
  assert.equal(decide("Plan")?.reason, "title_exact");
  assert.equal(decide("Règlement"), null);
});

test("Dokumentart und Behörde", () => {
  assert.equal(pre("Baugesetz", "VS", { doc_type: "Law" })?.reason, "doc_type");
  assert.equal(pre("Hinweis", "VS", { doc_type: "Hint" })?.reason, "doc_type");
  assert.equal(pre("Bauordnung", "ZH", { doc_type: null })?.reason, "doc_type");
  assert.equal(pre("Plan", "VS", { authority: "Bundesamt für Zivilluftfahrt" })?.reason, "authority");
  assert.equal(pre("Bauordnung", "AR", { authority: "Bundeskanzlei;Amt" })?.reason, "authority");
});

test("Reihenfolge: Haupterlass vor Änderung vor neutral (VS Sion, Deckel)", () => {
  assert.ok(documentPriority("Règlement communal des constructions et des zones de Sion", R) < documentPriority("Modification partielle du règlement communal", R));
  assert.ok(documentPriority("Modification du RCCZ", R) < documentPriority("Quartierplan", R));
  const ordered = orderDueDocuments(
    [
      { title: "Quartierplan", status: "pending" },
      { title: "Bauordnung", status: "imported" },
      { title: "Modification du RCCZ", status: "pending" },
      { title: "Baureglement", status: "pending" },
    ],
    R
  );
  assert.deepEqual(ordered.map((d) => d.title), ["Baureglement", "Modification du RCCZ", "Quartierplan", "Bauordnung"]);
});

// ── Filter: Merge ────────────────────────────────────────────────────────────

test("Merge: x ersetzt, x_add ergänzt, Kanton über default, Fehlerhaftes zählt nicht", () => {
  const merged = resolveFilterRules(
    [
      { scope: "default", rules: { min_text_chars: 100, title_negative_add: ["foo"], recheck_hours: "viel" } },
      { scope: "AG", rules: { min_text_chars: 200, doc_types: ["LegalProvision", "Hint"], article_pattern: "(" } },
      { scope: "ZH", rules: { min_text_chars: 999 } },
      { scope: "BE", rules: { min_text_chars: 1 }, active: false },
    ],
    "AG"
  );
  assert.equal(merged.min_text_chars, 200);
  assert.deepEqual(merged.doc_types, ["LegalProvision", "Hint"]);
  assert.ok(merged.title_negative.includes("foo"));
  assert.ok(merged.title_negative.includes("zonenplan"));
  assert.equal(merged.recheck_hours, 24);
  assert.equal(merged.article_pattern, R.article_pattern);
  assert.equal(resolveFilterRules([{ scope: "BE", rules: { min_text_chars: 1 }, active: false }], "BE").min_text_chars, 3000);
  assert.equal(mergeFilterRules(R, null), R);
});

test("stableJson ist unabhängig von der Schlüsselfolge (jsonb)", () => {
  assert.equal(stableJson({ a: 1, b: [1, { c: 2, d: 3 }] }), stableJson({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.notEqual(stableJson(R), stableJson(null));
});

// ── Filter: Inhalt ───────────────────────────────────────────────────────────

test("Inhalt: Scan, wenige Artikel, Paragrafen zählen, Beschluss am Textanfang", () => {
  assert.equal(decideContent("kurz", R)?.reason, "scan_or_short");
  assert.equal(decideContent("x ".repeat(2000), R)?.reason, "no_articles");
  const arts = Array.from({ length: 6 }, (_, i) => `Art. ${i + 1} ${"Text ".repeat(120)}`).join("\n");
  assert.equal(decideContent(arts, R), null);
  const paras = Array.from({ length: 6 }, (_, i) => `§ ${i + 1} ${"Text ".repeat(120)}`).join("\n");
  assert.equal(decideContent(paras, R), null);
  const fr = Array.from({ length: 6 }, (_, i) => `Article ${i + 1} ${"Text ".repeat(120)}`).join("\n");
  assert.equal(decideContent(fr, R), null);
  assert.equal(decideContent(`PROTOKOLL DES REGIERUNGSRATS Sitzung ${arts}`, R)?.reason, "decision_document");
  assert.equal(decideContent(`Regierungsrat erwähnt in Bauordnung\n${"Einleitung ".repeat(50)}${arts}`, R), null);
});

// ── Host ─────────────────────────────────────────────────────────────────────

test("Hosts aus den Live-Antworten", () => {
  const ok: [string, string][] = [
    ["oereblex.ar.ch", "AR"], ["oerebdocs.zh.ch", "ZH"], ["oerebfiles.apps.be.ch", "BE"], ["www.geo.lu.ch", "LU"],
    ["www.gis-daten.ch", "OW"], ["webgis.lisag.ch", "UR"], ["data.geo.sh.ch", "SH"], ["ge.ch", "GE"], ["app2.ge.ch", "GE"],
    ["www.rdppf.vd.ch", "VD"], ["planregister-data.so.ch", "SO"], ["www4.ti.ch", "TI"], ["geo.jura.ch", "JU"],
  ];
  for (const [host, canton] of ok) assert.equal(isHostAllowed(host, R, canton), true, host);
  assert.equal(isHostAllowed("data.geo.admin.ch", R, "VS"), false);
  assert.equal(isHostAllowed("oereblex.ar.ch", R, "ZH"), false);
  assert.equal(isHostAllowed("zh.ch.evil.com", R, "ZH"), false);
  assert.equal(isHostAllowed("evilzh.ch", R, "ZH"), false);
  assert.equal(isHostAllowed("127.0.0.1", R, "ZH"), false);
  assert.equal(isHostAllowed("x.zh.ch.", R, "ZH"), false);
  // Scheinkanton: Aus {kt} darf kein *.evil.ch werden.
  assert.equal(isHostAllowed("a.evil.ch", R, "EVIL"), false);
  assert.equal(isHostAllowed("a.xx.ch", R, "XX"), false);
  assert.equal(isHostAllowed(".ch", R, ""), false);
  assert.equal(isHostAllowed("www.gis-daten.ch", R, "EVIL"), true);
});

// ── Titelschlüssel ───────────────────────────────────────────────────────────

test("titleKey", () => {
  assert.equal(titleKey("Bauordnung Stadt Zürich 2016 (V45 Stand 15.04.2026)", "Zürich"), "bauordnung stadt");
  assert.equal(titleKey("Bauordnung Stadt Zürich 2020 (V46 Stand 01.01.2027)", "Zürich"), "bauordnung stadt");
  assert.equal(titleKey("Baureglement_FSG_Appenzell_2026.pdf", "Appenzell (Bez)"), "baureglement fsg");
  assert.equal(titleKey("Baureglement; Genehmigung vom 13. Januar 2026", "Schwyz"), "baureglement genehmigung vom");
  assert.equal(titleKey("Règlement communal des constructions de Sion", "Sion"), "reglement communal des constructions de");
  assert.equal(titleKey("Quartierplan Waldegg; 25.11.2016"), "quartierplan waldegg");
  assert.equal(titleKey("Bauordnung Bern (BO) vom 28-12-2006", "Bern").startsWith("bauordnung bo"), true);
});

test("titleKey wird nie leer, wenn der Titel nur die Gemeinde ist", () => {
  assert.equal(titleKey("Herisau", "Herisau"), "herisau");
  assert.notEqual(titleKey("Stand 15.10.2024", "Liestal"), "herisau");
});

// ── Kandidaten ───────────────────────────────────────────────────────────────

test("URL-Normalisierung: Schema, Host klein, Fragment weg, Query bleibt", () => {
  assert.equal(normalizeDocumentUrl("https://OEREBDOCS.zh.ch/getDoc?docid=12#seite2"), "https://oerebdocs.zh.ch/getDoc?docid=12");
  assert.equal(normalizeDocumentUrl("www.geo.lu.ch/a.pdf"), "https://www.geo.lu.ch/a.pdf");
  assert.equal(normalizeDocumentUrl("javascript:alert(1)"), null);
  assert.equal(normalizeDocumentUrl("ftp://zh.ch/a"), null);
  assert.equal(normalizeDocumentUrl(""), null);
  assert.equal(normalizeDocumentUrl(null), null);
});

test("Kandidaten: nur betroffene Themen, je URL einmal, Rechtsvorschrift geht vor", () => {
  const out = collectCandidates([
    { theme_code: "A", concern: "affects", law_links: [{ title: "Doppelt", url: "https://x.zh.ch/1", kind: "Law" }] },
    { theme_code: "B", concern: "affects", law_links: [{ title: "Doppelt", url: "https://x.zh.ch/1#f", kind: "LegalProvision" }, { title: "ohne url", url: null }] },
    { theme_code: "C", concern: "not_affects", law_links: [{ title: "Nein", url: "https://x.zh.ch/2", kind: "LegalProvision" }] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].doc_type, "LegalProvision");
  assert.deepEqual(out[0].theme_codes, ["A", "B"]);
});

test("Kandidaten: alte Themen ohne kind über raw.LegalProvisions", () => {
  const out = collectCandidates([
    {
      theme_code: "A",
      concern: "affects",
      law_links: [{ title: "Bauordnung", url: "https://oereblex.sg.ch/1" }],
      raw: {
        LegalProvisions: [
          {
            TextAtWeb: [{ Language: "de", Text: "https://oereblex.sg.ch/1" }],
            Type: { Code: "LegalProvision" },
            ResponsibleOffice: { Name: [{ Language: "de", Text: "Stadt" }] },
          },
        ],
      },
    },
  ]);
  assert.equal(out[0].doc_type, "LegalProvision");
  assert.equal(out[0].authority, "Stadt");
});

test("Fälligkeit wie Spezifikation 5.2", () => {
  const now = Date.now();
  const past = new Date(now - 1000).toISOString();
  const future = new Date(now + 100000).toISOString();
  assert.equal(isDocumentDue({ status: "pending", next_check_at: past }, now), true);
  assert.equal(isDocumentDue({ status: "pending", next_check_at: future }, now), false);
  assert.equal(isDocumentDue({ status: "pending", next_check_at: future, lock_until: future }, now), true, "in Arbeit");
  assert.equal(isDocumentDue({ status: "pending", next_check_at: future, lock_until: past }, now), false);
  assert.equal(isDocumentDue({ status: "imported", next_check_at: past }, now), true);
  assert.equal(isDocumentDue({ status: "imported", next_check_at: future }, now), false);
  assert.equal(isDocumentDue({ status: "failed", next_check_at: past }, now), true);
  assert.equal(isDocumentDue({ status: "failed", next_check_at: future }, now), false);
  for (const status of ["rejected", "removed", "duplicate_manual"]) {
    assert.equal(isDocumentDue({ status, next_check_at: past }, now), false);
  }
});
