/** Ablauf des Imports gegen eine Attrappe im Speicher. Keine Netzwerkzugriffe. */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { FakeSupabase } from "./fake-supabase";
import { acquireDocumentLock, syncNextDocument, type ImportDeps } from "./document-import";
import { resetImportFilterCache } from "./documents";
import { countPendingDocuments } from "./documents-pending";
import { normTextHash } from "../norm-hash";

const ACTOR = { id: "user-1", email: "a@example.ch" };
const BO_URL = "https://oerebdocs.zh.ch/getDoc?docid=1";

function reglement(marker: string, articles = 20): string {
  return Array.from({ length: articles }, (_, i) => `Art. ${i + 1} ${marker} ${"Bestimmung ".repeat(30)}`).join("\n");
}

function link(title: string, url: string, kind = "LegalProvision") {
  return { title, url, kind, authority: "Stadt Zürich" };
}

function setup(links: ReturnType<typeof link>[] = [link("Bauordnung Stadt Zürich 2016", BO_URL)]) {
  const db = new FakeSupabase();
  db.rows("projects").push({ id: "p1", org_id: "o1", location: { canton: "ZH", municipality: "Zürich" }, bfs_number: 261 });
  db.rows("oereb_extracts").push({
    id: "e1", project_id: "p1", status: "ok", canton: "ZH", server_fetched_at: new Date().toISOString(),
    raw: { RealEstate: { MunicipalityCode: 261, MunicipalityName: "Zürich" } },
  });
  db.rows("oereb_themes").push({ id: "t1", extract_id: "e1", theme_code: "ch.Nutzungsplanung", concern: "affects", law_links: links });
  return db;
}

function stubs(text: string | (() => string), overrides: Partial<ImportDeps> = {}) {
  const calls = { fetch: 0, assign: [] as string[] };
  const deps: ImportDeps = {
    fetchDoc: async () => {
      calls.fetch++;
      return { kind: "ok", bytes: Buffer.from(`%PDF-${typeof text === "string" ? text : text()}`), etag: '"a"', lastModified: null };
    },
    extractText: async (bytes) => bytes.toString().slice(5),
    assignNew: async (id) => {
      calls.assign.push(id);
    },
    ...overrides,
  };
  return { calls, deps };
}

function doc(db: FakeSupabase, url = BO_URL) {
  return db.rows("oereb_documents").find((d) => d.url_normalized === url) as Record<string, unknown>;
}

/** Macht das Dokument wieder fällig, wie nach Ablauf von recheck_hours. */
function makeDue(db: FakeSupabase, url = BO_URL) {
  doc(db, url).next_check_at = new Date(Date.now() - 1000).toISOString();
}

beforeEach(() => resetImportFilterCache());

test("neues Baureglement wird globale Norm mit Herkunft, Audit und Zuweisung", async () => {
  const db = setup();
  const { calls, deps } = stubs(reglement("alt"));
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 1);

  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "imported");
  assert.equal(res.remaining, 0);

  const [norm] = db.rows("norms");
  assert.equal(norm.org_id, null);
  assert.equal(norm.source_kind, "oereb_auto");
  assert.equal(norm.auto_scope, "municipal");
  assert.equal(norm.layer, 4);
  assert.equal(norm.jurisdiction_name, "Zürich");
  assert.equal(norm.jurisdiction_bfs, 261);
  assert.equal(norm.category, "Baureglement");
  assert.equal(norm.pdf_url, BO_URL);
  assert.deepEqual(calls.assign, [norm.id]);
  assert.equal(doc(db).status, "imported");
  assert.equal(doc(db).lock_until, null);
  assert.equal(db.rows("audit_log")[0].action, "norm_auto_import");
  assert.equal(db.rows("audit_log")[0].org_id, null);
});

test("Titelablehnung braucht keinen Download und zählt nicht als offen", async () => {
  const db = setup([
    link("Genehmigung vom 20. Juli 2000", "https://oerebdocs.zh.ch/getDoc?docid=2"),
    link("Raumplanungsgesetz", "https://oerebdocs.zh.ch/getDoc?docid=3", "Law"),
  ]);
  const { calls, deps } = stubs(reglement("x"));
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 0);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed, null);
  assert.equal(calls.fetch, 0);
  assert.equal(doc(db, "https://oerebdocs.zh.ch/getDoc?docid=2").reject_reason, "title_negative");
  assert.equal(doc(db, "https://oerebdocs.zh.ch/getDoc?docid=3").reject_reason, "doc_type");
  assert.ok(doc(db, "https://oerebdocs.zh.ch/getDoc?docid=2").filter_snapshot);
});

