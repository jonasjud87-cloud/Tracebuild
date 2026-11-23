import { test } from "node:test";
import assert from "node:assert/strict";

import { isOverlayOrGeneric, mentionFamilies, zoneCodeHint, zoneFamilies, zoneHits, zoneVariants } from "./zone-mention";

const own = (line: string, zone: string) => zoneHits(line, zone).eigene.length;
const foreign = (line: string, zone: string) => zoneHits(line, zone).fremde.map((h) => line.slice(h.at, h.end));

test("zoneHits: eigene und fremde Zonen", () => {
  assert.ok(own("Art. 20 Wohnzone W2", "W2") >= 1);
  assert.deepEqual(foreign("Art. 20 Wohnzone W2", "W2"), []);
  assert.equal(own("W2, W3", "W2"), 1);
  assert.deepEqual(foreign("W2, W3", "W2"), ["W3"]);
  for (const t of ["W21", "W2a", "W2-B", "W2 - B"]) assert.equal(own(t, "W2"), 0, t);
});

test("zoneHits: Langform ohne Kürzel ist fremd, Bauzone nicht", () => {
  assert.deepEqual(foreign("Die Kernzone", "W2"), ["Kernzone"]);
  assert.deepEqual(foreign("in der Bauzone", "W2"), []);
  assert.deepEqual(foreign("100 m2 Fläche", "W2"), []);
});

test("zoneHits: extra liefert weitere Schreibweisen", () => {
  assert.equal(own("Wohnzone W2", "Wohnzone zweigeschossig"), 0);
  assert.equal(zoneHits("Wohnzone W2", "Wohnzone zweigeschossig", ["W2"]).eigene.length, 1);
  assert.deepEqual(zoneVariants("Wohnzone 2", [null, " "]), ["Wohnzone 2", "W2"]);
});

test("zoneFamilies", () => {
  assert.deepEqual(zoneFamilies("W2"), new Set(["wohn"]));
  assert.deepEqual(zoneFamilies("WG3"), new Set(["wohn", "gewerbe"]));
  assert.deepEqual(zoneFamilies("K"), new Set(["kern"]));
  assert.deepEqual(zoneFamilies("D2"), new Set(["dorf", "kern"]));
  assert.deepEqual(zoneFamilies("W2a"), new Set(["wohn"]));
  assert.deepEqual(zoneFamilies("Wohnzone 2"), new Set(["wohn"]));
  assert.equal(zoneFamilies("ZöN"), null);
  assert.equal(zoneFamilies("Spezialzone Bahnhof"), null);
  assert.equal(zoneFamilies(""), null);
});

test("mentionFamilies", () => {
  assert.deepEqual(mentionFamilies("Kernzonen"), new Set(["kern"]));
  assert.deepEqual(mentionFamilies("Wohn- und Gewerbezone"), new Set(["wohn", "gewerbe"]));
  assert.equal(mentionFamilies("Spezialzone"), null);
});

test("isOverlayOrGeneric", () => {
  for (const t of ["Gefahrenzone", "Grundwasserschutzzone", "Ortsbildschutzzone", "Bauzonen", "alle Zonen", "Zonen", "übrige Zonen", "Lärmzone", "Waldabstandszone", "Gewässerraumzone", "Überlagerte Zone"]) {
    assert.equal(isOverlayOrGeneric(t), true, t);
  }
  for (const t of ["Erdbebenzone Z1", "Lärmempfindlichkeitsstufe", "Zone ES3", "ES II", "Parkierung", "anderen Bauzonen", "andere Zonen"]) {
    assert.equal(isOverlayOrGeneric(t), true, t);
  }
  for (const t of ["Kernzone", "Wohnzone W3", "Gewerbezone", "Westseite", "Essen"]) assert.equal(isOverlayOrGeneric(t), false, t);
});

test("zoneCodeHint: Kürzel aus einer Legende, im Zweifel null", () => {
  assert.equal(zoneCodeHint("Wohnzone 2 [W2]"), "W2");
  assert.equal(zoneCodeHint("W2 Wohnzone"), "W2");
  assert.equal(zoneCodeHint("W2"), null);
  assert.equal(zoneCodeHint("Wohnzone W2 / W3"), null);
  assert.equal(zoneCodeHint("Kernzone"), null);
});
