/**
 * Korrekturrunde: Geltungsbereich im Fassungsvergleich, Nebenläufigkeit, Stopp, Rechte, Fachregeln.
 * Keine Netzwerkzugriffe. Die SQL-Fassung von Trigger und RPC prüft dieser Test nur statisch.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { withoutShadowedAutoNorms, type ApplicableNorm } from "../norm-applies";
import { FakeSupabase } from "./fake-supabase";
import { syncNextDocument, type ImportDeps } from "./document-import";
import { collectCandidates, loadImportFilter, resetImportFilterCache, syncProjectDocuments } from "./documents";
import { planVersionActions, type VersionDocument } from "./document-versions";
import {
  DEFAULT_IMPORT_FILTER as R,
  contentRulesChanged,
  contentStatus,
  decideContent,
  decidePreDownload,
  isTitlePositive,
  resolveFilterRules,
  scopeOf,
} from "./import-filter";
import { articleSequence, countParagraphGroups, textSketch } from "./text-measure";
import { planUploadLinks } from "./upload-supersede";

const ACTOR = { id: "u", email: "a@example.ch" };
const URL_A = "https://oereblex.sg.ch/api/attachments/1";
const URL_B = "https://oereblex.sg.ch/api/attachments/2";
const words = (seed: string, n = 400) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
const reglement = (seed: string, articles = 30) =>
  Array.from({ length: articles }, (_, i) => `Art. ${i + 1} Titel\n${words(`${seed}${i}x`, 12)}`).join("\n");

beforeEach(() => resetImportFilterCache());

// ── 1. Geltungsbereich ───────────────────────────────────────────────────────

const shared = words("gemeinsam", 310);
const sketchWithOverlap = (own: string) => textSketch(`${shared} ${words(own, 690)}`);

function version(id: string, over: Partial<VersionDocument>): VersionDocument {
  return {
    id, status: "imported", title: "Besondere Vorschriften", title_key: "besondere vorschriften", url_normalized: `https://a.ch/${id}`,
    norm_id: `n${id}`, reject_reason: null, scope: "parcel", article_run: 30, article_hits: 30, text_sketch: textSketch(words("gleich")), ...over,
  };
}

test("Vorlage: Zwei objektbezogene Vorschriften nehmen sich nie zurück, auch bei gleichem Text", () => {
  const vorlage = [version("a", { text_sketch: sketchWithOverlap("a") }), version("b", { text_sketch: sketchWithOverlap("b") })];
  assert.ok(planVersionActions(vorlage, vorlage, R, Date.now()).every((s) => s.action === "note"));
  const gleich = [version("a", {}), version("b", {})];
  assert.ok(planVersionActions(gleich, gleich, R, Date.now()).every((s) => s.action === "note"));
});

test("Gleiche Nummer, längere objektbezogene Fassung: Das Gemeindereglement bleibt", () => {
  const docs = [
    version("objekt", { official_number: "1-1", article_run: 90 }),
    version("gemeinde", { official_number: "1-1", scope: "municipal", title: "Baureglement", title_key: "baureglement", article_run: 30 }),
  ];
  const steps = planVersionActions(docs, docs, R, Date.now());
  assert.ok(steps.every((s) => s.action === "note"), JSON.stringify(steps));
});

test("Gemeinde gegen Gemeinde: Rücknahme nur ab fast gleichem Text, Vorlagen bleiben mit Hinweis", () => {
  const municipal = { scope: "municipal", title: "Baureglement", title_key: "baureglement" };
  const vorlage = [
    version("a", { ...municipal, stand_date: "2022-01-01", text_sketch: sketchWithOverlap("a") }),
    version("b", { ...municipal, stand_date: "2010-01-01", text_sketch: sketchWithOverlap("b") }),
  ];
  assert.ok(planVersionActions(vorlage, vorlage, R, Date.now()).every((s) => s.action === "note"));
  const fassungen = [
    version("a", { ...municipal, stand_date: "2022-01-01" }),
    version("b", { ...municipal, stand_date: "2010-01-01" }),
  ];
  assert.deepEqual(planVersionActions(fassungen, fassungen, R, Date.now()).map((s) => [s.action, s.docId]), [["retire", "b"]]);
});

// ── 2. Nebenläufigkeit und Reparatur ─────────────────────────────────────────

function twoVersions() {
  const db = new FakeSupabase();
  db.rows("projects").push({ id: "p1", org_id: "o1", location: { canton: "SG", municipality: "Quarten" }, bfs_number: 3293 });
  db.rows("oereb_extracts").push({
    id: "e1", project_id: "p1", status: "ok", canton: "SG", server_fetched_at: new Date().toISOString(),
    raw: { RealEstate: { MunicipalityCode: 3293, MunicipalityName: "Quarten" } },
  });
  db.rows("oereb_themes").push({
    id: "t1", extract_id: "e1", theme_code: "ch.Nutzungsplanung", concern: "affects",
    law_links: [URL_A, URL_B].map((url) => ({ title: "Baureglement", url, kind: "LegalProvision", officialNumber: "1993-1" })),
  });
  return db;
}

const TEXTS: Record<string, string> = {
  [URL_A]: `Stand 1.1.2022\n${reglement("gemeinsam")}`,
  [URL_B]: `Stand 1.1.2010\n${reglement("gemeinsam")}\nEin Satz mehr.`,
};
const deps: ImportDeps = {
  fetchDoc: async (url) => ({ kind: "ok", bytes: Buffer.from(`%PDF-${url}`), etag: null, lastModified: null }),
  extractText: async (bytes) => TEXTS[bytes.toString().slice(5)],
  assignNew: async () => {},
};
const row = (db: FakeSupabase, url: string) => db.rows("oereb_documents").find((d) => d.url_normalized === url) as Record<string, unknown>;
const norm = (db: FakeSupabase, id: unknown) => db.rows("norms").find((n) => n.id === id) as Record<string, unknown>;

async function importBoth(db: FakeSupabase) {
  await syncProjectDocuments(db.asClient(), "p1");
  const future = new Date(Date.now() + 3_600_000).toISOString();
  row(db, URL_A).next_check_at = future;
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(row(db, URL_B).status, "imported");
  return future;
}

test("Laufender Import sperrt die Rücknahme: Nach Ablauf der Sperre fällt der Entscheid", async () => {
  const db = twoVersions();
  await importBoth(db);
  row(db, URL_A).next_check_at = new Date(Date.now() - 1000).toISOString();
  // Der Verlierer wird gerade von einem anderen Lauf verarbeitet.
  const inProgress = new Date(Date.now() + 60_000).toISOString();
  row(db, URL_B).lock_until = inProgress;
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(row(db, URL_A).status, "imported");
  assert.equal(row(db, URL_B).status, "imported", "keine Rücknahme während der Sperre");
  assert.equal(norm(db, row(db, URL_B).norm_id).auto_scope, "municipal");

  row(db, URL_B).lock_until = null;
  await syncProjectDocuments(db.asClient(), "p1");
  assert.equal(row(db, URL_B).reject_reason, "older_version");
  assert.equal(norm(db, row(db, URL_B).norm_id).auto_scope, "superseded");
});

test("Stand geändert seit dem Lesen: Die RPC bricht die ganze Gruppe ab", async () => {
  const db = twoVersions();
  const res = await db.rpc("oereb_apply_version_actions", {
    p_canton: "SG", p_bfs: 3293,
    p_actions: [{ doc_id: "fehlt", expect_status: "imported", expect_reason: null, patch: { status: "rejected" } }],
  });
  assert.deepEqual(res.data, { applied: false, reason: "conflict" });
});

test("Reparatur: Importiertes Dokument mit zurückgenommener Norm gilt nach dem nächsten Abgleich wieder", async () => {
  const db = twoVersions();
  await importBoth(db);
  const b = row(db, URL_B);
  // Absturz zwischen zwei Schritten eines älteren Stands.
  norm(db, b.norm_id).auto_scope = "superseded";
  const state = await syncProjectDocuments(db.asClient(), "p1");
  assert.equal(norm(db, b.norm_id).auto_scope, "municipal");
  assert.deepEqual(state.changedNormIds, [b.norm_id]);
});

test("Reparatur: Abgelehnte ältere Fassung mit noch geltender Norm wird zurückgenommen", async () => {
  const db = twoVersions();
  await importBoth(db);
  row(db, URL_A).next_check_at = new Date(Date.now() - 1000).toISOString();
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const loser = row(db, URL_B);
  assert.equal(loser.reject_reason, "older_version");
  norm(db, loser.norm_id).auto_scope = "municipal";
  db.rows("project_norms").push({ project_id: "p1", norm_id: loser.norm_id, added_by: "system" });
  await syncProjectDocuments(db.asClient(), "p1");
  assert.equal(norm(db, loser.norm_id).auto_scope, "superseded");
  assert.equal(db.rows("project_norms").length, 0);
});

test("Manuell übernommene Norm wird nicht zurückgenommen, Dokument bleibt", async () => {
  const db = twoVersions();
  await importBoth(db);
  norm(db, row(db, URL_B).norm_id).source_kind = null;
  row(db, URL_A).next_check_at = new Date(Date.now() - 1000).toISOString();
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(row(db, URL_B).status, "imported");
  assert.equal(norm(db, row(db, URL_B).norm_id).auto_scope, "municipal");
});

// ── 3. Stopp ─────────────────────────────────────────────────────────────────

test("Filter nicht lesbar: nichts Neues, nichts gemerkt, Ablehnungen bleiben", async () => {
  const db = twoVersions();
  db.failing.add("oereb_import_filters");
  assert.deepEqual((await loadImportFilter(db.asClient(), "SG")).doc_types, []);

  const fetched: string[] = [];
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, { ...deps, fetchDoc: async (u, o) => { fetched.push(u); return deps.fetchDoc!(u, o); } });
  assert.equal(fetched.length, 0, "kein Download");
  assert.equal(res.processed, null);
  assert.equal(row(db, URL_A).reject_reason, "doc_type");

  db.failing.delete("oereb_import_filters");
  assert.deepEqual((await loadImportFilter(db.asClient(), "SG")).doc_types, R.doc_types, "nach der Störung sofort wieder gültig");
});

test("Filter nicht lesbar: Bestehende Normen bleiben unangetastet", async () => {
  const db = twoVersions();
  await importBoth(db);
  const before = structuredClone(row(db, URL_B));
  db.failing.add("oereb_import_filters");
  resetImportFilterCache();
  await syncProjectDocuments(db.asClient(), "p1");
  assert.equal(row(db, URL_B).status, before.status);
  assert.deepEqual(row(db, URL_B).filter_snapshot, before.filter_snapshot);
});

test("active=false gibt nichts frei: weder default noch Kanton", () => {
  const stop = { doc_types: [] };
  assert.deepEqual(resolveFilterRules([{ scope: "default", rules: stop, active: false }], "ZH").doc_types, []);
  assert.deepEqual(resolveFilterRules([{ scope: "default", rules: {}, active: false }, { scope: "ZH", rules: {} }], "ZH").doc_types, []);
  assert.deepEqual(resolveFilterRules([{ scope: "ZH", rules: stop, active: false }], "ZH").doc_types, []);
  assert.deepEqual(resolveFilterRules([{ scope: "ZH", rules: stop, active: false }], "BE").doc_types, R.doc_types, "fremder Kanton unberührt");
  assert.deepEqual(resolveFilterRules([], "ZH").doc_types, R.doc_types);
});

test("Stopp schlägt auch die Ausnahmen für Hint und Law", () => {
  const stop = { ...R, doc_types: [] };
  const pre = (title: string, doc_type: string, rules = R) =>
    decidePreDownload({ title, doc_type, authority: "Gemeinde", url: "https://oereblex.vs.ch/api/attachments/1" }, rules, "VS");
  assert.equal(pre("Règlement communal des constructions et des zones des Agettes", "Law"), null);
  assert.equal(pre("Règlement communal des constructions et des zones des Agettes", "Law", stop)?.reason, "doc_type");
  assert.equal(pre("Loi sur les constructions", "Law")?.reason, "doc_type");
  assert.equal(pre("Altes Baugesetz", "Hint"), null);
  assert.equal(pre("Altes Baugesetz", "Hint", stop)?.reason, "doc_type");
  assert.equal(pre("Merkblatt Bauen", "Hint")?.reason, "doc_type");
});

test("Inhaltsgründe: nur Regeln desselben Grundes lösen eine Neubeurteilung aus", () => {
  assert.equal(contentRulesChanged("scan_or_short", R, { ...R, recheck_hours: 1 }), false);
  assert.equal(contentRulesChanged("scan_or_short", R, { ...R, min_text_chars: 1 }), true);
  assert.equal(contentRulesChanged("no_articles", R, { ...R, min_text_chars: 1 }), false);
  assert.equal(contentRulesChanged("no_articles", R, { ...R, min_article_run: 3 }), true);
  assert.equal(contentRulesChanged("decision_document", R, { ...R, letter_head_min_hits: 3 }), true);
  assert.equal(contentRulesChanged("too_large", R, { ...R, min_article_run: 3 }), false);
});

// ── 7. Rechte (statisch; die Ausführung prüft nur eine echte Datenbank) ──────

test("Migration: Trigger setzt Systemspalten für anon und authenticated zurück, RPC nur für service_role", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261107000001_oereb_filter_fix.sql", import.meta.url), "utf8");
  const trigger = sql.slice(sql.indexOf("protect_norm_system_fields() RETURNS"), sql.indexOf("DROP TRIGGER IF EXISTS norms_protect_system_fields"));
  assert.match(trigger, /current_user NOT IN \('anon', 'authenticated'\)/);
  for (const column of ["source_kind", "auto_scope", "superseded_by_norm_id", "superseded_similarity", "superseded_at", "org_authoritative_at", "org_authoritative_by"]) {
    assert.ok(trigger.includes(`NEW.${column} := NULL`), `INSERT ${column}`);
    assert.ok(trigger.includes(`NEW.${column} := OLD.${column}`), `UPDATE ${column}`);
  }
  assert.ok(trigger.includes("NEW.org_authoritative := false"));
  assert.ok(trigger.includes("NEW.org_authoritative := OLD.org_authoritative"));
  assert.match(sql, /BEFORE INSERT OR UPDATE ON norms/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.oereb_apply_version_actions\(text, integer, jsonb\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.oereb_apply_version_actions\(text, integer, jsonb\) TO service_role/);
  assert.match(sql, /lock_timeout = '3s'/);
  assert.match(sql, /VALIDATE CONSTRAINT norms_superseded_only_org/);
  assert.ok(!/CONCURRENTLY/.test(sql.replace(/^--.*$/gm, "")));
  assert.ok(!sql.includes("oereb_documents_official_number_idx"));
});

// ── 14, 15: Projektort, massgebender Upload, paralleler Verweis ──────────────

const official = (over: Partial<ApplicableNorm> = {}): ApplicableNorm => ({
  id: "a", title: "Baureglement", layer: 4, jurisdiction_type: "municipal", jurisdiction_name: "Buchs", jurisdiction_canton: "SG", jurisdiction_bfs: 3271,
  source_kind: "oereb_auto", auto_scope: "municipal", ...over,
});
const upload = (over: Partial<ApplicableNorm> = {}): ApplicableNorm => ({
  id: "u", title: "BR_2012.pdf", layer: 4, jurisdiction_type: "municipal", jurisdiction_name: "Buchs", superseded_by_norm_id: "a", ...over,
});

test("Gleichnamige Gemeinde im anderen Kanton: Der Upload bleibt, die amtliche Norm gilt dort nicht", () => {
  const norms = [official(), upload()];
  assert.deepEqual(withoutShadowedAutoNorms(norms, { canton: "AG", municipality: "Buchs", bfs: 4003 }).map((n) => n.id), ["a", "u"]);
  assert.deepEqual(withoutShadowedAutoNorms(norms, { canton: "SG", municipality: "Buchs", bfs: 3271 }).map((n) => n.id), ["a"]);
});

test("Massgebender Upload unter der Grenze behält seinen Verweis, ein gewöhnlicher verliert ihn", () => {
  const rows = [
    { id: "m", text: words("eigen", 800), superseded_by_norm_id: "a", org_authoritative: true },
    { id: "g", text: words("eigen", 800), superseded_by_norm_id: "a", org_authoritative: false },
  ];
  assert.deepEqual(planUploadLinks("a", words("amtlich", 800), rows, R).map((l) => [l.uploadId, l.action]), [["g", "unlink"]]);
  assert.equal(R.upload_similarity_min, 0.8);
});

// ── Fachregeln ───────────────────────────────────────────────────────────────

const preTitle = (title: string, canton = "SG") =>
  decidePreDownload({ title, doc_type: "LegalProvision", authority: "Gemeinde", url: `https://oereblex.${canton.toLowerCase()}.ch/1` }, R, canton);

test("Positive Titel: neu, und zu breite Begriffe begrenzt", () => {
  for (const t of ["BZO 2016", "Zonenordnung", "Zonenvorschriften der Gemeinde", "Nutzungsordnung", "Lescha da construcziun", "Legge edilizia", "NAPR Gemeinde", "Regolamento comunale edilizio", "Règlement des constructions", "Baugesetz der Stadt Chur", "Règlement communal des constructions et des zones", "Plan général d'affectation Règlement"]) {
    assert.equal(isTitlePositive(t, R), true, t);
  }
  for (const t of ["Règlement communal sur les chiens", "Teilzonenreglement Dorf", "Baugesetz des Kantons Bern", "Abzonung"]) {
    assert.equal(isTitlePositive(t, R), false, t);
  }
  assert.equal(isTitlePositive("Zonenreglement", R), true);
});

test("Sondernutzung: immer parcel, schlägt negative Titel", () => {
  for (const t of ["Gestaltungsplan Zentrum, Genehmigung", "Zonenplan <1987>, Sonderbauvorschrift", "Baulinienplan Kasernenstrasse", "Plan de quartier Nord; décision", "Schutzverordnung und Schutzplan - Genehmigung"]) {
    assert.equal(preTitle(t), null, t);
    assert.equal(scopeOf(t, R), "parcel", t);
  }
  assert.equal(scopeOf("Baureglement Quartierplan Nord", R), "parcel");
});

test("Negative Titel: enger, Vorschriften nie am Plantitel verwerfen", () => {
  assert.equal(preTitle("Plan d'affectation des zones")?.reason, "title_negative");
  assert.equal(preTitle("Plan des zones")?.reason, "title_negative");
  assert.equal(preTitle("Zonenplan Grundnutzung")?.reason, "title_negative");
  assert.equal(preTitle("RRB vom 29.01.2002")?.reason, "title_negative");
  assert.equal(preTitle("Reglent Zonenplan Schutz FSG Appenzell 2026.pdf", "AI"), null);
  assert.equal(preTitle("Reglement über den Schutz der Gewässer, RRB 2014", "UR"), null);
  assert.equal(preTitle("Plan d'affectation Sud"), null);
});

test("Änderungserlass: «décision» zählt nicht mehr, Beschluss am Textanfang schon", () => {
  assert.ok(!R.title_amendment.includes("décision"));
  const text = `AUSZUG AUS DEM PROTOKOLL des Regierungsrats\n${reglement("x", 80)}`;
  assert.equal(decideContent(text, R, "Nutzungsplanung Schaffhausen (2006)")?.reason, "decision_document");
  assert.equal(decideContent(`Extrait du procès-verbal\n${reglement("x", 80)}`, R, "Bauordnung")?.reason, "decision_document");
});

test("Grenze: Folge 5 bis 9 nur bei Reglementstitel, sonst ab 10", () => {
  const folge = `${words("t", 900)} ${Array.from({ length: 6 }, (_, i) => `Art. ${i + 30}`).join(" ")}`;
  assert.equal(decideContent(folge, R, "Baureglement"), null);
  assert.equal(decideContent(folge, R, "Nutzungsplanung Schaffhausen (2006)")?.reason, "no_articles");
  assert.equal(decideContent(folge, R, "Quartierplan Nord"), null);
});

test("Querverweise zählen nicht: Art. n vor Gesetz oder Abs., und nach Gesetz oder «nach»", () => {
  const refs = { after: R.article_reference_after, before: R.article_reference_before };
  const verweise = "Art. 1 BauG, Art. 2 Abs. 3, Art. 3 PBV, Art. 4 LSV, nach Art. 5, BauG Art. 6, gemäss Art. 7";
  assert.deepEqual(articleSequence(verweise, R.article_pattern, refs), { run: 0, first: null, hits: 0 });
  assert.equal(articleSequence("Art. 1 Zweck\nArt. 2 Geltung\nArt. 3 Abstand", R.article_pattern, refs).run, 3);
  assert.equal(articleSequence("Art. 1 Baugesuch\nArt. 2 Absätze", R.article_pattern, refs).run, 2, "Wortanfang allein ist kein Verweis");
});

test("Sachtitel mit Absätzen und Erlassformel bestehen, ohne Formel gehen sie zur Prüfung", () => {
  const abschnitte = Array.from({ length: 9 }, (_, i) => `Thema ${i}\n1 Das Baureglement ordnet dies\n2 Es gilt für alles ${words(`w${i}`, 80)}`).join("\n");
  assert.equal(countParagraphGroups(abschnitte), 9);
  assert.equal(countParagraphGroups(`BauG Art. 25 ff. \t1 Das Gebiet der Gemeinde`), 1, "nach Randnotiz");
  assert.equal(decideContent(`Die Versammlung erlässt das Reglement.\n${abschnitte}`, R, "Baureglement"), null);
  const ohne = decideContent(abschnitte, R, "Baureglement");
  assert.equal(ohne?.reason, "no_articles");
  assert.equal(contentStatus(ohne?.reason, "Baureglement", R), "review");
  assert.equal(contentStatus("no_articles", "Bericht", R), "rejected");
  assert.equal(contentStatus("scan_or_short", "Baureglement", R), "rejected");
  assert.equal(decideContent(`Die Versammlung erlässt.\n${abschnitte}`, R, "Nutzungsplanung")?.reason, "no_articles", "nur mit Reglementstitel");
});

test("Geltung aus der Nummer: AR führt «Baureglement» dort, Sondernutzung bleibt parcel", () => {
  assert.equal(scopeOf("Herisau", R, "Baureglement"), "municipal");
  assert.equal(scopeOf("Herisau", R, "2020-17"), "parcel");
  assert.equal(scopeOf("Quartierplan Nord", R, "Baureglement"), "parcel");
  const [c] = collectCandidates([{ theme_code: "x", law_links: [{ title: "Herisau", url: "https://x.ar.ch/1", kind: "LegalProvision", officialNumber: "Baureglement" }] }]);
  assert.equal(c.official_number, null, "ohne Ziffern verbindet die Nummer nichts");
  assert.equal(c.official_number_raw, "Baureglement");
});
