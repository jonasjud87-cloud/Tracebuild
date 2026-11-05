import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { baueKenndatenBlatt } from "./kenndaten";
import { waehleWerte, type BelegNorm, type KenndatenKandidat } from "./kenndaten-beleg";
import { layoutPageText, pdfLayoutText, type LayoutItem } from "./kenndaten-pdf";

/**
 * Auszug aus dem Baureglement Quarten (oereblex.sg.ch, Attachment 17750): die pdfjs-Koordinaten von Art. 16
 * und Art. 21. Im gespeicherten Text steht diese Tabelle spaltenweise, und in einer einfachen Layout-
 * Extraktion rutscht die Spalte «First» um Zeilen: W2 hat dort 14.0 statt 11.0.
 */
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/kenndaten-quarten.json", import.meta.url), "utf8")) as Record<string, [string, number, number, number, number][]>;
const items = (key: string): LayoutItem[] => fixture[key].map(([str, x, y, width, height]) => ({ str, x, y, width, height }));

const text = `${layoutPageText(items("art16"))}\n\n${layoutPageText(items("art21"))}`;
const zeileVon = (start: RegExp) => text.split("\n").find((l) => start.test(l.trim()))!.trim().replace(/\s+/g, " ");

const REIHE_W2 = "W2 / 4)WG2 2 0.45 max. 4 8 25 7.5 11.0";

test("Layout: Die Tabelle steht zeilengetreu, die Spalte First bleibt in der Zeile", () => {
  assert.equal(zeileVon(/^W2 \/ /), REIHE_W2);
  assert.equal(zeileVon(/^W2-B/), "W2-B 2 0.40 4 8 20 7.5 10.5");
  assert.equal(zeileVon(/^W1/), "W1 1 0.35 4 8 20 5.0 8.5");
  assert.equal(zeileVon(/^Hauptbauten/), "Hauptbauten 4.00 m 4.00 m 3.00 m 2.00 m");
});

test("Layout: Spalten bleiben untereinander, auch wo eine Zelle fehlt", () => {
  const lines = text.split("\n");
  const at = (start: RegExp, value: string) => {
    const line = lines.find((l) => start.test(l.trim()))!;
    return line.lastIndexOf(value);
  };
  assert.ok(Math.abs(at(/^W1/, " 4 ") - at(/^W2 \/ /, " 4 ")) <= 1, "Grenzabstand klein");
  assert.ok(Math.abs(at(/^W1/, " 20 ") - at(/^W2 \/ /, " 25 ")) <= 1, "Länge");
});

test("Layout: Hochgestellte Fussnotenzeichen gehören in die Zeile, nahe Zeilen bleiben getrennt", () => {
  const out = layoutPageText([
    { str: "4)", x: 100, y: 97, width: 6, height: 7 },
    { str: "WG2", x: 106, y: 100, width: 20, height: 10 },
    { str: "nächste", x: 100, y: 112, width: 30, height: 10 },
  ]);
  assert.equal(out, "4)WG2\nnächste");
});

test("Layout: Fliesstext bleibt ohne Spaltenabstand", () => {
  assert.equal(
    layoutPageText([
      { str: "Die", x: 100, y: 100, width: 15, height: 10 },
      { str: "Gebäude", x: 118, y: 100, width: 40, height: 10 },
    ]),
    "Die Gebäude",
  );
});

// ── Erwartung am Quartner Reglement, Zone W2 ─────────────────────────────────

const norm: BelegNorm = { title: "Baureglement Quarten", layer: 4, text };

const inW2 = (over: Partial<KenndatenKandidat>): KenndatenKandidat => ({
  feld: "vollgeschosse",
  zahl: null,
  einheit: "",
  text: null,
  zusatz: null,
  bezeichnung: null,
  normIndex: 1,
  artikel: "Art. 16",
  zitat: REIHE_W2,
  zoneImText: "W2 / WG2",
  giltFuerAlleZonen: false,
  ...over,
});

const antwort: KenndatenKandidat[] = [
  inW2({ feld: "vollgeschosse", zahl: 2 }),
  inW2({ feld: "ausnuetzungsziffer", zahl: 0.45, zusatz: "Mehrausnützung max. 20 % mit Überbauungsplan" }),
  inW2({ feld: "grenzabstand_klein", zahl: 4, einheit: "m" }),
  inW2({ feld: "grenzabstand_gross", zahl: 8, einheit: "m" }),
  inW2({ feld: "gebaeudelaenge", zahl: 25, einheit: "m", zusatz: "Mehrlängenzuschlag ab 20 m" }),
  inW2({ feld: "gebaeudehoehe", zahl: 7.5, einheit: "m" }),
  inW2({ feld: "firsthoehe", zahl: 11, einheit: "m" }),
  inW2({
    feld: "strassenabstand",
    artikel: "Art. 21",
    zitat: "Hauptbauten 4.00 m 4.00 m 3.00 m 2.00 m",
    zoneImText: "alle",
    giltFuerAlleZonen: true,
    zusatz: "Staatsstrassen 4.00 m, Gemeindestrassen 1. + 2. Kl. 4.00 m, 3. Kl. 3.00 m, Gemeindewege 2.00 m; Baulinie geht vor",
  }),
];

