import { test } from "node:test";
import assert from "node:assert/strict";

import {
  artikelInText,
  baueKenndatenBlatt,
  berechneGeschossflaeche,
  formatCh,
  kenndatenDateiname,
  numberInText,
  pruefeKandidat,
  waehleWerte,
  zitatInText,
  zoneMatches,
  type BelegNorm,
  type KenndatenAuswertung,
  type KenndatenKandidat,
} from "./kenndaten";

const leer = { landflaeche: null, az: null, laenge: null, breite: null, gebaeudehoehe: null, firsthoehe: null };

const kandidat = (over: Partial<KenndatenKandidat>): KenndatenKandidat => ({
  feld: "grenzabstand_klein",
  zahl: 3.5,
  einheit: "m",
  text: null,
  zusatz: null,
  normIndex: 1,
  artikel: "Art. 12",
  zitat: "W2 kleiner Grenzabstand 3,50 m",
  zoneImText: "W2",
  giltFuerAlleZonen: false,
  ...over,
});

const gemeinde: BelegNorm = { title: "Baureglement", layer: 4, text: "Art. 12 W2 kleiner Grenzabstand 3,50 m, grosser 7.50 m. Art. 13 W3 kleiner Grenzabstand 5.00 m." };
const kanton: BelegNorm = { title: "PBG", layer: 3, text: "§ 3 In allen Zonen beträgt der Grenzabstand 4.00 m. Strassenabstand 6 m." };

// ── Schweizer Format ─────────────────────────────────────────────────────────

test("formatCh: Hochkomma als Tausendertrennung, zwei Stellen", () => {
  assert.equal(formatCh(1839), "1'839.00");
  assert.equal(formatCh(919.5), "919.50");
  assert.equal(formatCh(1234567.8), "1'234'567.80");
  assert.equal(formatCh(0.5), "0.50");
});

test("formatCh: Eine AZ mit drei Stellen wird nicht gerundet angezeigt", () => {
  assert.equal(formatCh(0.375), "0.375");
});

// ── Berechnung ───────────────────────────────────────────────────────────────

test("Berechnung mit AZ", () => {
  const r = berechneGeschossflaeche({ ...leer, landflaeche: 1839, az: 0.5 });
  assert.equal(r.art, "az");
  assert.equal(r.ergebnis, 919.5);
  assert.deepEqual(r.zeilen, ["1'839.00 m² x 0.50 (AZ) = 919.50 m²"]);
  assert.match(r.hinweis, /ohne Bestandesabzug/);
});

test("Berechnung mit AZ rechnet stabil, auch wo Fliesskommazahlen krumm werden", () => {
  assert.equal(berechneGeschossflaeche({ ...leer, landflaeche: 1000, az: 0.35 }).ergebnis, 350);
  assert.equal(berechneGeschossflaeche({ ...leer, landflaeche: 333, az: 0.35 }).ergebnis, 116.55);
});

test("Berechnung über Volumen, klar als Richtwert gekennzeichnet", () => {
  const r = berechneGeschossflaeche({ landflaeche: 1839, az: null, laenge: 20, breite: 12, gebaeudehoehe: 7.4, firsthoehe: 11.2 });
  assert.equal(r.art, "volumen");
  assert.equal(r.ergebnis, 744);
  assert.deepEqual(r.zeilen, [
    "20.00 m x 12.00 m x ((7.40 m + 11.20 m) : 2) = 2'232.00 m³",
    "2'232.00 m³ : 3.00 m = 744.00 m²",
  ]);
  assert.match(r.hinweis, /Richtwert/);
  assert.match(r.hinweis, /angenommener Geschosshöhe 3\.00 m/);
});

test("Die AZ hat Vorrang vor dem Volumen", () => {
  assert.equal(berechneGeschossflaeche({ landflaeche: 100, az: 0.5, laenge: 20, breite: 12, gebaeudehoehe: 7, firsthoehe: 11 }).art, "az");
});

test("Fehlen AZ und ein Mass, ist keine Berechnung möglich", () => {
  const r = berechneGeschossflaeche({ landflaeche: 1839, az: null, laenge: 20, breite: null, gebaeudehoehe: 7.4, firsthoehe: 11.2 });
  assert.equal(r.art, "keine");
  assert.equal(r.ergebnis, null);
  assert.deepEqual(r.zeilen, []);
  assert.match(r.hinweis, /mangels Werten nicht möglich/);
});

