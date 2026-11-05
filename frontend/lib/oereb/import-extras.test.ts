/** Scans, neutrale Titel und Admin-Entscheide im ganzen Importablauf, gegen Attrappen. Kein Netz, kein Modell. */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { FakeSupabase } from "./fake-supabase";
import type { OcrClient } from "./document-ocr";
import { syncNextDocument, type ImportDeps } from "./document-import";
import { resetImportFilterCache, syncProjectDocuments } from "./documents";
import { DEFAULT_IMPORT_FILTER, isOcrCandidate, mergeFilterRules, neutralScopeEvidence, scopeOf } from "./import-filter";
import { ForceBlockedError, setDocumentDecision } from "./manual-decision";

const ACTOR = { id: "user-1", email: "a@example.ch" };
const URL_A = "https://oereblex.ar.ch/api/attachments/2266";
const RULES = DEFAULT_IMPORT_FILTER;
const ZONES = "Wohnzone Gewerbezone Industriezone Kernzone Landwirtschaftszone";

function ordnung(articles = 40, head = "Der Einwohnerrat der Gemeinde Herisau erlässt"): string {
  return `${head}\n${ZONES}\n` + Array.from({ length: articles }, (_, i) => `Art. ${i + 1} Bestimmung ${"Text ".repeat(20)}`).join("\n");
}

const SCAN = "\n-- 1 of 5 --\n\n-- 2 of 5 --\n\n-- 3 of 5 --\n\n-- 4 of 5 --\n\n-- 5 of 5 --\n";
const transcript = () => {
  const articles = Array.from({ length: 30 }, (_, i) => `Art. ${i + 1} Bestimmung ${"Text ".repeat(30)}`);
  return `${ZONES}\n` + [0, 1, 2, 3, 4].map((p) => `${articles.slice(p * 6, p * 6 + 6).join("\n")}\n-- ${p + 1} of 5 --`).join("\n");
};

function setup(opts: { title?: string; url?: string; authority?: string; theme?: string; rules?: Record<string, unknown>; stamped?: boolean } = {}) {
  const db = new FakeSupabase();
  db.rows("oereb_extracts").push({
    id: "e1", project_id: "p1", status: "ok", canton: "AR",
    server_fetched_at: opts.stamped === false ? null : new Date().toISOString(),
    raw: { RealEstate: { MunicipalityCode: 3001, MunicipalityName: "Herisau" } },
  });
  db.rows("oereb_themes").push({
    id: "t1", extract_id: "e1", theme_code: opts.theme ?? "ch.Nutzungsplanung", concern: "affects",
    law_links: [{ title: opts.title ?? "Herisau", url: opts.url ?? URL_A, kind: "LegalProvision", authority: opts.authority ?? "Gemeindeverwaltung" }],
  });
  if (opts.rules) db.rows("oereb_import_filters").push({ scope: "default", rules: opts.rules, active: true });
  return db;
}

function fakeModel(text: string | (() => string) = transcript) {
  const calls = { stream: 0 };
  const output = () => (typeof text === "function" ? text() : text);
  const client = {
    messages: {
      countTokens: async () => ({ input_tokens: 10_000 }),
      stream: () => {
        calls.stream++;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "message_start", message: { usage: { input_tokens: 10_000, output_tokens: 1 } } };
          },
          finalMessage: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 10_000, output_tokens: 5000 }, content: [{ type: "text", text: output() }] }),
        };
      },
    },
  } as unknown as OcrClient;
  return { client, calls };
}

function deps(pdfText: string, model?: OcrClient): ImportDeps & { fetches: () => number } {
  let fetches = 0;
  return {
    fetches: () => fetches,
    fetchDoc: async () => {
      fetches++;
      return { kind: "ok", bytes: Buffer.from(`%PDF-${pdfText}`), etag: null, lastModified: null };
    },
    extractText: async (bytes) => bytes.toString().slice(5),
    ocrClient: model,
  };
}

const row = (db: FakeSupabase) => db.rows("oereb_documents")[0] as Record<string, unknown>;
const makeDue = (db: FakeSupabase) => {
  row(db).next_check_at = new Date(Date.now() - 1000).toISOString();
};
const run = (db: FakeSupabase, d: ImportDeps) => syncNextDocument(db.asClient(), "p1", ACTOR, d);

beforeEach(() => resetImportFilterCache());

// ── Regeln ───────────────────────────────────────────────────────────────────

