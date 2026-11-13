import assert from "node:assert/strict";
import test from "node:test";
import { ANALYSIS_LOGIC_VERSION, inputFingerprint, pickReusable, type ReuseCandidate } from "./analysis-fingerprint";
import { planHashOf } from "./analysis-versions";
import { combinePlanHash, isSha256, sha256Hex } from "./plan-hash";

const A = sha256Hex(Buffer.from("plan-a"));
const B = sha256Hex(Buffer.from("plan-b"));

test("Prüfsumme: SHA-256 wird erkannt, Müll nicht", () => {
  assert.equal(isSha256(A), true);
  assert.equal(isSha256("abc"), false);
  assert.equal(isSha256(A.toUpperCase()), false);
  assert.equal(isSha256(null), false);
});

test("Plansatz-Prüfsumme hängt nicht von der Reihenfolge der Dateien ab, aber vom Inhalt", () => {
  assert.equal(combinePlanHash([A, B]), combinePlanHash([B, A]));
  assert.notEqual(combinePlanHash([A]), combinePlanHash([A, B]));
  assert.notEqual(combinePlanHash([A]), combinePlanHash([B]));
});

test("ohne vollständige Prüfsummen gibt es keine Plansatz-Prüfsumme", () => {
  assert.equal(combinePlanHash([]), null);
  assert.equal(combinePlanHash(["kaputt"]), null);
  assert.equal(planHashOf([A, null]), null);
  assert.equal(planHashOf([A, B]), combinePlanHash([A, B]));
});

const place = { canton: "SG", municipality: "Mels", bauzone: "W2" };
const norms = [
  { id: "n1", text: "Art. 1 Text", digest: false },
  { id: "n2", text: "Art. 2 Text", digest: true },
];

test("Eingangs-Fingerprint ist stabil, auch bei anderer Reihenfolge und Schreibweise des Orts", () => {
  const base = inputFingerprint(norms, place);
  assert.equal(inputFingerprint(norms.slice().reverse(), place), base);
  assert.equal(inputFingerprint(norms, { canton: "sg", municipality: " mels ", bauzone: "w2" }), base);
});

test("Fingerprint ändert sich bei neuem Normtext, anderem Auszug-Stand, anderer Norm oder anderem Ort", () => {
  const base = inputFingerprint(norms, place);
  assert.notEqual(inputFingerprint([{ id: "n1", text: "Art. 1 neuer Text" }, norms[1]], place), base);
  assert.notEqual(inputFingerprint([{ ...norms[0], digest: true }, norms[1]], place), base);
  assert.notEqual(inputFingerprint([...norms, { id: "n3", text: "Art. 3" }], place), base);
  assert.notEqual(inputFingerprint(norms, { ...place, bauzone: "W3" }), base);
  assert.ok(ANALYSIS_LOGIC_VERSION >= 1);
});

function cand(over: Partial<ReuseCandidate>): ReuseCandidate {
  return { id: "a1", version_no: 1, created_at: "2026-11-13T10:00:00Z", status: "done", plan_sha256: "H", input_fingerprint: "F", ...over };
}

test("pickReusable nimmt nur fertige Analysen mit gleichem Plan und gleichem Eingangs-Stand, die jüngste zuerst", () => {
  assert.equal(pickReusable([cand({})], "H", "F")?.id, "a1");
  assert.equal(pickReusable([cand({ status: "error" })], "H", "F"), null);
  assert.equal(pickReusable([cand({ plan_sha256: "X" })], "H", "F"), null);
  assert.equal(pickReusable([cand({ input_fingerprint: "ALT" })], "H", "F"), null);
  assert.equal(pickReusable([cand({ input_fingerprint: null })], "H", "F"), null);
  const newer = cand({ id: "a2", created_at: "2026-11-14T10:00:00Z", version_no: 2 });
  assert.equal(pickReusable([cand({}), newer], "H", "F")?.id, "a2");
});