test("Ohne Landfläche bleibt die Berechnung leer", () => {
  const r = berechneGeschossflaeche({ ...leer, az: 0.5 });
  assert.equal(r.art, "keine");
  assert.match(r.hinweis, /Landfläche fehlt/);
});

// ── Beleg-Prüfung ────────────────────────────────────────────────────────────

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

test("Zitat und Artikel müssen im Normtext stehen", () => {
  assert.ok(zitatInText("kleiner  Grenzabstand\n3,50 m", gemeinde.text));
  assert.equal(zitatInText("Der Mindestabstand beträgt überall stolze zehn Meter", gemeinde.text), false);
  assert.ok(artikelInText("Art. 12", gemeinde.text));
  assert.ok(artikelInText("Artikel 12", gemeinde.text));
  assert.equal(artikelInText("Art. 99", gemeinde.text), false);
  assert.equal(artikelInText("Art. 1", gemeinde.text), false);
  assert.ok(artikelInText("Zonentabelle", gemeinde.text));
});

test("Eine Zahl, die nicht im Normtext steht, wird verworfen", () => {
  const r = pruefeKandidat(kandidat({ zahl: 4.5, zitat: "" }), gemeinde, "W2");
  assert.deepEqual(r, { ok: false, grund: "beleg" });
});

test("Die Zahl muss auch im Zitat stehen, sonst belegt es den Wert nicht", () => {
  const r = pruefeKandidat(kandidat({ zahl: 7.5, zitat: "W2 kleiner Grenzabstand 3,50 m" }), gemeinde, "W2");
  assert.deepEqual(r, { ok: false, grund: "beleg" });
});

test("Ohne Zitat und ohne Artikel gilt der Wert als unbelegt", () => {
  assert.equal(pruefeKandidat(kandidat({ zitat: "", artikel: null }), gemeinde, "W2").ok, false);
});

test("Ein erfundener Artikel fällt weg, ein gutes Zitat trägt den Wert weiter", () => {
  const r = pruefeKandidat(kandidat({ artikel: "Art. 99" }), gemeinde, "W2");
  assert.ok(r.ok);
  assert.equal(r.wert.artikel, null);
});

test("Eine erfundene Zahl im Zusatz verwirft den Wert", () => {
  assert.equal(pruefeKandidat(kandidat({ zusatz: "Mehrlängenzuschlag ab 15.00 m" }), gemeinde, "W2").ok, false);
  const mit: BelegNorm = { ...gemeinde, text: `${gemeinde.text} Mehrlängenzuschlag ab 15 m` };
  const r = pruefeKandidat(kandidat({ zusatz: "(Mehrlängenzuschlag ab 15.00 m)" }), mit, "W2");
  assert.ok(r.ok);
  assert.equal(r.wert.zusatz, "Mehrlängenzuschlag ab 15.00 m");
});

test("Einheiten: cm in m, AZ in Prozent als Zahl, geprüft gegen die Zahl im Text", () => {
  const cm: BelegNorm = { title: "R", layer: 4, text: "W2: Grenzabstand 350 cm, AZ 50 %" };
  const a = pruefeKandidat(kandidat({ zahl: 350, einheit: "cm", zitat: "Grenzabstand 350 cm" }), cm, "W2");
  assert.ok(a.ok);
  assert.equal(a.wert.zahl, 3.5);
  const b = pruefeKandidat(kandidat({ feld: "ausnuetzungsziffer", zahl: 50, einheit: "%", zitat: "AZ 50 %" }), cm, "W2");
  assert.ok(b.ok);
  assert.equal(b.wert.zahl, 0.5);
});

test("Unsinnige Werte werden verworfen", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "W2 AZ 50 Geschosse 2.5" };
  assert.equal(pruefeKandidat(kandidat({ feld: "ausnuetzungsziffer", zahl: 50, einheit: "", zitat: "AZ 50" }), n, "W2").ok, false);
  assert.equal(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 2.5, einheit: "", zitat: "Geschosse 2.5" }), n, "W2").ok, false);
  assert.equal(pruefeKandidat(kandidat({ zahl: 2.5, einheit: "%", zitat: "Geschosse 2.5" }), n, "W2").ok, false);
});

