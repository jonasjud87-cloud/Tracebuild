import { test } from "node:test";
import assert from "node:assert/strict";

import {
  artikelInText,
  numberInText,
  pruefeKandidat,
  waehleWerte,
  zitatInText,
  zoneMatches,
  type BelegNorm,
  type KenndatenKandidat,
} from "./kenndaten-beleg";

const kandidat = (over: Partial<KenndatenKandidat>): KenndatenKandidat => ({
  feld: "grenzabstand_klein",
  zahl: 3.5,
  einheit: "m",
  text: null,
  zusatz: null,
  bezeichnung: null,
  normIndex: 1,
  artikel: "Art. 12",
  zitat: "W2 kleiner Grenzabstand 3,50 m",
  zoneImText: "W2",
  giltFuerAlleZonen: false,
  ...over,
});

const gemeinde: BelegNorm = {
  title: "Baureglement",
  layer: 4,
  text: "Art. 12 Abstände\nW2 kleiner Grenzabstand 3,50 m, grosser 7.50 m.\nArt. 13 Abstände\nW3 kleiner Grenzabstand 5.00 m, Grenzabstand 6.00 m.",
};
const kanton: BelegNorm = { title: "PBG", layer: 3, text: "§ 3 Allgemein\nIn allen Zonen beträgt der Grenzabstand 4.00 m. Strassenabstand 6 m." };

// ── Zahlen ───────────────────────────────────────────────────────────────────

test("Zahlen: 3.50, 3,50 und 3.5 sind dieselbe Zahl", () => {
  for (const text of ["Abstand 3.50 m", "Abstand 3,50 m", "Abstand 3.5 m", "3.50m"]) {
    assert.ok(numberInText(3.5, text), text);
  }
});

test("Zahlen: keine Treffer in längeren Zahlen", () => {
  for (const text of ["13.50 m", "3.55 m", "3.05 m", "35 m"]) {
    assert.equal(numberInText(3.5, text), false, text);
  }
  assert.ok(numberInText(1839, "Fläche 1'839 m²"));
  assert.ok(numberInText(1839, "Fläche 1’839.00 m²"));
});

test("Zahlen: Zonennamen und Fussnotenzeichen sind keine Werte", () => {
  assert.equal(numberInText(2, "Zone W2"), false);
  assert.equal(numberInText(4, "W2 / 4)WG2"), false);
  assert.equal(numberInText(14, "14) Fussnote"), false);
  assert.ok(numberInText(2, "W2 / 4)WG2  2  0.45"));
});

test("Vollgeschosse: «W2» und «ES II» belegen keine 2 Geschosse", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "Zone W2, ES II, Grenzabstand 4 m" };
  assert.equal(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 2, einheit: "", zitat: "Zone W2, ES II" }), n, "W2").ok, false);
});

test("Vollgeschosse: Wort oder römische Zahl nur neben «gesch»", () => {
  const wort: BelegNorm = { title: "R", layer: 4, text: "In der Zone W3 gilt dreigeschossige Bauweise." };
  assert.ok(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 3, einheit: "", zitat: "Zone W3 gilt dreigeschossige Bauweise", zoneImText: "W3" }), wort, "W3").ok);
  const roemisch: BelegNorm = { title: "R", layer: 4, text: "Zone W3: III Geschosse" };
  assert.ok(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 3, einheit: "", zitat: "Zone W3: III Geschosse", zoneImText: "W3" }), roemisch, "W3").ok);
  assert.equal(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 4, einheit: "", zitat: "Zone W3: III Geschosse", zoneImText: "W3" }), roemisch, "W3").ok, false);
});

// ── Zitat ────────────────────────────────────────────────────────────────────

test("Zitat: zusammenhängende Wortfolge, tolerant nur bei Leerraum und Silbentrennung", () => {
  assert.ok(zitatInText("kleiner  Grenzabstand\n3,50 m", gemeinde.text));
  assert.ok(zitatInText("nachstehenden Tabelle", "gelten die Vorschriften der nachste-\nhenden Tabelle"));
  assert.ok(zitatInText("W2 2 0.45", "W2   |  2   |   0.45"));
  assert.equal(zitatInText("W2 Grenzabstand 6.00", gemeinde.text), false, "Einzelwörter genügen nicht");
  assert.equal(zitatInText("Grenzabstand kleiner 3,50 m", gemeinde.text), false, "Reihenfolge zählt");
  assert.equal(zitatInText("", gemeinde.text), false);
});

test("Blocker: «W2 Grenzabstand 6.00» besteht nicht, 6.00 gehört zu W3", () => {
  const r = pruefeKandidat(kandidat({ zahl: 6, zitat: "W2 Grenzabstand 6.00" }), gemeinde, "W2");
  assert.deepEqual(r, { ok: false, grund: "beleg" });
});

