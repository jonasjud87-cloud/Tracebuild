/**
 * Echter Prüffall Quarten SG (CH393477809536) mit kurzen Textausschnitten, dazu die Grenzfälle des
 * Fassungsvergleichs. Keine Netzwerkzugriffe, keine PDFs im Repo.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { FakeSupabase } from "./fake-supabase";
import { syncNextDocument, type ImportDeps } from "./document-import";
import { resetImportFilterCache } from "./documents";
import { countPendingDocuments } from "./documents-pending";
import { planVersionActions, normalizeOfficialNumber, pickWinner, type VersionDocument } from "./document-versions";
import { DEFAULT_IMPORT_FILTER as R, assessContent, decideContent, mergeFilterRules } from "./import-filter";
import { articleSequence, collapseSpacedLetters, extractStandDate, textSketch } from "./text-measure";

const ACTOR = { id: "user-1", email: "a@example.ch" };
const url = (id: number) => `https://oereblex.sg.ch/api/attachments/${id}`;

// Ausschnitte der echten Texte, auf Testgrösse wiederholt.
const filler = (word: string, n = 400) => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");
const GUELTIG =
  "Nachgeführt bis 31.12.2022\nP O L I T I S C H E G E M E I N D E Q U A R T E N\nB a u r e g l e m e n t\n" +
  Array.from({ length: 40 }, (_, i) => `Art. ${i + 1} Bestimmung ${i + 1}\n${filler(`gueltig${i}x`, 12)}`).join("\n");
const ALT_SCHLUSS =
  "20\nA r t .42 Uebergangsbestimmungen und I n k r a f t t r e t e n\n" +
  "TDi eses B a u r e g l e m e n t t r i t t m i t d e r Genehmigung d u r c h das k a n t o n a l e B a u d e p a r t e me n t i n K r a f t .\n" +
  `Rechtsmittelbelehrung: Gegen diese Verfügung kann nach Art. 43 lit. c VRP innert vierzehn Tagen. ${filler("genehmigung")}`;
const BRIEF =
  "Kanton St.Gallen\nBaudepartement\nA-Post\nGemeinderat Quarten\n1. März 2021\nGeschäft Nr. 19-7958\n" +
  "Gemeinde Quarten: Genehmigung eines Gemeindeerlasses\nSehr geehrter Herr Gemeindepräsident\n" +
  `Sie haben uns in Nachachtung von Art. 38 des Planungs- und Baugesetzes. Art. 11, Art. 12 und Art. 13. ${filler("brief")}`;
const SCAN = Array.from({ length: 39 }, (_, i) => `-- ${i + 1} of 39 --`).join("\n\n");

const QUARTEN: Record<number, { title: string; number: string; text: string }> = {
  10156: { title: "Baureglement", number: "1993-4101", text: ALT_SCHLUSS },
  17750: { title: "Baureglement", number: "1993-4101", text: GUELTIG },
  16355: { title: "Schutzverordnung Teil Kulturgüter- und Naturschutz", number: "2021-4131", text: BRIEF },
  17830: { title: "Reglement", number: "2021-4131", text: SCAN },
};

function setup(ids: number[], extra: { id: string; extract: string; ids: number[] }[] = []) {
  const db = new FakeSupabase();
  const link = (id: number) => ({ title: QUARTEN[id].title, url: url(id), kind: "LegalProvision", authority: "Gemeinde", officialNumber: QUARTEN[id].number });
  const add = (project: string, extract: string, list: number[]) => {
    db.rows("projects").push({ id: project, org_id: "o1", location: { canton: "SG", municipality: "Quarten" }, bfs_number: 3293 });
    db.rows("oereb_extracts").push({
      id: extract, project_id: project, status: "ok", canton: "SG", server_fetched_at: new Date().toISOString(),
      raw: { RealEstate: { MunicipalityCode: 3293, MunicipalityName: "Quarten" } },
    });
    db.rows("oereb_themes").push({ id: `t-${extract}`, extract_id: extract, theme_code: "ch.Nutzungsplanung", concern: "affects", law_links: list.map(link) });
  };
  add("p1", "e1", ids);
  for (const e of extra) add(e.id, e.extract, e.ids);
  return db;
}

function deps(calls: string[] = []): ImportDeps {
  return {
    fetchDoc: async (u) => {
      calls.push(u);
      const id = Number(u.split("/").pop());
      return { kind: "ok", bytes: Buffer.from(`%PDF-${id}`), etag: null, lastModified: null };
    },
    extractText: async (bytes) => QUARTEN[Number(bytes.toString().slice(5))].text,
    assignNew: async () => {},
  };
}

const row = (db: FakeSupabase, id: number) => db.rows("oereb_documents").find((d) => d.url_normalized === url(id)) as Record<string, unknown>;

/** Erzwingt die Reihenfolge: Alle anderen sind vorübergehend nicht fällig. Gibt die echte Abfolge zurück. */
async function drain(db: FakeSupabase, project = "p1", order: number[] = []): Promise<string[]> {
  const processed: string[] = [];
  await countPendingDocuments(db.asClient(), project);
  const future = new Date(Date.now() + 3_600_000).toISOString();
  for (const id of order) {
    const others = db.rows("oereb_documents").filter((d) => d.url_normalized !== url(id));
    const saved = others.map((d) => d.next_check_at);
    others.forEach((d) => { d.next_check_at = future; });
    const res = await syncNextDocument(db.asClient(), project, ACTOR, deps());
    if (res.processed) processed.push(res.processed.id);
    others.forEach((d, i) => { if (d.next_check_at === future) d.next_check_at = saved[i]; });
  }
  for (let i = 0; i < 12; i++) {
    const res = await syncNextDocument(db.asClient(), project, ACTOR, deps());
    if (!res.processed && !res.remaining) break;
  }
  return processed;
}