test("innerhalb recheck_hours kein weiterer Download, auch nicht für andere Projekte", async () => {
  const db = setup();
  const { calls, deps } = stubs(reglement("alt"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const again = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(again.processed, null);
  assert.equal(calls.fetch, 1);
  assert.ok(Date.parse(doc(db).next_check_at as string) > Date.now() + 23 * 3_600_000);
});

test("gleiches PDF: nur geprüft, Norm unverändert, keine Version", async () => {
  const db = setup();
  const { deps } = stubs(reglement("alt"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  makeDue(db);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "unchanged");
  assert.equal(db.rows("norm_versions").length, 0);
  assert.ok(db.rows("norms")[0].source_checked_at);
});

test("304 gilt als unverändert", async () => {
  const db = setup();
  const { deps } = stubs(reglement("alt"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  makeDue(db);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, {
    ...deps,
    fetchDoc: async (_u, o) => {
      assert.equal(o.etag, '"a"');
      return { kind: "not_modified" };
    },
  });
  assert.equal(res.processed?.outcome, "unchanged");
});

test("geänderter Text: alter Stand in norm_versions, Norm überschrieben, Audit", async () => {
  const db = setup();
  let text = reglement("alt");
  const { deps } = stubs(() => text);
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const oldText = text;
  text = reglement("neu");
  makeDue(db);

  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "updated");
  const [version] = db.rows("norm_versions");
  assert.equal(version.text, oldText.trim());
  assert.equal(version.text_sha256, normTextHash(oldText));
  const [norm] = db.rows("norms");
  assert.equal(norm.text, text.trim());
  assert.equal(norm.text_sha256, normTextHash(text));
  assert.ok(db.rows("audit_log").some((a) => a.action === "norm_auto_update"));
});

test("nur anderes PDF bei gleichem Text: nur Hash nachführen", async () => {
  const db = setup();
  const text = reglement("alt");
  const { deps } = stubs(text);
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const oldPdf = doc(db).pdf_sha256;
  makeDue(db);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, {
    ...deps,
    extractText: async () => text,
    fetchDoc: async () => ({ kind: "ok", bytes: Buffer.from("%PDF-anderes-pdf"), etag: null, lastModified: null }),
  });
  assert.equal(res.processed?.outcome, "unchanged");
  assert.notEqual(doc(db).pdf_sha256, oldPdf);
  assert.equal(db.rows("norm_versions").length, 0);
});

test("Schrumpfschutz: stark gekürzter Text lässt den alten Stand stehen", async () => {
  const db = setup();
  let text = reglement("alt", 40);
  const { deps } = stubs(() => text);
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const before = db.rows("norms")[0].text;
  text = reglement("neu", 10);
  makeDue(db);

  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "kept_old");
  assert.equal(db.rows("norms")[0].text, before);
  assert.equal(doc(db).status, "imported");
  assert.equal(doc(db).last_update_status, "rejected_shrink");
  assert.equal(db.rows("norm_versions").length, 0);
  assert.ok(db.rows("audit_log").some((a) => a.action === "norm_auto_update_rejected"));
});

test("kein PDF mehr unter der URL: alter Stand bleibt", async () => {
  const db = setup();
  const { deps } = stubs(reglement("alt"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  makeDue(db);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, {
    ...deps,
    fetchDoc: async () => ({ kind: "rejected", reason: "not_pdf", detail: "HTML" }),
  });
  assert.equal(res.processed?.outcome, "kept_old");
  assert.equal(doc(db).status, "imported");
  assert.equal(db.rows("norms").length, 1);
});

test("manuelle Norm gleichen Titels bleibt unangetastet, ohne Download", async () => {
  const db = setup();
  db.rows("norms").push({
    id: "m1", title: "Bauordnung Zürich", org_id: null, source_kind: null, jurisdiction_type: "municipal",
    jurisdiction_name: "Zürich", text: "manuell",
  });
  const { calls, deps } = stubs(reglement("x"));
  db.rows("oereb_themes")[0].law_links = [link("Bauordnung", BO_URL)];
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "duplicate_manual");
  assert.equal(calls.fetch, 0);
  assert.equal(db.rows("norms").length, 1);
  assert.equal(db.rows("norms")[0].text, "manuell");
  assert.match(String(doc(db).reject_detail), /m1/);
});

test("manuelle Norm mit gleichem Text bei anderem Titel: Duplikat nach dem Download", async () => {
  const db = setup();
  const text = reglement("gleich");
  db.rows("norms").push({
    id: "m1", title: "Reglement über das Bauen", org_id: null, source_kind: null, jurisdiction_type: "municipal",
    jurisdiction_name: "Zürich", text,
  });
  const { calls, deps } = stubs(text);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "duplicate_manual");
  assert.equal(calls.fetch, 1);
  assert.equal(db.rows("norms").length, 1);
});

