import { test } from "node:test";
import assert from "node:assert/strict";

import {
  baueKenndatenBlatt,
  berechneGeschossflaeche,
  formatCh,
  kenndatenDateiname,
  type KenndatenAuswertung,
  type KenndatenWerte,
} from "./kenndaten";

const leer = { landflaeche: null, az: null, laenge: null, breite: null, gebaeudehoehe: null, firsthoehe: null };
const masse = { laenge: 20, breite: 12, gebaeudehoehe: 7.4, firsthoehe: 11.2 };

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

test("Berechnung mit AZ: theoretische Fläche mit dem Vorbehalt", () => {
  const r = berechneGeschossflaeche({ ...leer, landflaeche: 1839, az: 0.5 });
  assert.equal(r.art, "az");
  assert.equal(r.ergebnis, 919.5);
  assert.equal(r.titel, "Max. anrechenbare Geschossfläche, theoretisch");
  assert.deepEqual(r.zeilen, ["1'839.00 m² x 0.50 (AZ) = 919.50 m²"]);
  assert.equal(r.hinweis, "Grundbuchfläche, ohne Bestand und Boni; Anrechenbarkeit gemäss Reglement.");
});

test("Berechnung mit AZ rechnet stabil, auch wo Fliesskommazahlen krumm werden", () => {
  assert.equal(berechneGeschossflaeche({ ...leer, landflaeche: 1000, az: 0.35 }).ergebnis, 350);
  assert.equal(berechneGeschossflaeche({ ...leer, landflaeche: 333, az: 0.35 }).ergebnis, 116.55);
});

test("Berechnung über Volumen: «ca.», auf 10 m² gerundet, klar als grober Richtwert", () => {
  const r = berechneGeschossflaeche({ ...masse, landflaeche: 1839, az: null });
  assert.equal(r.art, "volumen");
  assert.equal(r.ergebnis, 740);
  assert.deepEqual(r.zeilen, [
    "20.00 m x 12.00 m x ((7.40 m + 11.20 m) : 2) = 2'232.00 m³",
    "2'232.00 m³ : 3.00 m = ca. 740 m²",
  ]);
  assert.match(r.hinweis, /^Grober Richtwert aus Gebäudehülle, inkl\. Aussenwände/);
  assert.match(r.hinweis, /angenommener Geschosshöhe 3\.00 m/);
  assert.match(r.hinweis, /keine zulässige Nutzung; Abstände, Parzelle, Geschosszahl ungeprüft\./);
});