test("Ein Zitat ist Pflicht, auch mit Artikel oder «Zonentabelle»", () => {
  assert.equal(pruefeKandidat(kandidat({ zitat: "" }), gemeinde, "W2").ok, false);
  assert.equal(pruefeKandidat(kandidat({ zitat: "", artikel: "Zonentabelle" }), gemeinde, "W2").ok, false);
});

test("Artikel: erfundene Fundstellen fallen weg, das Zitat trägt den Wert", () => {
  assert.ok(artikelInText("Art. 12", gemeinde.text));
  assert.ok(artikelInText("Artikel 12", gemeinde.text));
  assert.equal(artikelInText("Art. 99", gemeinde.text), false);
  assert.equal(artikelInText("Art. 1", gemeinde.text), false);
  const r = pruefeKandidat(kandidat({ artikel: "Art. 99" }), gemeinde, "W2");
  assert.ok(r.ok);
  assert.equal(r.wert.artikel, null);
});

test("Die Zahl muss im Zitat stehen", () => {
  assert.deepEqual(pruefeKandidat(kandidat({ zahl: 7.5 }), gemeinde, "W2"), { ok: false, grund: "beleg" });
});

test("Eine erfundene Zahl im Zusatz verwirft den Wert", () => {
  assert.equal(pruefeKandidat(kandidat({ zusatz: "Mehrlängenzuschlag ab 15.00 m" }), gemeinde, "W2").ok, false);
  const mit: BelegNorm = { ...gemeinde, text: `${gemeinde.text}\nMehrlängenzuschlag ab 15 m` };
  const r = pruefeKandidat(kandidat({ zusatz: "(Mehrlängenzuschlag ab 15.00 m)" }), mit, "W2");
  assert.ok(r.ok);
  assert.equal(r.wert.zusatz, "Mehrlängenzuschlag ab 15.00 m");
});

// ── Einheiten ────────────────────────────────────────────────────────────────

test("Einheiten: cm werden zu m, «250 cm» ist nie 250 m", () => {
  const cm: BelegNorm = { title: "R", layer: 4, text: "W2: Grenzabstand 350 cm" };
  const ok = pruefeKandidat(kandidat({ zahl: 350, einheit: "cm", zitat: "W2: Grenzabstand 350 cm" }), cm, "W2");
  assert.ok(ok.ok);
  assert.equal(ok.wert.zahl, 3.5);
  assert.equal(pruefeKandidat(kandidat({ zahl: 350, einheit: "m", zitat: "W2: Grenzabstand 350 cm" }), cm, "W2").ok, false);
});

test("«20 %» Mehrausnützung ist keine AZ", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "W2 AZ 0.45, Mehrausnützung max. 20 %" };
  const az = (zahl: number, zitat: string, einheit = "" as KenndatenKandidat["einheit"]) => kandidat({ feld: "ausnuetzungsziffer", zahl, einheit, zitat });
  assert.equal(pruefeKandidat(az(20, "W2 AZ 0.45, Mehrausnützung max. 20 %"), n, "W2").ok, false);
  assert.equal(pruefeKandidat(az(0.2, "W2 AZ 0.45, Mehrausnützung max. 20 %"), n, "W2").ok, false);
  const r = pruefeKandidat(az(0.45, "W2 AZ 0.45"), n, "W2");
  assert.ok(r.ok);
});

test("Unsinnige Werte werden verworfen", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "W2 Ziffer 50, Geschosse 2.5" };
  assert.equal(pruefeKandidat(kandidat({ feld: "ausnuetzungsziffer", zahl: 50, einheit: "", zitat: "W2 Ziffer 50" }), n, "W2").ok, false);
  assert.equal(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 2.5, einheit: "", zitat: "W2 Ziffer 50, Geschosse 2.5" }), n, "W2").ok, false);
});

test("Dachform: alle wesentlichen Wörter im Zitat, nicht irgendwo im Text", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "W2: Satteldach mit Neigung 25 Grad.\nW3: Flachdach." };
  const base = { feld: "dachform" as const, zahl: null, einheit: "" as const, zitat: "W2: Satteldach mit Neigung 25 Grad" };
  assert.ok(pruefeKandidat(kandidat({ ...base, text: "Satteldach, 25 Grad" }), n, "W2").ok);
  assert.equal(pruefeKandidat(kandidat({ ...base, text: "Flachdach" }), n, "W2").ok, false, "steht nur anderswo");
  assert.equal(pruefeKandidat(kandidat({ ...base, text: "Satteldach, 30 Grad" }), n, "W2").ok, false);
});