test("von einem Admin gelöschte Norm kommt nicht zurück", async () => {
  const db = setup();
  const { calls, deps } = stubs(reglement("alt"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  db.setRows("norms", []);
  doc(db).norm_id = null; // ON DELETE SET NULL
  makeDue(db);
  const fetched = calls.fetch;

  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "rejected");
  assert.equal(doc(db).status, "removed");
  assert.equal(calls.fetch, fetched);
  assert.equal(db.rows("norms").length, 0);
});

test("neue URL gleichen Titels übernimmt die Norm, das alte Dokument wird abgelöst", async () => {
  const db = setup([link("Bauordnung Stand 01.01.2020", BO_URL)]);
  let text = reglement("alt");
  const { deps } = stubs(() => text);
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const normId = db.rows("norms")[0].id;
  doc(db).last_seen_at = new Date(Date.now() - 40 * 86_400_000).toISOString();

  const newUrl = "https://oerebdocs.zh.ch/getDoc?docid=99";
  db.rows("oereb_themes")[0].law_links = [link("Bauordnung Stand 01.01.2026", newUrl)];
  text = reglement("neu");
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);

  assert.equal(res.processed?.outcome, "updated");
  assert.equal(db.rows("norms").length, 1);
  assert.equal(doc(db, newUrl).norm_id, normId);
  assert.equal(doc(db, BO_URL).status, "rejected");
  assert.equal(doc(db, BO_URL).reject_reason, "superseded");
  assert.equal(db.rows("norms")[0].title, "Bauordnung Stand 01.01.2026");
  assert.equal(db.rows("norm_versions").length, 1);
});

test("zwei URLs gleichen Titels im Auszug ergeben getrennte Normen (SG), Titel mit Hash", async () => {
  const url2 = "https://oerebdocs.zh.ch/getDoc?docid=2";
  const db = setup([link("Bauordnung", BO_URL), link("Bauordnung", url2)]);
  let n = 0;
  const { deps } = stubs(() => reglement(`teil${++n}`));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "imported");
  const titles = db.rows("norms").map((x) => String(x.title));
  assert.equal(titles.length, 2);
  assert.ok(titles.includes("Bauordnung"));
  assert.ok(titles.some((t) => /^Bauordnung \[[0-9a-f]{6}\]$/.test(t)));
});

test("gleicher Text unter zweiter URL ergibt keine zweite Norm (VS Sion)", async () => {
  const url2 = "https://oerebdocs.zh.ch/getDoc?docid=2";
  const db = setup([link("Bauordnung", BO_URL), link("Baureglement Stadt", url2)]);
  const { deps } = stubs(reglement("gleich"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "rejected");
  assert.equal(doc(db, url2).reject_reason, "duplicate_content");
  assert.equal(db.rows("norms").length, 1);
});

test("objektbezogene Vorschrift: scope parcel, gleicher Titel löst keine fremde Norm ab", async () => {
  const urlA = "https://oereblex.zh.ch/a";
  const db = setup([link("Quartierplan", urlA)]);
  let text = reglement("A");
  const { deps } = stubs(() => text);
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(db.rows("norms")[0].auto_scope, "parcel");

  const urlB = "https://oereblex.zh.ch/b";
  db.rows("oereb_themes")[0].law_links = [link("Quartierplan", urlB)];
  text = reglement("B");
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "imported");
  assert.equal(db.rows("norms").length, 2);
  assert.equal(doc(db, urlA).status, "imported");
});