function permutations<T>(list: T[]): T[][] {
  if (list.length < 2) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

function assertQuarten(db: FakeSupabase, label: string) {
  const auto = db.rows("norms").filter((n) => n.auto_scope === "municipal" || n.auto_scope === "parcel");
  assert.equal(auto.length, 1, `${label}: nur eine geltende Norm`);
  assert.equal(auto[0].source_url, url(17750), label);
  assert.equal(auto[0].auto_scope, "municipal", label);
  assert.equal(row(db, 17750).status, "imported", label);
  assert.equal(row(db, 10156).status, "rejected", label);
  assert.equal(row(db, 10156).reject_reason, "older_version", label);
  assert.equal(row(db, 10156).version_winner_id, row(db, 17750).id, label);
  assert.equal(row(db, 16355).status, "rejected", label);
  assert.equal(row(db, 16355).reject_reason, "decision_document", label);
  assert.equal(row(db, 17830).reject_reason, "scan_or_short", label);
}

beforeEach(() => resetImportFilterCache());

test("Quarten: nur 17750 gilt, in jeder Importreihenfolge", async () => {
  for (const order of permutations([10156, 17750, 16355, 17830])) {
    resetImportFilterCache();
    const db = setup([10156, 17750, 16355, 17830]);
    const processed = await drain(db, "p1", order);
    assert.deepEqual(processed, order.map((id) => row(db, id).id), "die Reihenfolge wurde wirklich erzwungen");
    assertQuarten(db, `Reihenfolge ${order.join(",")}`);
    assert.ok(row(db, 10156).article_run !== null);
    assert.equal(row(db, 17750).official_number, "1993-4101");
    assert.equal(row(db, 17750).stand_date, "2022-12-31");
  }
});

test("Quarten: bereits importierter Verlierer wird zurückgenommen, die Norm bleibt erhalten", async () => {
  const db = setup([10156, 17750]);
  // Zustand vor dem Fix: Beide unter alten Regeln importiert, ohne Messwerte.
  await drain(db);
  const loserNorm = row(db, 10156).norm_id as string | null;
  assert.equal(loserNorm, null, "Fragment wird unter den neuen Regeln gar nicht erst importiert");

  const norm = { id: "alt-10156", org_id: null, title: "Baureglement [x]", text: ALT_SCHLUSS, source_kind: "oereb_auto", auto_scope: "municipal", jurisdiction_type: "municipal", jurisdiction_name: "Quarten", source_url: url(10156) };
  db.rows("norms").push(norm);
  db.rows("project_norms").push({ project_id: "p1", norm_id: norm.id, added_by: "system" }, { project_id: "p2", norm_id: norm.id, added_by: "user" });
  Object.assign(row(db, 10156), { status: "imported", norm_id: norm.id, reject_reason: null, reject_detail: null, content_reason: null, article_run: null, text_sketch: null, version_winner_id: null, filter_snapshot: null });

  await syncNextDocument(db.asClient(), "p1", ACTOR, deps());
  assert.equal(row(db, 10156).reject_reason, "older_version");
  assert.equal(db.rows("norms").find((n) => n.id === norm.id)?.auto_scope, "superseded");
  assert.deepEqual(db.rows("project_norms").map((r) => r.added_by), ["user"], "Von Hand zugewiesen bleibt");
});

test("Bei Änderung neu beurteilt: Die ältere Fassung wird vollständig und jünger, der Sieg kehrt", async () => {
  const altDb = setup([10156, 17750]);
  await drain(altDb);
  assert.equal(row(altDb, 10156).reject_reason, "older_version");
  assert.ok(Date.parse(row(altDb, 10156).next_check_at as string) > Date.now() + 100 * 3_600_000, "seltene Nachprüfung");

  const neu = GUELTIG.replace("31.12.2022", "30.06.2026");
  const change: ImportDeps = {
    ...deps(),
    extractText: async () => neu,
    fetchDoc: async () => ({ kind: "ok", bytes: Buffer.from("%PDF-neu"), etag: null, lastModified: null }),
  };
  row(altDb, 10156).next_check_at = new Date(Date.now() - 1000).toISOString();
  await syncNextDocument(altDb.asClient(), "p1", ACTOR, change);
  assert.equal(row(altDb, 10156).status, "pending", "keine Norm vorhanden: normaler Import folgt");
  assert.equal(row(altDb, 17750).status, "imported", "der Vergleich entscheidet erst mit importierter Fassung");
  await syncNextDocument(altDb.asClient(), "p1", ACTOR, change);
  assert.equal(row(altDb, 10156).status, "imported");
  assert.equal(row(altDb, 17750).reject_reason, "older_version");
  assert.equal(altDb.rows("norms").find((n) => n.source_url === url(17750))?.auto_scope, "superseded");
});

test("Brief, der früher bestand, fällt bei der Neubeurteilung ohne Download heraus", async () => {
  const calls: string[] = [];
  const db = setup([16355]);
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps(calls));
  const norm = { id: "alt-16355", org_id: null, title: "Schutz", text: BRIEF, source_kind: "oereb_auto", auto_scope: "parcel", jurisdiction_type: "municipal", jurisdiction_name: "Quarten" };
  db.rows("norms").push(norm);
  Object.assign(row(db, 16355), { status: "imported", norm_id: norm.id, reject_reason: null, content_reason: null, article_run: null, text_sketch: null, filter_snapshot: { alt: true }, next_check_at: new Date(Date.now() + 3_600_000).toISOString() });
  calls.length = 0;
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps(calls));
  assert.equal(row(db, 16355).reject_reason, "decision_document");
  assert.equal(db.rows("norms").find((n) => n.id === norm.id)?.auto_scope, "superseded");
  assert.equal(calls.length, 0);
});