test("Standard: Lesen ist aus, nur ein echtes Boolean schaltet es ein", () => {
  assert.equal(RULES.ocr_enabled, false);
  assert.equal(mergeFilterRules(RULES, { ocr_enabled: "true" }).ocr_enabled, false);
  assert.equal(mergeFilterRules(RULES, { ocr_enabled: 1 }).ocr_enabled, false);
  assert.equal(mergeFilterRules(RULES, { ocr_enabled: true, ocr_max_pages: 10, ocr_max_cost_usd: 1 }).ocr_max_pages, 10);
});

test("Kandidat zum Lesen: Titel oder Thema, aber kein Plan", () => {
  const theme = { theme_codes: ["ch.Nutzungsplanung"] };
  assert.ok(isOcrCandidate({ title: "Baureglement", theme_codes: ["ch.Anderes"] }, RULES));
  assert.ok(isOcrCandidate({ title: "Reglement", ...theme }, RULES));
  assert.ok(!isOcrCandidate({ title: "Reglement", theme_codes: ["ch.Waldabstandslinien"] }, RULES));
  assert.ok(!isOcrCandidate({ title: "Quartierplan Gutenberg", ...theme }, RULES));
  assert.ok(!isOcrCandidate({ title: "Plan", ...theme }, RULES));
  // Quarten 17830: wird gelesen, das Thema belegt aber keine Gemeindeordnung.
  const quarten = { title: "Reglement", theme_codes: ["ch.SG.SchutzverordnungKulturgueter"], authority: "Gemeindeverwaltung" };
  assert.ok(isOcrCandidate(quarten, RULES));
  assert.equal(neutralScopeEvidence(quarten, ordnung(), RULES), null);
});

test("Neutraler Titel: alle Belege nötig", () => {
  const herisau = { title: "Herisau", theme_codes: ["ch.Nutzungsplanung"], authority: "Gemeindeverwaltung" };
  assert.match(neutralScopeEvidence(herisau, ordnung(), RULES) ?? "", /40 fortlaufende Artikel/);
  assert.equal(neutralScopeEvidence({ ...herisau, theme_codes: ["ch.AR.Sondernutzungsplaene"] }, ordnung(), RULES), null, "Thema");
  assert.equal(neutralScopeEvidence({ ...herisau, authority: "Amt für Raum und Wald" }, ordnung(), RULES), null, "Behörde");
  assert.equal(neutralScopeEvidence(herisau, ordnung(10), RULES), null, "zu wenige Artikel");
  assert.equal(neutralScopeEvidence(herisau, `Wohnzone\n${ordnung(40).replace(ZONES, "")}`, RULES), null, "keine Zonenordnung");
  assert.equal(neutralScopeEvidence({ ...herisau, title: "Quartierplan Gutenberg" }, ordnung(), RULES), null, "Plan im Titel");
  assert.equal(neutralScopeEvidence({ ...herisau, title: "Reglement zur Schutzverordnung" }, ordnung(), RULES), null, "Schutzverordnung im Titel");
  assert.equal(
    neutralScopeEvidence({ ...herisau, title: "Reglement" }, ordnung(40, "Schutzverordnung der Gemeinde Quarten"), RULES),
    null,
    "«Reglement» zur Schutzverordnung bleibt parcel"
  );
  assert.equal(neutralScopeEvidence({ ...herisau, title: "Zentrum" }, ordnung(40, "Stadt Liestal Teilzonenreglement Zentrum"), RULES), null, "Teilzone");
});

// ── Neutrale Titel im Ablauf ─────────────────────────────────────────────────

test("Neutraler Titel mit Beleg: neue Norm gilt gemeindeweit, mit Begründung", async () => {
  const db = setup();
  await run(db, deps(ordnung()));
  assert.equal(row(db).status, "imported");
  assert.equal(row(db).scope, "municipal");
  assert.match(String(row(db).scope_reason), /Neutraler Titel/);
  assert.equal(db.rows("norms")[0].auto_scope, "municipal");
});

test("«Reglement» zur Schutzverordnung bleibt parcel", async () => {
  const db = setup({ title: "Reglement" });
  await run(db, deps(ordnung(40, "Schutzverordnung der Gemeinde")));
  assert.equal(row(db).status, "imported");
  assert.equal(row(db).scope, "parcel");
  assert.equal(db.rows("norms")[0].auto_scope, "parcel");
});