test("Deckel: zählt nur municipal, Objektvorschriften und Haupterlass sind frei, nicht endgültig", async () => {
  const urls = Array.from({ length: 5 }, (_, i) => `https://oereblex.zh.ch/q${i}`);
  const db = setup([
    link("Quartierplan A", urls[0]),
    link("Änderung Bauordnung 1", urls[1]),
    link("Änderung Bauordnung 2", urls[2]),
    link("Bauordnung", urls[3]),
  ]);
  db.rows("oereb_import_filters").push({ scope: "default", rules: { max_accepted_per_municipality: 2 }, active: true });
  let n = 0;
  const { deps } = stubs(() => reglement(`t${++n}`));
  for (let i = 0; i < 4; i++) await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(doc(db, urls[3]).status, "imported");
  assert.equal(doc(db, urls[1]).status, "imported");
  assert.equal(doc(db, urls[2]).reject_reason, "cap_reached");
  assert.equal(doc(db, urls[0]).status, "imported", "parcel zählt nicht");

  // Ein später auftauchender Haupterlass wird trotz Deckel importiert.
  db.rows("oereb_themes")[0].law_links = [...(db.rows("oereb_themes")[0].law_links as ReturnType<typeof link>[]), link("Baureglement Stadt", urls[4])];
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(doc(db, urls[4]).status, "imported");

  // Wird der Deckel frei, kommt das abgelehnte Dokument wieder an die Reihe.
  doc(db, urls[1]).status = "rejected";
  doc(db, urls[3]).status = "rejected";
  doc(db, urls[4]).status = "rejected";
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 1);
  assert.equal(doc(db, urls[2]).status, "pending");
});

test("Inhaltsfilter: jeder Grund wird gespeichert, keine Norm", async () => {
  const cases: [string, string][] = [
    ["kurz", "scan_or_short"],
    ["PROTOKOLL DES REGIERUNGSRATS " + reglement("x"), "decision_document"],
    ["Nur Text ohne Gliederung. ".repeat(300), "no_articles"],
    [reglement("lang", 2000), "too_long"],
  ];
  for (const [text, reason] of cases) {
    resetImportFilterCache();
    const db = setup();
    const { deps } = stubs(text);
    const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
    assert.equal(res.processed?.outcome, "rejected", reason);
    assert.equal(doc(db).reject_reason, reason);
    assert.ok(doc(db).filter_snapshot);
    assert.equal(db.rows("norms").length, 0);
  }
});

test("unlesbares PDF wird als Grund gespeichert", async () => {
  const db = setup();
  const { deps } = stubs("x", {
    extractText: async () => {
      throw new Error("verschlüsselt");
    },
  });
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(doc(db).reject_reason, "pdf_unreadable");
});

test("Abruffehler: failed mit Backoff, blockiert nicht und zählt erst später wieder", async () => {
  const db = setup();
  const { deps } = stubs("x", { fetchDoc: async () => ({ kind: "failed", detail: "HTTP 503" }) });
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "failed");
  assert.equal(res.remaining, 0);
  assert.equal(doc(db).status, "failed");
  assert.equal(doc(db).lock_until, null);
  const hours = (Date.parse(doc(db).next_check_at as string) - Date.now()) / 3_600_000;
  assert.ok(hours > 1.9 && hours <= 2);
});

test("Absturz mitten im Import: bis zum Backoff nicht fällig, ab 3 Versuchen failed", async () => {
  const db = setup();
  await countPendingDocuments(db.asClient(), "p1");
  const row = doc(db) as { id: string; attempts: number; status: string };

  // Lauf stirbt nach der Sperre, niemand schreibt mehr.
  await acquireDocumentLock(db.asClient(), row);
  assert.equal(doc(db).attempts, 1);
  assert.ok(Date.parse(doc(db).next_check_at as string) > Date.now() + 3_600_000);
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 1, "gesperrt zählt als in Arbeit");
  doc(db).lock_until = new Date(Date.now() - 1000).toISOString();
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 0, "nach Absturz nicht sofort wieder");

  makeDue(db);
  await acquireDocumentLock(db.asClient(), doc(db) as typeof row);
  assert.equal(doc(db).status, "pending");
  doc(db).lock_until = null;
  makeDue(db);
  await acquireDocumentLock(db.asClient(), doc(db) as typeof row);
  assert.equal(doc(db).status, "failed");
  assert.equal(doc(db).attempts, 3);
});