test("Fusion: gleiche Titel in verschiedenen Auszügen verdrängen sich nicht", async () => {
  QUARTEN[1] = { title: "Baureglement", number: "2001-1", text: GUELTIG.replaceAll("gueltig", "ortsteilA") };
  QUARTEN[2] = { title: "Baureglement", number: "2002-2", text: GUELTIG.replaceAll("gueltig", "ortsteilB").replace("31.12.2022", "31.12.2010").split("Art. 21 ")[0] };
  const db = setup([1], [{ id: "p2", extract: "e2", ids: [2] }]);
  await drain(db, "p1");
  await drain(db, "p2");
  assert.equal(row(db, 1).status, "imported");
  assert.equal(row(db, 2).status, "imported");
  delete QUARTEN[1];
  delete QUARTEN[2];
});

test("Ältere Fassung bleibt abgelehnt, solange der Gewinner anderswo gilt; nach dessen Wegfall frei", () => {
  const doc = (over: Partial<VersionDocument>): VersionDocument => ({
    id: "x", status: "imported", title: "Baureglement", title_key: "baureglement", url_normalized: "https://a.ch/x", scope: "municipal",
    norm_id: "n", reject_reason: null, article_run: 30, article_hits: 30, text_sketch: textSketch(filler("a")), last_seen_at: new Date().toISOString(), ...over,
  });
  const winner = doc({ id: "w", url_normalized: "https://a.ch/w" });
  const old = doc({ id: "o", status: "rejected", reject_reason: "older_version", version_winner_id: "w", norm_id: "m" });
  assert.deepEqual(planVersionActions([old], [old, winner], R, Date.now()), []);
  const goneWinner = { ...winner, status: "rejected", reject_reason: "superseded", norm_id: null };
  assert.deepEqual(planVersionActions([old], [old, goneWinner], R, Date.now()), [{ action: "restore", docId: "o" }]);
  const stale = { ...winner, last_seen_at: new Date(Date.now() - 90 * 86_400_000).toISOString() };
  assert.deepEqual(planVersionActions([old], [old, stale], R, Date.now()), [{ action: "restore", docId: "o" }]);
});