test("Quarten W2: alle erwarteten Werte bestehen die Prüfung", () => {
  const a = waehleWerte(antwort, [norm], "W2");
  assert.deepEqual(a.unbelegt, []);
  assert.equal(a.verworfen, 0);
  assert.equal(a.werte.vollgeschosse?.zahl, 2);
  assert.equal(a.werte.ausnuetzungsziffer?.zahl, 0.45);
  assert.equal(a.werte.grenzabstand_klein?.zahl, 4);
  assert.equal(a.werte.grenzabstand_gross?.zahl, 8);
  assert.equal(a.werte.gebaeudelaenge?.zahl, 25);
  assert.equal(a.werte.gebaeudelaenge?.zusatz, "Mehrlängenzuschlag ab 20 m");
  assert.equal(a.werte.gebaeudehoehe?.zahl, 7.5);
  assert.equal(a.werte.firsthoehe?.zahl, 11);
  assert.equal(a.werte.dachform, undefined);
  assert.equal(a.werte.strassenabstand?.zahl, null);
  assert.match(a.werte.strassenabstand!.zusatz!, /Baulinie geht vor$/);

  const blatt = baueKenndatenBlatt({
    projekt: { name: "P", municipality: "Quarten", canton: "SG", parcel: "1", bauzone: "W2", zoneSource: "oereb", zoneConfidence: "exact" },
    landflaeche: 1000,
    oerebFetchedAt: null,
    oerebStale: false,
    auswertung: a,
    jetzt: new Date("2026-11-05T10:00:00Z"),
  });
  const wert = (name: string) => blatt.zeilen.find((z) => z.bezeichnung === name)!.wert;
  assert.equal(wert("Firsthöhe"), "11.00 m");
  assert.equal(wert("Gebäudelänge"), "25.00 m (Mehrlängenzuschlag ab 20 m)");
  assert.equal(wert("Dachform"), "–");
  assert.deepEqual(blatt.berechnung.zeilen, ["1'000.00 m² x 0.45 (AZ) = 450.00 m²"]);
});

test("Quarten W2: Falsche Werte fallen durch", () => {
  const faelle: [string, Partial<KenndatenKandidat>][] = [
    ["First 14.0 mit erfundener Reihe", { feld: "firsthoehe", zahl: 14, einheit: "m", zitat: "W2 / 4)WG2 2 0.45 max. 4 8 25 7.5 14.0" }],
    ["First 14.0 aus der Reihe W3", { feld: "firsthoehe", zahl: 14, einheit: "m", zitat: zeileVon(/^W3 \/ /) }],
    ["First 14.0 mit der Reihe W2", { feld: "firsthoehe", zahl: 14, einheit: "m" }],
    ["AZ 0.40 aus W2-B", { feld: "ausnuetzungsziffer", zahl: 0.4, zitat: "W2-B 2 0.40 4 8 20 7.5 10.5" }],
    ["Länge 20 aus W2-B", { feld: "gebaeudelaenge", zahl: 20, einheit: "m", zitat: "W2-B 2 0.40 4 8 20 7.5 10.5" }],
    ["Mehrausnützung als AZ", { feld: "ausnuetzungsziffer", zahl: 0.2, zitat: "20 %" }],
  ];
  for (const [name, over] of faelle) {
    const a = waehleWerte([inW2(over)], [norm], "W2");
    assert.deepEqual(a.werte, {}, name);
    assert.equal(a.verworfen, 1, name);
  }
});

test("Fussnote 2 belegt den Mehrlängenzuschlag", () => {
  assert.match(text.replace(/\s+/g, " "), /Mehrlängenzuschlag: in den Zonen W, WG, D sowie OE sind ab 20 m/);
});

// ── Das ganze PDF, nur wenn es lokal liegt ───────────────────────────────────

const PDF = process.env.KENNDATEN_QUARTEN_PDF;

test("Echtes PDF: gleiche Zeile, kein Scan, im Zeitrahmen", { skip: !PDF || !existsSync(PDF) }, async () => {
  const startedAt = Date.now();
  const r = await pdfLayoutText(new Uint8Array(readFileSync(PDF!)), { timeoutMs: 15_000 });
  assert.equal(r.scan, false);
  assert.equal(r.pages, 43);
  assert.ok(r.text.split("\n").some((l) => l.trim().replace(/\s+/g, " ") === REIHE_W2));
  assert.ok(Date.now() - startedAt < 15_000);
});

test("Ein unlesbares PDF wirft, die Route fällt dann auf den gespeicherten Text zurück", async () => {
  await assert.rejects(pdfLayoutText(new TextEncoder().encode("%PDF-1.4 kaputt")));
});