// ── Zone ─────────────────────────────────────────────────────────────────────

test("Zonenabgleich: eigene Zone exakt, im Zweifel nein", () => {
  for (const passt of ["W2", "w 2", "Zone W2", "Wohnzone W2", "Wohnzone 2", "Wohnzone 2 Geschosse", "W2, W3", "W2/WG2", "W2 / 4)WG2"]) {
    assert.ok(zoneMatches("W2", passt), passt);
  }
  for (const passt of ["W3", "W21", "W2a", "W2-B", "W2 - B", "Wohnzone", "Wohnzone b 2 Geschosse", "Kernzone", "", "alle"]) {
    assert.equal(zoneMatches("W2", passt), false, passt);
  }
  assert.ok(zoneMatches("Wohnzone W2", "W2"));
  assert.ok(zoneMatches("Wohnzone 2 Geschosse", "W2"));
  assert.ok(zoneMatches("W2-B", "W2 - B"));
  assert.equal(zoneMatches("W2-B", "W2"), false);
  assert.equal(zoneMatches("Wohnzone", "W2"), false);
  assert.equal(zoneMatches("I", "in"), false);
});

test("Nennt das Modell eine andere Zone, ist das Grund «zone»", () => {
  const r = pruefeKandidat(kandidat({ zahl: 5, zitat: "W3 kleiner Grenzabstand 5.00 m", zoneImText: "W3" }), gemeinde, "W2");
  assert.deepEqual(r, { ok: false, grund: "zone" });
});

test("zoneImText allein bindet nicht: Zone muss im Zitat, der Zeile oder der Überschrift stehen", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "Art. 16 Regelbauweise\nGrenzabstand 6.00 m\nArt. 17 Wohnzone W2\nGrenzabstand 4.00 m" };
  assert.deepEqual(pruefeKandidat(kandidat({ zahl: 6, zitat: "Grenzabstand 6.00 m" }), n, "W2"), { ok: false, grund: "beleg" });
  assert.ok(pruefeKandidat(kandidat({ zahl: 4, zitat: "Grenzabstand 4.00 m" }), n, "W2").ok, "über den Artikelkopf");
});

test("Eine Überschrift der Nachbarzone W2-B bindet nicht an W2", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "Art. 5 Wohnzone W2 - B\nEs sind nur Satteldächer gestattet.\nIn der Wohnzone W2-B Länge 20 m." };
  const dach = kandidat({ feld: "dachform", zahl: null, einheit: "", text: "Satteldächer", zitat: "nur Satteldächer gestattet" });
  assert.deepEqual(pruefeKandidat(dach, n, "W2"), { ok: false, grund: "beleg" });
  assert.ok(pruefeKandidat({ ...dach, zoneImText: "W2-B" }, n, "W2-B").ok);
  assert.equal(pruefeKandidat(kandidat({ feld: "gebaeudelaenge", zahl: 20, zitat: "In der Wohnzone W2-B Länge 20 m" }), n, "W2").ok, false);
});

test("Ein Zitat über zwei Tabellenzeilen bindet den Wert der fremden Zeile nicht", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "W2 2 0.45\nW2-B 2 0.40\nW3 3 0.65" };
  const az = (zahl: number, zitat: string) => kandidat({ feld: "ausnuetzungsziffer", zahl, einheit: "", zitat });
  assert.ok(pruefeKandidat(az(0.45, "W2 2 0.45"), n, "W2").ok);
  assert.equal(pruefeKandidat(az(0.4, "W2 2 0.45 W2-B 2 0.40"), n, "W2").ok, false);
  assert.equal(pruefeKandidat(az(0.65, "W2 2 0.45 W2-B 2 0.40 W3 3 0.65"), n, "W2").ok, false);
});

test("Gemeinsame Zeile «W2 / WG2» gilt für beide", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "W2 / WG2  2  0.45" };
  assert.ok(pruefeKandidat(kandidat({ feld: "ausnuetzungsziffer", zahl: 0.45, einheit: "", zitat: "W2 / WG2 2 0.45", zoneImText: "W2 / WG2" }), n, "WG2").ok);
});

test("Spaltenweise gespeicherter Text bindet keinen Wert an die Zone", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "Art. 16 Regelbauweise\nW1\nW2 / 4)WG2\nW2-B\n0.35\n0.45\n0.40\n8.5\n11.0\n14.0" };
  assert.deepEqual(pruefeKandidat(kandidat({ feld: "firsthoehe", zahl: 14, zitat: "14.0" }), n, "W2"), { ok: false, grund: "beleg" });
  assert.deepEqual(pruefeKandidat(kandidat({ feld: "firsthoehe", zahl: 11, zitat: "11.0" }), n, "W2"), { ok: false, grund: "beleg" });
});

