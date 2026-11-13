import test from "node:test";
import assert from "node:assert/strict";
import { clampCompanyStatus, companyNormInstruction, normLevelLabel } from "./company-norm-prompt";
import { buildNormBlock } from "./analysis-engine";

const company = (priority: string) => ({ layer: 5, jurisdiction_type: "org", priority });

test("Ebenen-Bezeichnung", () => {
  assert.equal(normLevelLabel({ layer: 1 }), "Bund");
  assert.equal(normLevelLabel({ layer: 3 }), "Kanton");
  assert.equal(normLevelLabel({ layer: 4 }), "Gemeinde");
  assert.equal(normLevelLabel({ layer: 5 }), "Spezialnorm");
  assert.match(normLevelLabel(company("binding")), /intern verbindlich/);
  assert.match(normLevelLabel(company("advisory")), /Empfehlung/);
});

test("Anweisung nur für Unternehmensnormen, mit Vorrang des Gesetzes", () => {
  assert.equal(companyNormInstruction({ layer: 1, jurisdiction_type: "national" }), "");
  assert.match(companyNormInstruction(company("binding")), /gehen immer vor/);
  assert.match(companyNormInstruction(company("binding")), /Mangel \(fail\)/);
  assert.match(companyNormInstruction(company("advisory")), /nie als Mangel/);
});

test("Empfehlung wird nie zum Mangel", () => {
  assert.equal(clampCompanyStatus(company("advisory"), "fail"), "warn");
  assert.equal(clampCompanyStatus(company("advisory"), "ok"), "ok");
  assert.equal(clampCompanyStatus(company("binding"), "fail"), "fail");
  assert.equal(clampCompanyStatus({ layer: 1, jurisdiction_type: "national" }, "fail"), "fail");
});

test("Normblock enthält Ebene und Regeln der Unternehmensnorm", () => {
  const norm = { id: "n1", title: "Brandschutzrichtlinie", category: "Brandschutz", text: "Fluchtweg 1.2 m", layer: 5, jurisdiction_type: "org", priority: "advisory" };
  const block = buildNormBlock({ norm, part: 1, parts: 1, text: norm.text, range: "" } as never, 0, 1);
  assert.match(block, /Unternehmensnorm \(interne Empfehlung\)/);
  assert.match(block, /gehen immer vor/);
});

test("Normen ohne Verbindlichkeit (vor der Migration) bleiben unverändert", () => {
  const legacy = { layer: 5, jurisdiction_type: "org", priority: null };
  assert.equal(normLevelLabel(legacy), "Unternehmensnorm");
  assert.equal(clampCompanyStatus(legacy, "fail"), "fail");
  assert.doesNotMatch(companyNormInstruction(legacy), /Empfehlung|verbindlich:/);
});
