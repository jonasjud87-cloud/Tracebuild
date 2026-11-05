import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { baueKenndatenBlatt, type KenndatenWerte } from "./kenndaten";
import { KENNDATEN_FUSSZEILE, buildKenndatenDoc, pdfText } from "./kenndaten-report";

const wert = (zahl: number, artikel: string) => ({ zahl, text: null, zusatz: null, bezeichnung: null, normTitle: "Baureglement Musterdorf", artikel, layer: 4 });

const voll: KenndatenWerte = {
  vollgeschosse: wert(2, "Art. 5"),
  ausnuetzungsziffer: wert(0.5, "Art. 7"),
  grenzabstand_gross: wert(7.5, "Art. 9"),
  grenzabstand_klein: wert(3.5, "Art. 9"),
  gebaeudelaenge: { ...wert(25, "Art. 10"), zusatz: "Mehrlängenzuschlag ab 15.00 m" },
  gebaeudehoehe: wert(7.4, "Art. 11"),
  firsthoehe: wert(11.2, "Art. 11"),
  dachform: { zahl: null, text: "Satteldach", zusatz: null, bezeichnung: null, normTitle: "Baureglement Musterdorf", artikel: "Art. 12", layer: 4 },
  strassenabstand: wert(6, "Art. 13"),
};

const blatt = (werte: KenndatenWerte, name = "Neubau Müller", hinweise: string[] = []) =>
  baueKenndatenBlatt({
    projekt: { name, municipality: "Musterdorf", canton: "ZH", parcel: "1234", bauzone: "W2", zoneSource: "oereb", zoneConfidence: "exact" },
    landflaeche: 1839,
    oerebFetchedAt: "2026-11-04T10:00:00Z",
    oerebStale: false,
    auswertung: { werte, widerspruechlich: [], unbelegt: [], verworfen: 0, hinweise, vorbehalt: false },
    jetzt: new Date("2026-11-05T10:00:00Z"),
  });

/** Der Inhalt der PDF-Textbefehle. Die Standardschrift ist einbyteig, jsPDF schreibt unkomprimiert. */
function pdfStrings(doc: ReturnType<typeof buildKenndatenDoc>): string {
  const raw = Buffer.from(doc.output("arraybuffer")).toString("latin1");
  return Array.from(raw.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g), (m) => m[1].replace(/\\([()\\])/g, "$1")).join("\n");
}

test("PDF enthält Kopf, Kenndaten, Rechnung, Stand und Fusszeile auf einer A4-Seite", () => {
  const doc = buildKenndatenDoc(blatt(voll), null);
  assert.equal(doc.getNumberOfPages(), 1);
  assert.equal(Math.round(doc.internal.pageSize.getWidth()), 210);

  const text = pdfStrings(doc);
  for (const expected of [
    "Kenndatenblatt", "Neubau Müller", "Musterdorf, Kanton ZH", "1234", "05.11.2026",
    "KENNDATEN", "Bezeichnung", "Wert", "Quelle",
    "Zone", "W2", "Landfläche", "1'839.00 m²", "Ausnützungsziffer", "0.50",
    "Satteldach", "Baureglement Musterdorf, Art. 7", "Strassenabstand", "6.00 m",
    "BERECHNUNGEN", "Max. anrechenbare Geschossfläche, theoretisch", "1'839.00 m² x 0.50 (AZ) = 919.50 m²",
    "Stand ÖREB-Auszug: 04.11.2026",
  ]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(text.includes("Keine behördliche Auskunft"), "Fusszeile");
  assert.ok(KENNDATEN_FUSSZEILE.startsWith("Automatisch aus den zugewiesenen Normen"));
});

test("PDF zeigt den Richtwert samt angenommener Geschosshöhe", () => {
  const { ausnuetzungsziffer: _az, gebaeudelaenge: _l, ...rest } = voll;
  const text = pdfStrings(buildKenndatenDoc(blatt({ ...rest, gebaeudelaenge: wert(20, "Art. 10"), gebaeudebreite: wert(12, "Art. 10") }), null));
  assert.ok(text.includes("20.00 m / Breite 12.00 m"));
  assert.ok(text.includes("20.00 m x 12.00 m x ((7.40 m + 11.20 m) : 2) = 2'232.00 m³"));
  assert.ok(text.includes("2'232.00 m³ : 3.00 m = ca. 740 m²"));
  assert.ok(text.includes("Grober Richtwert"));
});

test("PDF ohne Werte: Striche und die Meldung statt einer Rechnung", () => {
  const text = pdfStrings(buildKenndatenDoc(blatt({}), null));
  assert.ok(text.includes("mangels Werten"));
  assert.ok(!text.includes("(AZ) ="));
});

test("Auch mit langen Bezeichnungen und Quellen bleibt es bei einer Seite", () => {
  const lang = "Bau- und Zonenordnung der Gemeinde Musterdorf vom 1. Januar 2020 mit Änderungen";
  const werte = Object.fromEntries(Object.entries(voll).map(([k, v]) => [k, { ...v, normTitle: lang, zusatz: "bei Bauten über 15.00 m Länge gilt ein Zuschlag" }]));
  const hinweise = ["Baureglement: Das Original ist ein Scan ohne Textlayer. Werte aus dem gespeicherten Text; ohne eindeutige Bindung an die Zone bleiben sie leer."];
  const doc = buildKenndatenDoc(blatt(werte, "Sehr langer Projektname ".repeat(8), hinweise), null);
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(pdfStrings(doc).includes("Scan ohne Textlayer"));
});

test("Das Logo wird eingebettet, auch das echte", () => {
  const logo = `data:image/png;base64,${readFileSync(new URL("../public/tracebuild-logo.png", import.meta.url)).toString("base64")}`;
  const raw = Buffer.from(buildKenndatenDoc(blatt(voll), logo).output("arraybuffer")).toString("latin1");
  assert.match(raw, /\/Subtype \/Image/);
});

test("pdfText: Nur was die Standardschrift kann", () => {
  assert.equal(pdfText("Müller – 1'839.00 m²"), "Müller – 1'839.00 m²");
  assert.equal(pdfText("≥ 3 m"), "mind. 3 m");
  assert.equal(pdfText("Dvořák"), "Dvorák");
  assert.equal(pdfText("Zeile\neins"), "Zeile eins");
  assert.equal(pdfText("→"), "?");
});