const allgemein = (over: Partial<KenndatenKandidat> = {}) =>
  kandidat({ feld: "strassenabstand", zahl: 6, zitat: "Strassenabstand 6 m", zoneImText: "alle", giltFuerAlleZonen: true, artikel: "§ 3", ...over });

test("Allgemeine Bestimmungen gelten für jede Zone, eine genannte fremde Zone nicht", () => {
  assert.ok(pruefeKandidat(allgemein(), kanton, "W2").ok);
  assert.ok(pruefeKandidat(allgemein({ zoneImText: "in allen Zonen" }), kanton, "W2").ok);
  assert.equal(pruefeKandidat(allgemein({ zoneImText: "W3" }), kanton, "W2").ok, false);
});

test("«alle Wohnzonen» gilt nicht für die Kernzone, «alle ausser W2» nicht für W2", () => {
  assert.equal(pruefeKandidat(allgemein({ zoneImText: "alle Wohnzonen" }), kanton, "K").ok, false);
  assert.equal(pruefeKandidat(allgemein({ zoneImText: "alle ausser W2" }), kanton, "W2").ok, false);
  const n: BelegNorm = { title: "R", layer: 3, text: "Strassenabstand 6 m, ausgenommen in Kernzonen" };
  assert.equal(pruefeKandidat(allgemein({ zitat: "Strassenabstand 6 m, ausgenommen in Kernzonen" }), n, "K").ok, false);
});

test("Eine «allgemeine» Angabe im Artikel einer fremden Zone gilt nicht", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "Art. 5 Wohnzone W3\nStrassenabstand 6 m" };
  assert.equal(pruefeKandidat(allgemein(), n, "W2").ok, false);
});

// ── Vorrang ──────────────────────────────────────────────────────────────────

const allgemeinKanton = kandidat({ normIndex: 2, zahl: 4, zitat: "In allen Zonen beträgt der Grenzabstand 4.00 m", zoneImText: "alle", giltFuerAlleZonen: true, artikel: "§ 3" });

test("Gemeinde vor Kanton", () => {
  const a = waehleWerte([allgemeinKanton, kandidat({})], [gemeinde, kanton], "W2");
  assert.equal(a.werte.grenzabstand_klein?.zahl, 3.5);
  assert.equal(a.werte.grenzabstand_klein?.normTitle, "Baureglement");
});

test("Der Kanton springt ein, wo die Gemeinde nichts hat", () => {
  const a = waehleWerte([allgemeinKanton], [gemeinde, kanton], "W2");
  assert.equal(a.werte.grenzabstand_klein?.zahl, 4);
  assert.equal(a.werte.grenzabstand_klein?.normTitle, "PBG");
});

test("Der Kanton springt auch ein, wenn die Gemeindeangabe eine andere Zone betrifft", () => {
  const fremd = kandidat({ zahl: 5, zitat: "W3 kleiner Grenzabstand 5.00 m", zoneImText: "W3" });
  const a = waehleWerte([fremd, allgemeinKanton], [gemeinde, kanton], "W2");
  assert.equal(a.werte.grenzabstand_klein?.zahl, 4);
  assert.equal(a.verworfen, 1);
  assert.deepEqual(a.unbelegt, []);
});

test("Ist die Gemeindeangabe unbelegt oder nicht an die Zone gebunden, rückt kein Kantonswert nach", () => {
  const a = waehleWerte([kandidat({ zahl: 9.99, zitat: "" }), allgemeinKanton], [gemeinde, kanton], "W2");
  assert.equal(a.werte.grenzabstand_klein, undefined);
  assert.deepEqual(a.unbelegt, ["grenzabstand_klein"]);
  assert.equal(a.verworfen, 1);
});

test("Widersprechen sich zwei Normen derselben Ebene, wird nicht geraten", () => {
  const zweite: BelegNorm = { title: "Sonderbauvorschriften", layer: 4, text: "W2 kleiner Grenzabstand 4.50 m" };
  const a = waehleWerte([kandidat({}), kandidat({ normIndex: 2, zahl: 4.5, zitat: "W2 kleiner Grenzabstand 4.50 m", artikel: null })], [gemeinde, zweite], "W2");
  assert.equal(a.werte.grenzabstand_klein, undefined);
  assert.deepEqual(a.widerspruechlich, ["grenzabstand_klein"]);
});

test("Ein Index ausserhalb der Liste zählt als verworfen", () => {
  const a = waehleWerte([kandidat({ normIndex: 9 })], [gemeinde], "W2");
  assert.deepEqual(a.werte, {});
  assert.equal(a.verworfen, 1);
});
