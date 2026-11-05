/** Eigene Uploads gegen den amtlichen Text. Keine Netzwerkzugriffe. */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { replacedUploadIds, withoutShadowedAutoNorms, type ApplicableNorm } from "../norm-applies";
import { supersessionOf } from "../norm-supersession";
import { titleKey } from "./title-key";
import { FakeSupabase } from "./fake-supabase";
import { syncNextDocument } from "./document-import";
import { DEFAULT_IMPORT_FILTER as R } from "./import-filter";
import { resetImportFilterCache } from "./documents";
import { linkUploadToOfficial, planUploadLinks } from "./upload-supersede";

const word = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
const OFFICIAL = Array.from({ length: 30 }, (_, i) => `Art. ${i + 1} ${word(`amtlich${i}x`, 60)}`).join("\n");

const auto = (over: Partial<ApplicableNorm> = {}): ApplicableNorm => ({
  id: "amtlich", title: "Baureglement", layer: 4, jurisdiction_type: "municipal", jurisdiction_name: "Quarten", source_kind: "oereb_auto", auto_scope: "municipal", ...over,
});
const upload = (over: Partial<ApplicableNorm> = {}): ApplicableNorm => ({
  id: "upload", title: "Baureglement_05.02_29.05.2012.pdf", layer: 4, jurisdiction_type: "municipal", jurisdiction_name: "Quarten", ...over,
});

beforeEach(() => resetImportFilterCache());

test("Der echte Titel weicht ab: Der Titelvergleich allein erkennt den Upload nicht", () => {
  assert.notEqual(titleKey("Baureglement_05.02_29.05.2012.pdf", "Quarten"), titleKey("Baureglement", "Quarten"));
});

test("Ähnlichkeit: Grenzwert als Regel, Richtung Upload im amtlichen Text", () => {
  const similar = OFFICIAL.slice(0, Math.floor(OFFICIAL.length * 0.9));
  const other = Array.from({ length: 30 }, (_, i) => `Art. ${i + 1} ${word(`fremd${i}x`, 60)}`).join("\n");
  const rows = [
    { id: "gleich", text: similar },
    { id: "fremd", text: other },
    { id: "scan", text: "kurz" },
    { id: "alt", text: other, superseded_by_norm_id: "o1" },
  ];
  const links = planUploadLinks("o1", OFFICIAL, rows, R);
  assert.deepEqual(links.map((l) => [l.uploadId, l.action]), [["gleich", "link"], ["alt", "unlink"]]);
  assert.deepEqual(planUploadLinks("o1", OFFICIAL, rows.slice(0, 1), { ...R, upload_similarity_min: 1.01 }), []);
});

test("Abgelöster Upload: Die amtliche Fassung gilt, auch bei gleichem Titel; er bleibt bestehen", () => {
  const gleicherTitel = upload({ title: "Baureglement", superseded_by_norm_id: "amtlich" });
  assert.deepEqual(withoutShadowedAutoNorms([auto(), gleicherTitel]).map((n) => n.id), ["amtlich"]);
  assert.deepEqual(withoutShadowedAutoNorms([auto(), upload({ superseded_by_norm_id: "amtlich" })]).map((n) => n.id), ["amtlich"]);
});

test("Ohne Textvergleich bleibt das bisherige Verhalten: Gleicher Titel, manuell gewinnt", () => {
  assert.deepEqual(withoutShadowedAutoNorms([auto(), upload({ title: "Baureglement" })]).map((n) => n.id), ["upload"]);
});

test("Massgebend: Die Fassung der Org gilt, die amtliche entfällt, auch bei abweichendem Titel", () => {
  const eigen = upload({ superseded_by_norm_id: "amtlich", org_authoritative: true });
  assert.deepEqual(withoutShadowedAutoNorms([auto(), eigen]).map((n) => n.id), ["upload"]);
  assert.equal(replacedUploadIds([auto(), eigen]).size, 0);
});

test("Zurückgenommene oder fehlende amtliche Norm: Der Upload bleibt aktiv", () => {
  const u = upload({ superseded_by_norm_id: "amtlich" });
  assert.deepEqual(withoutShadowedAutoNorms([auto({ auto_scope: "superseded" }), u]).map((n) => n.id), ["amtlich", "upload"]);
  assert.deepEqual(withoutShadowedAutoNorms([u]).map((n) => n.id), ["upload"]);
});