test("Volumen: Tausender auch im gerundeten Ergebnis", () => {
  const r = berechneGeschossflaeche({ landflaeche: 5000, az: null, laenge: 60, breite: 20, gebaeudehoehe: 10, firsthoehe: 14 });
  assert.match(r.zeilen[1], /= ca\. 4'800 m²$/);
});

test("Die AZ hat Vorrang vor dem Volumen", () => {
  assert.equal(berechneGeschossflaeche({ ...masse, landflaeche: 100, az: 0.5 }).art, "az");
});

test("Keine Volumenformel, wenn die AZ widersprüchlich oder unbelegt ist", () => {
  const r = berechneGeschossflaeche({ ...masse, landflaeche: 1839, az: null, azUnklar: true });
  assert.equal(r.art, "keine");
  assert.match(r.hinweis, /widersprüchlich oder nicht belegt/);
});

test("Keine Volumenformel, wenn das Reglement über BMZ oder ÜZ regelt", () => {
  const r = berechneGeschossflaeche({ ...masse, landflaeche: 1839, az: null, andereZiffer: "Baumassenziffer" });
  assert.equal(r.art, "keine");
  assert.match(r.hinweis, /Baumassenziffer/);
});

test("Fehlen AZ und ein Mass, ist keine Berechnung möglich", () => {
  const r = berechneGeschossflaeche({ ...masse, breite: null, landflaeche: 1839, az: null });
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

// ── Blatt ────────────────────────────────────────────────────────────────────

const wert = (zahl: number, artikel = "Art. 12") => ({ zahl, text: null, zusatz: null, bezeichnung: null, normTitle: "Baureglement", artikel, layer: 4 });
const projekt = { name: "Neubau Test", municipality: "Musterdorf", canton: "ZH", parcel: "1234", bauzone: "W2", zoneSource: "oereb", zoneConfidence: "exact" };
const auswertung = (over: Partial<KenndatenAuswertung> = {}): KenndatenAuswertung => ({ werte: {}, widerspruechlich: [], unbelegt: [], verworfen: 0, hinweise: [], vorbehalt: false, ...over });
const blattVon = (a: KenndatenAuswertung, over: Partial<Parameters<typeof baueKenndatenBlatt>[0]> = {}) =>
  baueKenndatenBlatt({ projekt, landflaeche: 1839, oerebFetchedAt: "2026-11-04T10:00:00Z", oerebStale: false, auswertung: a, jetzt: new Date("2026-11-05T10:00:00Z"), ...over });
const zeile = (b: ReturnType<typeof blattVon>, name: string) => b.zeilen.find((z) => z.bezeichnung.startsWith(name))!;

test("Blatt: die Zeilen stehen in der verlangten Reihenfolge, fehlende Werte als Strich", () => {
  const b = blattVon(auswertung());
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
  assert.equal(blattVon(auswertung(), { projekt: { ...projekt, zoneConfidence: "low" } }).zeilen[0].wert, "W2 (unsicher)");
});

test("Blatt: Breite und Zusatz stehen bei der Länge, die Quelle nennt Norm und Artikel", () => {
  const b = blattVon(auswertung({
    werte: {
      gebaeudelaenge: { ...wert(25), zusatz: "Mehrlängenzuschlag ab 15.00 m" },
      gebaeudebreite: wert(12),
      ausnuetzungsziffer: wert(0.5, "Art. 7"),
    },
  }));
  const laenge = zeile(b, "Gebäudelänge");
  assert.equal(laenge.wert, "25.00 m (Mehrlängenzuschlag ab 15.00 m) / Breite 12.00 m");
  assert.equal(laenge.quelle, "Baureglement, Art. 12");
  assert.equal(zeile(b, "Ausnützungsziffer").quelle, "Baureglement, Art. 7");
  assert.deepEqual(b.berechnung.zeilen, ["1'839.00 m² x 0.50 (AZ) = 919.50 m²"]);
});

test("Blatt: Eine andere Messweise steht bei der Bezeichnung, dieselbe nicht", () => {
  const werte: KenndatenWerte = {
    gebaeudehoehe: { ...wert(7.5), bezeichnung: "Fassadenhöhe" },
    firsthoehe: { ...wert(11), bezeichnung: "First" },
    gebaeudelaenge: { ...wert(25), bezeichnung: "Gebäudelänge" },
  };
  const namen = blattVon(auswertung({ werte })).zeilen.map((z) => z.bezeichnung);
  assert.ok(namen.includes("Gebäudehöhe (Fassadenhöhe)"));
  assert.ok(namen.includes("Firsthöhe"));
  assert.ok(namen.includes("Gebäudelänge"));
});

test("Blatt: mehrere Strassenarten stehen als Zusatz in der Zeile", () => {
  const b = blattVon(auswertung({ werte: { strassenabstand: { ...wert(0), zahl: null, zusatz: "Staatsstrassen 4.00 m, Gemeindewege 2.00 m; Baulinie geht vor" } } }));
  assert.equal(zeile(b, "Strassenabstand").wert, "Staatsstrassen 4.00 m, Gemeindewege 2.00 m; Baulinie geht vor");
});

test("Blatt: BMZ erscheint eigens, ohne Volumenformel", () => {
  const b = blattVon(auswertung({ werte: { baumassenziffer: wert(2.1), ...{ gebaeudelaenge: wert(20), gebaeudebreite: wert(12), gebaeudehoehe: wert(7), firsthoehe: wert(11) } } }));
  assert.equal(zeile(b, "Baumassenziffer").wert, "2.10");
  assert.equal(b.zeilen[4].bezeichnung, "Baumassenziffer");
  assert.equal(b.berechnung.art, "keine");
});

test("Blatt: ohne Landfläche und ÖREB-Auszug bleibt die Berechnung leer, das Blatt entsteht", () => {
  const b = blattVon(auswertung({ werte: { ausnuetzungsziffer: wert(0.5) } }), { landflaeche: null, oerebFetchedAt: null });
  assert.equal(b.zeilen[1].wert, "–");
  assert.equal(b.zeilen[3].wert, "0.50");
  assert.equal(b.berechnung.art, "keine");
  assert.match(b.oerebStand, /kein Auszug/);
});

test("Blatt: Widerspruch, fehlender Beleg und älterer ÖREB-Stand sind sichtbar", () => {
  const b = blattVon(auswertung({ widerspruechlich: ["firsthoehe"], unbelegt: ["gebaeudehoehe"], hinweise: ["Baureglement: Scan."] }), { oerebStale: true });
  assert.equal(zeile(b, "Firsthöhe").wert, "–");
  assert.match(zeile(b, "Firsthöhe").quelle, /widersprechen sich/);
  assert.equal(zeile(b, "Gebäudehöhe").wert, "–");
  assert.match(zeile(b, "Gebäudehöhe").quelle, /Nicht eindeutig belegt/);
  assert.match(b.oerebStand, /älterer Stand/);
  assert.deepEqual(b.hinweise, ["Baureglement: Scan."]);
});

test("Blatt: unbelegte AZ verhindert die Volumenformel", () => {
  const b = blattVon(auswertung({
    unbelegt: ["ausnuetzungsziffer"],
    werte: { gebaeudelaenge: wert(20), gebaeudebreite: wert(12), gebaeudehoehe: wert(7), firsthoehe: wert(11) },
  }));
  assert.equal(b.berechnung.art, "keine");
});

test("Dateiname behält Umlaute und ersetzt alles Heikle", () => {
  assert.equal(kenndatenDateiname("Neubau Müller / Haus 2"), "Kenndatenblatt_Neubau_Müller_Haus_2.pdf");
  assert.equal(kenndatenDateiname("../.."), "Kenndatenblatt_.._...pdf");
  assert.equal(kenndatenDateiname("  "), "Kenndatenblatt_Projekt.pdf");
});

test("Blatt: Liechtenstein heisst nicht «Kanton FL»", () => {
  const b = blattVon(auswertung(), { projekt: { ...projekt, municipality: "Vaduz", canton: "FL" } });
  assert.equal(b.ort, "Vaduz, Fürstentum Liechtenstein");
});