test("Schon als parcel importiert: Beförderung ohne neues PDF", async () => {
  const db = setup();
  const d = deps(ordnung());
  await run(db, d);
  // Stand vor dieser Regel nachstellen.
  Object.assign(row(db), { scope: "parcel", scope_reason: null });
  db.rows("norms")[0].auto_scope = "parcel";
  makeDue(db);
  const assigned: string[] = [];
  await run(db, { ...d, assignNew: async (id) => { assigned.push(id); } });
  assert.equal(row(db).scope, "municipal");
  assert.equal(db.rows("norms")[0].auto_scope, "municipal");
  assert.deepEqual(assigned, [db.rows("norms")[0].id], "Zuweisung wird neu berechnet");
});

// ── Scans ────────────────────────────────────────────────────────────────────

test("Lesen aus: Scan bleibt abgelehnt, kein Modellaufruf", async () => {
  const db = setup({ title: "Baureglement" });
  const model = fakeModel();
  await run(db, deps(SCAN, model.client));
  assert.equal(row(db).reject_reason, "scan_or_short");
  assert.equal(model.calls.stream, 0);
  assert.equal(row(db).ocr_status, null);
});

test("Lesen an: Text wird Norm, markiert, Kosten gespeichert, kein zweiter Lauf", async () => {
  const db = setup({ title: "Baureglement", rules: { ocr_enabled: true } });
  const model = fakeModel();
  const d = deps(SCAN, model.client);
  await run(db, d);
  assert.equal(row(db).status, "imported");
  assert.equal(row(db).text_source, "ai_read");
  assert.equal(row(db).ocr_status, "read");
  assert.equal(row(db).ocr_cost_usd, (10_000 * 4 + 5000 * 20) / 1e6);
  assert.equal(db.rows("norms")[0].text_read_by_ai, true);
  assert.equal(db.rows("norms")[0].org_id, null, "global, für alle Organisationen");

  makeDue(db);
  await run(db, d);
  assert.equal(model.calls.stream, 1, "dasselbe PDF wird nie zweimal gelesen");
});

test("Plan unter dem Thema Nutzungsplanung wird nicht gelesen", async () => {
  const db = setup({ title: "Quartierplan Gutenberg", rules: { ocr_enabled: true } });
  const model = fakeModel();
  await run(db, deps(SCAN, model.client));
  assert.equal(model.calls.stream, 0);
});

test("Gelesener Text läuft durch den Inhaltstest", async () => {
  const db = setup({ title: "Baureglement", rules: { ocr_enabled: true } });
  const brief = `${"Keine Artikel hier. ".repeat(300)}\n` + [1, 2, 3, 4, 5].map((p) => `-- ${p} of 5 --`).join("\n");
  const model = fakeModel(brief);
  await run(db, deps(SCAN, model.client));
  assert.equal(row(db).status, "rejected");
  assert.equal(row(db).reject_reason, "no_articles");
  assert.equal(db.rows("norms").length, 0);
  assert.ok(Number(row(db).ocr_cost_usd) > 0, "Kosten bleiben auch bei Ablehnung");
});

test("Schrumpfschutz gilt auch für gelesenen Text", async () => {
  const db = setup({ title: "Baureglement", rules: { ocr_enabled: true } });
  let pdf = ordnung(200);
  const model = fakeModel(() => `${ZONES}\n${Array.from({ length: 6 }, (_, i) => `Art. ${i + 1} ${"Text ".repeat(120)}`).join("\n")}\n` + [1, 2, 3, 4, 5].map((p) => `-- ${p} of 5 --`).join("\n"));
  const d: ImportDeps = {
    fetchDoc: async () => ({ kind: "ok", bytes: Buffer.from(`%PDF-${pdf}`), etag: null, lastModified: null }),
    extractText: async (b) => b.toString().slice(5),
    ocrClient: model.client,
  };
  await run(db, d);
  const before = db.rows("norms")[0].text;
  pdf = SCAN; // Neue Fassung ist nur noch ein Scan, viel kürzer gelesen.
  makeDue(db);
  await run(db, d);
  assert.equal(model.calls.stream, 1);
  assert.equal(db.rows("norms")[0].text, before);
  assert.equal(row(db).last_update_status, "rejected_shrink");
});

test("Absturz während des Lesens: Versuch steht fest, kein zweiter Lauf", async () => {
  const db = setup({ title: "Baureglement", rules: { ocr_enabled: true } });
  const model = fakeModel();
  await run(db, deps(SCAN, model.client));
  // Lauf stirbt nach dem Festhalten: Zustand wie nach einem Funktionsabbruch.
  Object.assign(row(db), { status: "pending", norm_id: null, ocr_status: "started", ocr_cost_usd: null });
  db.setRows("norms", []);
  makeDue(db);
  await run(db, deps(SCAN, model.client));
  assert.equal(model.calls.stream, 1);
  assert.equal(row(db).ocr_status, "failed");
  assert.match(String(row(db).ocr_detail), /aborted/);
});

