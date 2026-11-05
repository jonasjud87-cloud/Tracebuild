import { test } from "node:test";
import assert from "node:assert/strict";

import { backoffUntil, decideIdentity, decideUpdate, nextRecheck, type IdentityDocument } from "./document-decisions";
import { DEFAULT_IMPORT_FILTER as R } from "./import-filter";

function d(over: Partial<IdentityDocument> = {}): IdentityDocument {
  return { id: "d1", status: "pending", norm_id: null, url_normalized: "https://x.zh.ch/1", title_key: "bauordnung", scope: "municipal", ...over };
}
const none = { siblings: [], manualNorms: [], currentUrls: new Set<string>() };

test("Identität: neu", () => {
  assert.deepEqual(decideIdentity({ ...none, doc: d() }), { action: "insert" });
});

test("Identität: vorhandene Norm wird aktualisiert", () => {
  assert.deepEqual(decideIdentity({ ...none, doc: d({ status: "imported", norm_id: "n1" }) }), { action: "update", normId: "n1" });
});

test("Identität: gelöscht bleibt gelöscht, auch über eine neue URL gleichen Titels, in beiden Zuständen", () => {
  assert.equal(decideIdentity({ ...none, doc: d({ status: "imported", norm_id: null }) }).action, "removed");
  const removed = d({ id: "d2", status: "removed", url_normalized: "https://x.zh.ch/2" });
  assert.equal(decideIdentity({ ...none, doc: d(), siblings: [removed] }).action, "removed");
  const notYetMarked = d({ id: "d2", status: "imported", norm_id: null, url_normalized: "https://x.zh.ch/2" });
  assert.equal(decideIdentity({ ...none, doc: d(), siblings: [notYetMarked] }).action, "removed");
});

test("Identität: Löschregel nur für municipal, ein gleich betitelter Plan bleibt", () => {
  const sibling = d({ id: "d2", status: "removed", scope: "parcel", url_normalized: "https://x.zh.ch/2" });
  assert.equal(decideIdentity({ ...none, doc: d({ scope: "parcel" }), siblings: [sibling] }).action, "insert");
});

test("Identität: Gemeindefusion. Alte URL kürzlich anderswo gesehen: getrennte Normen", () => {
  const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const quarter = d({ id: "d2", status: "imported", norm_id: "n1", url_normalized: "https://x.zh.ch/ortsteil", last_seen_at: recent });
  const current = new Set(["https://x.zh.ch/1"]);
  assert.equal(decideIdentity({ ...none, doc: d(), siblings: [quarter], currentUrls: current }).action, "insert");
  // Dauerhaft nicht mehr abrufbar: abgelöst, auch wenn kürzlich gesehen.
  const dead = { ...quarter, last_update_status: "fetch_failed", attempts: 3 };
  assert.equal(decideIdentity({ ...none, doc: d(), siblings: [dead], currentUrls: current }).action, "new_version");
  assert.equal(decideIdentity({ ...none, doc: d(), siblings: [{ ...dead, attempts: 1 }], currentUrls: current }).action, "insert");
  // Ohne Sichtungsdatum nie ablösen.
  assert.equal(decideIdentity({ ...none, doc: d(), siblings: [{ ...quarter, last_seen_at: null }], currentUrls: current }).action, "insert");
});

test("Identität: manuell über Titel oder Text", () => {
  const byTitle = decideIdentity({ ...none, doc: d(), manualNorms: [{ id: "m", title_key: "bauordnung", text_sha256: "zz" }] });
  assert.equal(byTitle.action, "duplicate_manual");
  const other = [{ id: "m", title_key: "anders", text_sha256: "sha" }];
  assert.equal(decideIdentity({ ...none, doc: d(), manualNorms: other }).action, "insert");
  assert.equal(decideIdentity({ ...none, doc: d(), manualNorms: other, textSha: "sha" }).action, "duplicate_manual");
});

test("Identität: neue Version nur, wenn die alte URL nicht mehr im Auszug steht", () => {
  const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const old = d({ id: "d2", status: "imported", norm_id: "n1", url_normalized: "https://x.zh.ch/alt", last_seen_at: longAgo });
  assert.deepEqual(
    decideIdentity({ ...none, doc: d(), siblings: [old], currentUrls: new Set(["https://x.zh.ch/1"]) }),
    { action: "new_version", normId: "n1", supersededDocId: "d2" }
  );
  // Beide URLs im Auszug (SG führt die Bauordnung zweimal): getrennte Normen.
  assert.deepEqual(
    decideIdentity({ ...none, doc: d(), siblings: [old], currentUrls: new Set(["https://x.zh.ch/1", "https://x.zh.ch/alt"]) }),
    { action: "insert" }
  );
});

test("Identität: bei parcel belegt gleicher Titel keine Nachfolge", () => {
  const old = d({ id: "d2", status: "imported", norm_id: "n1", url_normalized: "https://x.zh.ch/alt", scope: "parcel" });
  assert.equal(decideIdentity({ ...none, doc: d({ scope: "parcel" }), siblings: [old] }).action, "insert");
});

test("Identität: gleicher Text wie eine Gemeinde-Norm", () => {
  const same = d({ id: "d2", status: "imported", norm_id: "n1", url_normalized: "https://x.zh.ch/2", title_key: "x", text_sha256: "sha" });
  const current = new Set(["https://x.zh.ch/1", "https://x.zh.ch/2"]);
  assert.equal(decideIdentity({ ...none, doc: d(), siblings: [same], currentUrls: current, textSha: "sha" }).action, "duplicate_content");
  assert.equal(decideIdentity({ ...none, doc: d(), siblings: [{ ...same, scope: "parcel" }], currentUrls: current, textSha: "sha" }).action, "insert");
});

const article = (n: number) => Array.from({ length: n }, (_, i) => `Art. ${i + 1} ${"Text ".repeat(100)}`).join("\n");

test("Update: gleicher Text, Änderung, Schrumpfung, zu kurz, Inhalt abgelehnt", () => {
  const base = { oldTextSha: "alt", oldChars: article(10).length, newTextSha: "neu", rules: R, title: "Baureglement" };
  assert.equal(decideUpdate({ ...base, newTextSha: "alt", newText: article(1) }).action, "unchanged");
  assert.equal(decideUpdate({ ...base, newText: article(9) }).action, "update");
  assert.equal(decideUpdate({ ...base, newText: article(6) }).action, "update");
  assert.equal(decideUpdate({ ...base, newText: article(4) }).action, "kept_old");
  assert.equal(decideUpdate({ ...base, oldChars: 100, newText: "kurz" }).action, "kept_old");
  assert.equal(decideUpdate({ ...base, oldChars: 100, newText: "Nur Text. ".repeat(500) }).action, "kept_old");
});

test("Backoff: 2^Versuche Stunden, höchstens 24", () => {
  const now = 1_000_000_000_000;
  const hours = (a: number) => (Date.parse(backoffUntil(a, now)) - now) / 3_600_000;
  assert.equal(hours(0), 1);
  assert.equal(hours(1), 2);
  assert.equal(hours(4), 16);
  assert.equal(hours(5), 24);
  assert.equal(hours(30), 24);
  assert.equal((Date.parse(nextRecheck({ ...R, recheck_hours: 48 }, now)) - now) / 3_600_000, 48);
});