test("Im Zweifel beide: eigener Inhalt oder neuer Stand bei kürzerer Folge", () => {
  const doc = (id: string, over: Partial<VersionDocument>): VersionDocument => ({
    id, status: "imported", title: "Baureglement", title_key: "baureglement", url_normalized: `https://a.ch/${id}`, scope: "municipal",
    norm_id: `n${id}`, reject_reason: null, article_run: 30, article_hits: 30, text_sketch: textSketch(filler(id)), ...over,
  });
  const notes = (a: VersionDocument, b: VersionDocument) => planVersionActions([a, b], [a, b], R, Date.now());

  const eigen = notes(doc("a", {}), doc("b", { article_run: 8 }));
  assert.ok(eigen.every((s) => s.action === "note" && s.note), "kein gemeinsamer Text: beide bleiben");

  const sketch = textSketch(filler("gleich"));
  const neuer = notes(doc("a", { text_sketch: sketch, stand_date: "2010-01-01" }), doc("b", { text_sketch: sketch, article_run: 3, stand_date: "2022-01-01" }));
  assert.ok(neuer.every((s) => s.action === "note"), "neuer Stand bei kürzerer Folge: Zweifel");

  const klar = notes(doc("a", { text_sketch: sketch, stand_date: "2022-01-01" }), doc("b", { text_sketch: sketch, article_run: 29, stand_date: "2010-01-01" }));
  assert.deepEqual(klar.map((s) => s.action), ["retire"], "ähnlich lang, gleicher Text, älterer Stand: verliert");
  assert.equal(klar[0].docId, "b");

  const anhang = notes(doc("a", { official_number: "1-1" }), doc("b", { official_number: "1-1", title: "Anhang zum Baureglement", title_key: "anhang", article_run: 2 }));
  assert.deepEqual(anhang, [], "Anhang tritt nicht an");
});

test("Gleiche Nummer, anderer Titel: Eine Beilage ohne Artikelfolge behält ihren eigenen Grund (AI)", () => {
  const sketch = textSketch(filler("x"));
  const base = { status: "imported", url_normalized: "u", norm_id: "n", reject_reason: null, official_number: "126/26", text_sketch: sketch, scope: "municipal" };
  const main = { ...base, id: "a", title: "Baureglement", title_key: "baureglement", article_run: 20, article_hits: 40 };
  const list = { ...base, id: "b", status: "rejected", reject_reason: "no_articles", content_reason: "no_articles", norm_id: null, title: "Liste Kulturobjekte", title_key: "liste kulturobjekte", article_run: 1, article_hits: 1 };
  assert.deepEqual(planVersionActions([main, list], [main, list], R, Date.now()), []);
});

test("Fussnote klebt an der Nummer: Überschriften am Zeilenanfang zählen trotzdem (ZH)", () => {
  const text = "Art. 13 Das Gebiet\nArt. 24 Der Zonenplan\nArt. 37 Für folgende\nArt. 4 Für die\nArt. 625 Von der\nArt. 5 Die allgemeine";
  assert.equal(articleSequence(text, R.article_pattern).run, 5);
  assert.equal(articleSequence("Siehe Art. 13, Art. 24, Art. 37 und Art. 45", R.article_pattern).run, 1, "im Fliesstext kein Abschneiden");
});

test("Gewinner ist unabhängig von der Eingabereihenfolge", () => {
  const doc = (id: string, run: number, stand: string | null) => ({ id, scope: "municipal", status: "imported", title: "B", title_key: "b", url_normalized: id, norm_id: id, reject_reason: null, article_run: run, stand_date: stand, text_sketch: { n: run, h: [] } });
  const docs = [doc("a", 40, null), doc("b", 37, "2020-01-01"), doc("c", 10, "2024-01-01")];
  for (const p of permutations(docs)) assert.equal(pickWinner(p, R).id, "b");
});

// ── Inhaltstest ──────────────────────────────────────────────────────────────

const body = filler("text", 500);

test("Inhalt: fortlaufende Folge statt Trefferzahl, Querverweise zählen nicht", () => {
  assert.deepEqual(articleSequence("Art. 1 x Art. 2 y Art. 3", R.article_pattern), { run: 3, first: 1, hits: 3 });
  const verweise = `${body} Art. 38 PBG, Art. 94 VRP, Art. 1 Abs. 1, Art. 47 VRP, Art. 132 PBG, Art. 3 PBV, Art. 31 BauG`;
  assert.equal(decideContent(verweise, R)?.reason, "no_articles");
  assert.equal(decideContent(`${body} Art. 1 Art. 2 Art. 3 Art. 4 Art. 5`, R, "Baureglement"), null);
});