test("Regel eingeschaltet: schon abgelehnter Scan kommt einmal dran", async () => {
  const db = setup({ title: "Baureglement" });
  const model = fakeModel();
  const d = deps(SCAN, model.client);
  await run(db, d);
  assert.equal(row(db).reject_reason, "scan_or_short");

  db.rows("oereb_import_filters").push({ scope: "default", rules: { ocr_enabled: true }, active: true });
  resetImportFilterCache();
  await run(db, d);
  assert.equal(row(db).status, "imported");
  assert.equal(model.calls.stream, 1);
});

test("Vor der Migration: nie lesen, denn der Versuch liesse sich nicht festhalten", async () => {
  const db = setup({ title: "Baureglement", rules: { ocr_enabled: true } });
  const model = fakeModel();
  const d = deps(SCAN, model.client);
  await syncProjectDocuments(db.asClient(), "p1");
  delete row(db).ocr_status;
  await run(db, d);
  assert.equal(model.calls.stream, 0);
});

// ── Admin-Entscheide ─────────────────────────────────────────────────────────

test("Unbekanntes Dokument und laufender Import werden abgewiesen", async () => {
  const db = setup();
  await run(db, deps(ordnung()));
  assert.equal((await setDocumentDecision(db.asClient(), "gibt-es-nicht", "exclude") as { error: string }).error, "not_found");
  row(db).lock_until = new Date(Date.now() + 60_000).toISOString();
  assert.equal((await setDocumentDecision(db.asClient(), String(row(db).id), "exclude") as { error: string }).error, "locked");
});

test("exclude: Norm gilt nicht mehr, Uploads wieder frei, bleibt nach späteren Abrufen", async () => {
  const db = setup({ title: "Baureglement" });
  const d = deps(ordnung());
  await run(db, d);
  const normId = db.rows("norms")[0].id;
  db.rows("norms").push({ id: "upload", org_id: "o1", superseded_by_norm_id: normId, superseded_similarity: 0.9, superseded_at: "x" });
  db.rows("project_norms").push({ norm_id: normId, added_by: "system" });

  const result = await setDocumentDecision(db.asClient(), String(row(db).id), "exclude");
  assert.ok(result.ok);
  assert.equal(row(db).reject_reason, "manual_exclude");
  assert.equal(db.rows("norms")[0].auto_scope, "superseded");
  assert.equal(db.rows("project_norms").length, 0);
  assert.equal(db.rows("norms")[1].superseded_by_norm_id, null);

  makeDue(db);
  db.rows("oereb_import_filters").push({ scope: "default", rules: { title_positive_add: ["neu"] }, active: true });
  resetImportFilterCache();
  const fetchesBefore = d.fetches();
  await run(db, d);
  assert.equal(row(db).status, "rejected");
  assert.equal(row(db).manual_decision, "exclude");
  assert.equal(d.fetches(), fetchesBefore, "kein Download");
});

test("force_import: übersteuert Filter, Audit wie jede neue globale Norm, bleibt bestehen", async () => {
  const db = setup({ title: "Verschiedene Vorschriften" });
  const d = deps(`${"Ohne Artikel. ".repeat(300)}`);
  await run(db, d);
  assert.equal(row(db).reject_reason, "no_articles");

  const result = await setDocumentDecision(db.asClient(), String(row(db).id), "force_import");
  assert.ok(result.ok);
  assert.equal(row(db).status, "pending");
  await run(db, d);
  assert.equal(row(db).status, "imported");
  assert.equal(row(db).scope, "parcel", "der Entscheid macht nichts gemeindeweit");
  const norm = db.rows("norms")[0];
  assert.equal(norm.org_id, null);
  const audit = db.rows("audit_log").find((a) => a.action === "norm_auto_import") as { meta: Record<string, unknown>; target_id?: string } | undefined;
  assert.ok(audit, "neue globale Norm ist auditiert");
  assert.equal(audit?.meta.forced, true);

  db.rows("oereb_import_filters").push({ scope: "default", rules: { min_article_run: 6 }, active: true });
  resetImportFilterCache();
  makeDue(db);
  await run(db, d);
  assert.equal(row(db).status, "imported", "Regeländerung nimmt den Entscheid nicht zurück");
  assert.equal(row(db).manual_decision, "force_import");
});