test("unerwarteter Fehler entsperrt das Dokument", async () => {
  const db = setup();
  const { deps } = stubs("x", {
    fetchDoc: async () => {
      throw new Error("kaputt");
    },
  });
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "failed");
  assert.equal(doc(db).status, "failed");
  assert.equal(doc(db).lock_until, null);
});

test("Sperre: von zwei Aufrufen erhält nur einer die Zeile", async () => {
  const db = setup();
  await countPendingDocuments(db.asClient(), "p1");
  const row = doc(db) as { id: string; attempts: number };
  const [a, b] = await Promise.all([acquireDocumentLock(db.asClient(), row), acquireDocumentLock(db.asClient(), row)]);
  assert.equal([a, b].filter(Boolean).length, 1);
});

test("Sperre: abgelaufene Sperre ist wieder frei, künftige Prüfung nicht", async () => {
  const db = setup();
  await countPendingDocuments(db.asClient(), "p1");
  const row = doc(db) as { id: string; attempts: number; lock_until: string | null; next_check_at: string };
  row.lock_until = new Date(Date.now() - 1000).toISOString();
  assert.ok(await acquireDocumentLock(db.asClient(), row));
  row.lock_until = null;
  row.next_check_at = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(await acquireDocumentLock(db.asClient(), row), null);
});

test("zwei gleichzeitige Syncs laden höchstens einmal, der zweite meldet in_progress", async () => {
  const db = setup();
  const { calls, deps } = stubs(reglement("alt"));
  const [a, b] = await Promise.all([
    syncNextDocument(db.asClient(), "p1", ACTOR, deps),
    syncNextDocument(db.asClient(), "p1", ACTOR, deps),
  ]);
  assert.equal(calls.fetch, 1);
  assert.equal(db.rows("norms").length, 1);
  assert.equal([a, b].filter((r) => r.in_progress).length, 1);
});

test("nachgetragene Filterzeile wirkt auf bekannte Dokumente, ohne Schleife", async () => {
  const url = "https://www.andere-gemeinde.ch/doc.pdf";
  const db = setup([link("Bauordnung", url)]);
  const { calls, deps } = stubs(reglement("x"));
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 0);
  assert.equal(doc(db, url).reject_reason, "host_not_allowed");

  db.rows("oereb_import_filters").push({ scope: "ZH", rules: { allowed_hosts_add: ["www.andere-gemeinde.ch"] }, active: true });
  resetImportFilterCache();
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 1);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "imported");
  assert.equal(calls.fetch, 1);
});

test("inhaltlich abgelehntes PDF wird nicht neu geladen, auch nicht nach einer Filteränderung", async () => {
  const db = setup();
  const { calls, deps } = stubs("kurz");
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal((await syncNextDocument(db.asClient(), "p1", ACTOR, deps)).processed, null);
  db.rows("oereb_import_filters").push({ scope: "default", rules: { min_text_chars: 1 }, active: true });
  resetImportFilterCache();
  assert.equal((await syncNextDocument(db.asClient(), "p1", ACTOR, deps)).processed, null);
  assert.equal(calls.fetch, 1);
  assert.equal(doc(db).reject_reason, "scan_or_short");
});

test("ohne Migration: available false, kein Fehler", async () => {
  const db = setup();
  db.missing.add("oereb_documents");
  db.missing.add("oereb_import_filters");
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, stubs("x").deps);
  assert.deepEqual(res, { available: false, processed: null, in_progress: false, remaining: 0 });
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 0);
});

test("Norm, die jemand zur manuellen gemacht hat, wird nicht überschrieben", async () => {
  const db = setup();
  let text = reglement("alt");
  const { deps } = stubs(() => text);
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  db.rows("norms")[0].source_kind = null;
  const before = db.rows("norms")[0].text;
  text = reglement("neu");
  makeDue(db);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "kept_old");
  assert.equal(db.rows("norms")[0].text, before);
});

// ── Einschleusen globaler Normen (Sicherheit, B1) ────────────────────────────
// Die Datenbankseite (RLS, Rechte, Trigger) lässt sich hier nicht testen, siehe geoportal-security.test.ts.