test("Inhalt: § und Paragrafen (AG, BL, BS), fr/it, OCR-Sperrung", () => {
  assert.equal(decideContent(`${body} § 1 § 2 §3 § 4 § 5`, R, "Bauordnung"), null);
  assert.equal(decideContent(`${body} Paragraf 1 Paragraf 2 Paragraf 3 Paragraf 4 Paragraf 5`, R, "Bauordnung"), null);
  assert.equal(decideContent(`${body} Article 1 Article 2 art. 3 Article 4 Article 5`, R, "Règlement de construction"), null);
  assert.equal(decideContent(`${body} Articolo 1 Art. 2 Articolo 3 Art. 4 Art. 5`, R, "Regolamento edilizio"), null);
  assert.equal(articleSequence("A r t .42 und A r t . 43", R.article_pattern).run, 2);
  assert.equal(collapseSpacedLetters("B a u r e g l e m e n t tritt"), "Baureglement tritt");
});

test("Inhalt: Änderungserlass mit tieferer Grenze", () => {
  const zwei = `${body} Art. 12 geändert. Art. 13 geändert.`;
  assert.equal(decideContent(zwei, R, "Baureglement")?.reason, "no_articles");
  assert.equal(decideContent(zwei, R, "Nachtrag zum Baureglement"), null);
  assert.equal(decideContent(zwei, R, "Teilrevision Baureglement"), null);
});

test("Inhalt: Briefmerkmale de, fr, it; ein Merkmal allein genügt nicht", () => {
  assert.match(decideContent(BRIEF, R)?.detail ?? "", /a-post/);
  assert.equal(decideContent(`Madame, Monsieur\nAffaire n° 12\n${body}`, R)?.reason, "decision_document");
  assert.equal(decideContent(`Egregi Signori\nPratica n. 4\n${body}`, R)?.reason, "decision_document");
  const erlass = `Sehr geehrte Mitbürger, ein Vorwort. ${body} Art. 1 Art. 2 Art. 3 Art. 4 Art. 5`;
  assert.equal(decideContent(erlass, R, "Baureglement"), null);
});

test("Inhalt: Begleitbrief mit vollständigem Erlass bleibt und wird als Verdacht markiert", () => {
  const erlass = Array.from({ length: 12 }, (_, i) => `Art. ${i + 1}`).join(" ");
  const res = assessContent(`Sehr geehrte Damen und Herren\nGeschäft Nr. 1\n${body} ${erlass}`, R);
  assert.equal(res.rejection, null);
  assert.equal(res.letterWithArticles, true);
});

test("Regeln: Daten ohne Deploy änderbar, Muster ohne Nummerngruppe wird ignoriert", () => {
  const merged = mergeFilterRules(R, { min_article_run: 9, letter_head_terms_add: ["sehr verehrte"], article_pattern: "Art\\.\\s*\\d" });
  assert.equal(merged.min_article_run, 9);
  assert.ok(merged.letter_head_terms.includes("sehr verehrte"));
  assert.equal(merged.article_pattern, R.article_pattern);
  assert.equal(mergeFilterRules(R, { article_pattern: "§(\\d+)" }).article_pattern, "§(\\d+)");
});

test("Stand: Nachführung, Titel, fr und it; zitierte Fassungen in der Mitte zählen nicht", () => {
  const m = R.version_date_markers;
  assert.equal(extractStandDate("", "Nachgeführt bis 31.12.2022\nx", m), "2022-12-31");
  assert.equal(extractStandDate("Zentrum (Stand 15.10.2024)", "x", m), "2024-10-15");
  assert.equal(extractStandDate("", "État au 1er janvier 2019", m), "2019-01-01");
  assert.equal(extractStandDate("", "Stato al 3 marzo 2020", m), "2020-03-03");
  assert.equal(extractStandDate("", `${"x".repeat(3000)} Stand 1.1.2030 ${"y".repeat(3000)}`, m), null);
  assert.equal(extractStandDate("", "Baureglement ohne Angabe", m), null);
});

test("Amtliche Nummer: Platzhalter verbinden nichts", () => {
  assert.equal(normalizeOfficialNumber(" 1993-4101 "), "1993-4101");
  for (const v of ["", "-", "0", "000", "n/a", null, 12]) assert.equal(normalizeOfficialNumber(v), null);
});