test("Vollgeschosse dürfen als Wort oder römisch belegt sein", () => {
  const wort: BelegNorm = { title: "R", layer: 4, text: "In der Zone W gilt dreigeschossige Bauweise." };
  assert.ok(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 3, einheit: "", zitat: "dreigeschossige Bauweise", zoneImText: "W" }), wort, "W").ok);
  const roemisch: BelegNorm = { title: "R", layer: 4, text: "Zone W | III | 0.60" };
  assert.ok(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 3, einheit: "", zitat: "Zone W | III", zoneImText: "W" }), roemisch, "W").ok);
  assert.equal(pruefeKandidat(kandidat({ feld: "vollgeschosse", zahl: 4, einheit: "", zitat: "Zone W | III", zoneImText: "W" }), roemisch, "W").ok, false);
});

test("Dachform als Text: Der Begriff muss im Normtext stehen", () => {
  const n: BelegNorm = { title: "R", layer: 4, text: "W2: Satteldach mit Neigung 25 Grad." };
  const base = { feld: "dachform" as const, zahl: null, einheit: "" as const, zitat: "Satteldach mit Neigung 25 Grad" };
  assert.ok(pruefeKandidat(kandidat({ ...base, text: "Satteldach, 25 Grad" }), n, "W2").ok);
  assert.equal(pruefeKandidat(kandidat({ ...base, text: "Flachdach" }), n, "W2").ok, false);
  assert.equal(pruefeKandidat(kandidat({ ...base, text: "Satteldach, 30 Grad" }), n, "W2").ok, false);
});

// ── Zone ─────────────────────────────────────────────────────────────────────

test("Zonenabgleich: im Zweifel nein", () => {
  for (const passt of ["W2", "w 2", "Zone W2", "Wohnzone W2", "Wohnzone 2", "W2, W3", "W2/W3"]) {
    assert.ok(zoneMatches("W2", passt), passt);
  }
  for (const passt of ["W3", "W21", "W2a", "Wohnzone", "Kernzone", "", "alle"]) {
    assert.equal(zoneMatches("W2", passt), false, passt);
  }
  assert.ok(zoneMatches("Wohnzone W2", "W2"));
  assert.equal(zoneMatches("Wohnzone", "W2"), false);
});

test("Der Wert einer anderen Zone wird verworfen, auch wenn die Zahl im Text steht", () => {
  const r = pruefeKandidat(kandidat({ zahl: 5, zitat: "W3 kleiner Grenzabstand 5.00 m", zoneImText: "W3" }), gemeinde, "W2");
  assert.deepEqual(r, { ok: false, grund: "zone" });
});

test("Allgemeine Bestimmungen gelten für jede Zone, eine genannte fremde Zone nicht", () => {
  const allgemein = kandidat({ feld: "strassenabstand", zahl: 6, zitat: "Strassenabstand 6 m", zoneImText: "alle", giltFuerAlleZonen: true, artikel: "§ 3" });
  assert.ok(pruefeKandidat(allgemein, kanton, "W2").ok);
  assert.equal(pruefeKandidat({ ...allgemein, zoneImText: "W3" }, kanton, "W2").ok, false);
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
});