test("Hinweis ist aus den Daten ableitbar", () => {
  const official = { id: "a", title: "Baureglement", source_url: "https://x.ch/1", source_checked_at: null, source_kind: "oereb_auto", auto_scope: "municipal" };
  const row = { id: "u", superseded_by_norm_id: "a", superseded_similarity: 0.9, superseded_at: "2026-11-05", org_authoritative: false };
  assert.equal(supersessionOf(row, official).version_hint, "official_used");
  assert.equal(supersessionOf(row, official).official?.title, "Baureglement");
  assert.equal(supersessionOf({ ...row, org_authoritative: true }, official).version_hint, "org_authoritative");
  assert.equal(supersessionOf(row, { ...official, auto_scope: "superseded" }).version_hint, null);
  assert.equal(supersessionOf({ id: "u" }, null).version_hint, null);
});

function importDb() {
  const db = new FakeSupabase();
  db.rows("projects").push({ id: "p1", org_id: "o1", location: { canton: "SG", municipality: "Quarten" }, bfs_number: 3293 });
  db.rows("oereb_extracts").push({
    id: "e1", project_id: "p1", status: "ok", canton: "SG", server_fetched_at: new Date().toISOString(),
    raw: { RealEstate: { MunicipalityCode: 3293, MunicipalityName: "Quarten" } },
  });
  db.rows("oereb_themes").push({
    id: "t1", extract_id: "e1", theme_code: "ch.Nutzungsplanung", concern: "affects",
    law_links: [{ title: "Baureglement", url: "https://oereblex.sg.ch/api/attachments/17750", kind: "LegalProvision", officialNumber: "1993-4101" }],
  });
  return db;
}

const stubs = {
  fetchDoc: async () => ({ kind: "ok" as const, bytes: Buffer.from("%PDF-x"), etag: null, lastModified: null }),
  extractText: async () => OFFICIAL,
};

test("Import: Upload wird nur auf der eigenen Zeile markiert, Text und Org gelangen nirgends hin", async () => {
  const db = importDb();
  db.rows("norms").push(
    { id: "drue", org_id: "atelier", title: "Baureglement_05.02_29.05.2012.pdf", text: OFFICIAL, source_kind: null, jurisdiction_type: "municipal", jurisdiction_name: "Quarten" },
    { id: "fremd", org_id: "andere", title: "Baureglement", text: word("andererinhalt", 800), source_kind: null, jurisdiction_type: "municipal", jurisdiction_name: "Quarten" },
    { id: "buchs", org_id: "atelier", title: "Baureglement", text: OFFICIAL, source_kind: null, jurisdiction_type: "municipal", jurisdiction_name: "Buchs" },
  );
  const assigned: string[] = [];
  await syncNextDocument(db.asClient(), "p1", { id: "u1", email: "a@b.ch" }, { ...stubs, assignNew: async (id) => { assigned.push(id); } });

  const official = db.rows("norms").find((n) => n.source_kind === "oereb_auto") as Record<string, unknown>;
  const by = (id: string) => db.rows("norms").find((n) => n.id === id) as Record<string, unknown>;
  assert.equal(by("drue").superseded_by_norm_id, official.id);
  assert.equal(by("drue").text, OFFICIAL, "Upload bleibt unangetastet");
  assert.equal(by("fremd").superseded_by_norm_id, undefined);
  assert.equal(by("buchs").superseded_by_norm_id, undefined);
  assert.deepEqual(assigned, [official.id]);

  const globals = JSON.stringify([db.rows("oereb_documents"), db.rows("audit_log")]);
  for (const secret of ["atelier", "drue", "Baureglement_05", "andere"]) assert.ok(!globals.includes(secret), secret);
});

test("Neuer Upload: gegen die geltende amtliche Norm geprüft, ausserhalb der Gemeinde nie", async () => {
  const db = new FakeSupabase();
  db.rows("norms").push({ id: "a", org_id: null, source_kind: "oereb_auto", auto_scope: "municipal", jurisdiction_name: "Quarten", jurisdiction_canton: "SG", text: OFFICIAL });
  db.rows("norms").push({ id: "u", org_id: "o1", source_kind: null });
  const rules = async () => R;
  const up = { id: "u", text: OFFICIAL, jurisdiction_type: "municipal", jurisdiction_name: "Quarten" };
  assert.equal(await linkUploadToOfficial(db.asClient(), { ...up, jurisdiction_name: "Mels" }, rules), false);
  assert.equal(await linkUploadToOfficial(db.asClient(), { ...up, jurisdiction_type: "org" }, rules), false);
  assert.equal(await linkUploadToOfficial(db.asClient(), up, rules), true);
  assert.equal(db.rows("norms").find((n) => n.id === "u")?.superseded_by_norm_id, "a");
});