test("force_import: Titelfilter aufgehoben, Host nie", async () => {
  const db = setup({ title: "Zonenplan" });
  const d = deps(ordnung());
  await run(db, d);
  assert.equal(row(db).reject_reason, "title_negative");
  assert.ok((await setDocumentDecision(db.asClient(), String(row(db).id), "force_import")).ok);
  await run(db, d);
  assert.equal(row(db).status, "imported");
});

for (const reason of ["private_address", "host_not_allowed", "too_many_redirects", "too_large", "not_pdf"]) {
  test(`force_import: ${reason} wird klar abgewiesen und ändert nichts`, async () => {
    const db = setup({ title: "Baureglement" });
    await run(db, deps(ordnung()));
    Object.assign(row(db), { status: "rejected", reject_reason: reason, norm_id: null });
    await assert.rejects(
      setDocumentDecision(db.asClient(), String(row(db).id), "force_import"),
      (e: unknown) => e instanceof ForceBlockedError && e.code === "force_blocked" && e.reason === reason
    );
    assert.equal(row(db).manual_decision, null);
    assert.equal(row(db).reject_reason, reason);
  });
}

test("force_import: fremder Host wird auch bei anderem Ablehnungsgrund abgewiesen", async () => {
  const db = setup({ title: "Zonenplan", url: "https://evil.example.com/x.pdf" });
  await run(db, deps(ordnung()));
  assert.equal(row(db).reject_reason, "title_negative");
  await assert.rejects(
    setDocumentDecision(db.asClient(), String(row(db).id), "force_import"),
    (e: unknown) => e instanceof ForceBlockedError && e.reason === "host_not_allowed"
  );
});

test("force_import: ohne Herkunftsnachweis server_fetched_at abgewiesen", async () => {
  const db = setup({ title: "Zonenplan" });
  await run(db, deps(ordnung()));
  row(db).last_seen_at = null;
  await assert.rejects(
    setDocumentDecision(db.asClient(), String(row(db).id), "force_import"),
    (e: unknown) => e instanceof ForceBlockedError && e.reason === "no_provenance"
  );
});

test("force_import: Abruf lehnt zur Laufzeit ab, der Entscheid hebt das nicht auf", async () => {
  const db = setup({ title: "Zonenplan" });
  const d = deps(ordnung());
  await run(db, d);
  await setDocumentDecision(db.asClient(), String(row(db).id), "force_import");
  await run(db, { ...d, fetchDoc: async () => ({ kind: "rejected", reason: "not_pdf", detail: "kein PDF" }) });
  assert.equal(row(db).status, "rejected");
  assert.equal(row(db).reject_reason, "not_pdf");
  assert.equal(db.rows("norms").length, 0);
});

test("recheck: hebt exclude auf, Norm gilt wieder, Zuweisung wird neu berechnet", async () => {
  const db = setup({ title: "Baureglement" });
  const d = deps(ordnung());
  await run(db, d);
  await setDocumentDecision(db.asClient(), String(row(db).id), "exclude");
  const result = await setDocumentDecision(db.asClient(), String(row(db).id), "recheck");
  assert.ok(result.ok);
  assert.equal(row(db).manual_decision, null);
  assert.equal(row(db).status, "imported");
  assert.equal(db.rows("norms")[0].auto_scope, "municipal");
  const assigned: string[] = [];
  await run(db, { ...d, assignNew: async (id) => { assigned.push(id); } });
  assert.deepEqual(assigned, [db.rows("norms")[0].id]);
});

test("recheck: gelesener Text bleibt, fehlgeschlagener Versuch darf neu", async () => {
  const db = setup({ title: "Baureglement", rules: { ocr_enabled: true } });
  const model = fakeModel();
  const d = deps(SCAN, model.client);
  await run(db, d);
  await setDocumentDecision(db.asClient(), String(row(db).id), "recheck");
  await run(db, d);
  assert.equal(model.calls.stream, 1, "gelesen: nicht nochmals bezahlt");

  Object.assign(row(db), { status: "rejected", reject_reason: "scan_or_short", norm_id: null, ocr_status: "failed" });
  await setDocumentDecision(db.asClient(), String(row(db).id), "recheck");
  assert.equal(row(db).ocr_status, null);
  assert.equal(scopeOf("Baureglement", RULES), "municipal");
});