test("Ist die Gemeindeangabe unbelegt, ersetzt der Kanton sie nicht", () => {
  const unbelegt = kandidat({ zahl: 9.99, zitat: "" });
  const a = waehleWerte([unbelegt, allgemeinKanton], [gemeinde, kanton], "W2");
  assert.equal(a.werte.grenzabstand_klein, undefined);
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

// ── Blatt ────────────────────────────────────────────────────────────────────

const wert = (zahl: number, artikel = "Art. 12") => ({ zahl, text: null, zusatz: null, normTitle: "Baureglement", artikel, layer: 4 });
const projekt = { name: "Neubau Test", municipality: "Musterdorf", canton: "ZH", parcel: "1234", bauzone: "W2", zoneSource: "oereb", zoneConfidence: "exact" };
const blattVon = (auswertung: KenndatenAuswertung, over: Partial<Parameters<typeof baueKenndatenBlatt>[0]> = {}) =>
  baueKenndatenBlatt({ projekt, landflaeche: 1839, oerebFetchedAt: "2026-11-04T10:00:00Z", oerebStale: false, auswertung, jetzt: new Date("2026-11-05T10:00:00Z"), ...over });

test("Blatt: die Zeilen stehen in der verlangten Reihenfolge, fehlende Werte als Strich", () => {
  const b = blattVon({ werte: {}, widerspruechlich: [], verworfen: 0 });
  assert.deepEqual(b.zeilen.map((z) => z.bezeichnung), [
    "Zone", "Landfläche", "Vollgeschosse", "Ausnützungsziffer", "Grenzabstand gross", "Grenzabstand klein",
    "Gebäudelänge", "Gebäudehöhe", "Firsthöhe", "Dachform", "Strassenabstand",
  ]);
  assert.equal(b.zeilen[0].wert, "W2");
  assert.equal(b.zeilen[1].wert, "1'839.00 m²");
  for (const z of b.zeilen.slice(2)) assert.equal(z.wert, "–", z.bezeichnung);
  assert.equal(b.berechnung.art, "keine");
  assert.equal(b.datum, "05.11.2026");
  assert.equal(b.oerebStand, "Stand ÖREB-Auszug: 04.11.2026");
  assert.equal(b.ort, "Musterdorf, Kanton ZH");
});

test("Blatt: unsichere Zone wird gekennzeichnet", () => {
  const b = blattVon({ werte: {}, widerspruechlich: [], verworfen: 0 }, { projekt: { ...projekt, zoneConfidence: "low" } });
  assert.equal(b.zeilen[0].wert, "W2 (unsicher)");
});

test("Blatt: Breite und Zusatz stehen bei der Länge, die Quelle nennt Norm und Artikel", () => {
  const b = blattVon({
    werte: {
      gebaeudelaenge: { ...wert(25), zusatz: "Mehrlängenzuschlag ab 15.00 m" },
      gebaeudebreite: wert(12),
      ausnuetzungsziffer: wert(0.5, "Art. 7"),
    },
    widerspruechlich: [],
    verworfen: 0,
  });
  const laenge = b.zeilen.find((z) => z.bezeichnung === "Gebäudelänge")!;
  assert.equal(laenge.wert, "25.00 m (Mehrlängenzuschlag ab 15.00 m) / Breite 12.00 m");
  assert.equal(laenge.quelle, "Baureglement, Art. 12");
  assert.equal(b.zeilen.find((z) => z.bezeichnung === "Ausnützungsziffer")!.quelle, "Baureglement, Art. 7");
  assert.deepEqual(b.berechnung.zeilen, ["1'839.00 m² x 0.50 (AZ) = 919.50 m²"]);
});

test("Blatt: ohne Landfläche und ÖREB-Auszug bleibt die Berechnung leer, das Blatt entsteht", () => {
  const b = blattVon({ werte: { ausnuetzungsziffer: wert(0.5) }, widerspruechlich: [], verworfen: 0 }, { landflaeche: null, oerebFetchedAt: null });
  assert.equal(b.zeilen[1].wert, "–");
  assert.equal(b.zeilen[3].wert, "0.50");
  assert.equal(b.berechnung.art, "keine");
  assert.match(b.oerebStand, /kein Auszug/);
});

test("Blatt: Widerspruch und älterer ÖREB-Stand sind sichtbar", () => {
  const b = blattVon({ werte: {}, widerspruechlich: ["firsthoehe"], verworfen: 0 }, { oerebStale: true });
  const first = b.zeilen.find((z) => z.bezeichnung === "Firsthöhe")!;
  assert.equal(first.wert, "–");
  assert.match(first.quelle, /widersprechen sich/);
  assert.match(b.oerebStand, /älterer Stand/);
});

test("Dateiname behält Umlaute und ersetzt alles Heikle", () => {
  assert.equal(kenndatenDateiname("Neubau Müller / Haus 2"), "Kenndatenblatt_Neubau_Müller_Haus_2.pdf");
  assert.equal(kenndatenDateiname("../.."), "Kenndatenblatt_.._...pdf");
  assert.equal(kenndatenDateiname("  "), "Kenndatenblatt_Projekt.pdf");
});