test("Auszug ohne Server-Stempel speist keinen Import (vom Client geschrieben oder Altbestand)", async () => {
  const db = setup();
  db.rows("oereb_extracts")[0].server_fetched_at = null;
  const { calls, deps } = stubs(reglement("boese"));
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 0);
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed, null);
  assert.equal(calls.fetch, 0);
  assert.equal(db.rows("oereb_documents").length, 0);
  assert.equal(db.rows("norms").length, 0);
});

test("Manipulierter Standort des Projekts: Kanton, Gemeinde und BFS der Norm kommen aus dem Auszug", async () => {
  const db = setup();
  Object.assign(db.rows("projects")[0], { location: { canton: "EVIL", municipality: "Fremdstadt" }, bfs_number: 9999 });
  const { deps } = stubs(reglement("x"));
  const res = await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(res.processed?.outcome, "imported");
  const [norm] = db.rows("norms");
  assert.equal(norm.jurisdiction_canton, "ZH");
  assert.equal(norm.jurisdiction_name, "Zürich");
  assert.equal(norm.jurisdiction_bfs, 261);
  assert.equal(doc(db).canton, "ZH");
  assert.equal(doc(db).bfs_number, 261);
});

test("Host eines Scheinkantons aus dem Projekt wird nicht erlaubt", async () => {
  const db = setup([link("Bauordnung", "https://reglemente.evil.ch/a.pdf")]);
  db.rows("projects")[0].location = { canton: "EVIL", municipality: "x" };
  const { calls, deps } = stubs(reglement("boese"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  assert.equal(calls.fetch, 0);
  assert.equal(doc(db, "https://reglemente.evil.ch/a.pdf").reject_reason, "host_not_allowed");
  assert.equal(db.rows("norms").length, 0);
});

test("Ungültiger Kanton im Auszug: kein Import", async () => {
  const db = setup([link("Bauordnung", "https://reglemente.evil.ch/a.pdf")]);
  db.rows("oereb_extracts")[0].canton = "EVIL";
  const { calls, deps } = stubs(reglement("boese"));
  assert.equal((await syncNextDocument(db.asClient(), "p1", ACTOR, deps)).processed, null);
  assert.equal(calls.fetch, 0);
  assert.equal(db.rows("oereb_documents").length, 0);
});

test("Auszug ohne BFS oder Gemeinde: kein Import, auch wenn das Projekt eine BFS hat", async () => {
  const db = setup();
  db.rows("oereb_extracts")[0].raw = { RealEstate: {} };
  const { calls, deps } = stubs(reglement("x"));
  assert.equal((await syncNextDocument(db.asClient(), "p1", ACTOR, deps)).processed, null);
  assert.equal(calls.fetch, 0);
});

test("Auszug im Fehlerstatus: kein Import", async () => {
  const db = setup();
  db.rows("oereb_extracts")[0].status = "unreachable";
  const { calls, deps } = stubs(reglement("x"));
  assert.equal((await syncNextDocument(db.asClient(), "p1", ACTOR, deps)).processed, null);
  assert.equal(calls.fetch, 0);
});

test("Nicht rechtskräftig: öffentliche Auflage und Vorprüfung gehen nicht weiter, auch mit positivem Titel", async () => {
  const urls = ["https://oereblex.zh.ch/a", "https://oereblex.zh.ch/b"];
  const db = setup([
    link("Teilrevision Bauordnung und Zonenplan 2021 (in Vorprüfung)", urls[0]),
    link("Anpassungen BZR Teilrevision, öffentliche Auflage", urls[1]),
  ]);
  assert.equal(await countPendingDocuments(db.asClient(), "p1"), 0);
  assert.equal(doc(db, urls[0]).reject_reason, "not_in_force");
  assert.equal(doc(db, urls[1]).reject_reason, "not_in_force");
});

// ── Ablösung alter Fassungen ─────────────────────────────────────────────────

const OLD = BO_URL;
const NEW = "https://oerebdocs.zh.ch/getDoc?docid=99";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Reglement importiert, danach liefert der Auszug eine neue URL, die ebenfalls importiert wird. */
async function revised() {
  const db = setup([link("Bauordnung Stand 2020", OLD)]);
  let n = 0;
  const { deps } = stubs(() => reglement(`v${++n}`));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  db.rows("oereb_themes")[0].law_links = [link("Bauordnung Stand 2026", NEW)];
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const norm = (url: string) => db.rows("norms").find((x) => x.id === doc(db, url).norm_id) as Record<string, unknown>;
  return { db, norm };
}

test("Revision: zuerst getrennte Normen, nach der Frist wird die alte Fassung ohne Download abgelöst", async () => {
  const { db, norm } = await revised();
  assert.equal(db.rows("norms").length, 2);
  assert.equal(doc(db, OLD).status, "imported", "Frist läuft noch");

  const oldNorm = norm(OLD);
  db.rows("project_norms").push(
    { project_id: "p1", norm_id: oldNorm.id, added_by: "system" },
    { project_id: "p2", norm_id: oldNorm.id, added_by: "oereb" },
    { project_id: "p3", norm_id: oldNorm.id, added_by: "user" }
  );
  doc(db, OLD).last_seen_at = daysAgo(40);
  await countPendingDocuments(db.asClient(), "p1");

  assert.equal(doc(db, OLD).status, "rejected");
  assert.equal(doc(db, OLD).reject_reason, "superseded");
  assert.equal(oldNorm.auto_scope, "superseded");
  assert.deepEqual(db.rows("project_norms").map((r) => r.added_by), ["user"]);
  assert.equal(norm(NEW).auto_scope, "municipal");
  assert.equal(db.rows("norms").length, 2, "Norm bleibt zum Nachvollzug");
});

test("Blosses Öffnen hält die alte Fassung nicht frisch, nur ein Abruf", async () => {
  const db = setup();
  const { deps } = stubs(reglement("x"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  const before = daysAgo(10);
  doc(db).last_seen_at = before;
  db.rows("oereb_extracts")[0].server_fetched_at = before;
  await countPendingDocuments(db.asClient(), "p1");
  assert.equal(doc(db).last_seen_at, before, "ohne neuen Abruf bleibt der Wert");

  db.rows("oereb_extracts")[0].server_fetched_at = new Date().toISOString();
  await countPendingDocuments(db.asClient(), "p1");
  assert.equal(doc(db).last_seen_at, db.rows("oereb_extracts")[0].server_fetched_at);
});

test("Fusion: alte URL kürzlich anderswo abgerufen, keine Ablösung; drei Fehlversuche lösen ab", async () => {
  const { db } = await revised();
  doc(db, OLD).last_seen_at = daysAgo(3);
  await countPendingDocuments(db.asClient(), "p1");
  assert.equal(doc(db, OLD).status, "imported");

  Object.assign(doc(db, OLD), { last_update_status: "fetch_failed", attempts: 3 });
  await countPendingDocuments(db.asClient(), "p1");
  assert.equal(doc(db, OLD).reject_reason, "superseded");
});

test("Ohne Nachfolger im eigenen Auszug bleibt eine lange ungesehene Fassung", async () => {
  const db = setup();
  const { deps } = stubs(reglement("x"));
  await syncNextDocument(db.asClient(), "p1", ACTOR, deps);
  doc(db).last_seen_at = daysAgo(90);
  db.rows("oereb_themes")[0].law_links = [link("Anderes Baureglement", NEW, "Law")];
  await countPendingDocuments(db.asClient(), "p1");
  assert.equal(doc(db).status, "imported");
});

test("Manuell übernommene Norm wird nicht abgelöst", async () => {
  const { db, norm } = await revised();
  const oldNorm = norm(OLD);
  oldNorm.source_kind = null;
  doc(db, OLD).last_seen_at = daysAgo(40);
  await countPendingDocuments(db.asClient(), "p1");
  assert.equal(oldNorm.auto_scope, "municipal");
  assert.equal(doc(db, OLD).status, "imported");
});

test("Liefert ein späterer Abruf die abgelöste URL doch noch, gilt sie wieder (Ortsteil ohne Projekte)", async () => {
  const { db, norm } = await revised();
  const oldNorm = norm(OLD);
  doc(db, OLD).last_seen_at = daysAgo(40);
  await countPendingDocuments(db.asClient(), "p1");
  assert.equal(oldNorm.auto_scope, "superseded");

  db.rows("oereb_themes")[0].law_links = [link("Bauordnung Stand 2020", OLD)];
  doc(db, OLD).last_checked_at = daysAgo(1);
  db.rows("oereb_extracts")[0].server_fetched_at = new Date().toISOString();
  await countPendingDocuments(db.asClient(), "p1");
  assert.equal(doc(db, OLD).status, "imported");
  assert.equal(oldNorm.auto_scope, "municipal");
});
