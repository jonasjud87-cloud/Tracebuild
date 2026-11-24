/**
 * Tester-Nachprüfung römische Zonennummern: Bereiche, Wortgrenzen, Aktivierung, Laufzeit.
 * Grundsatz: im Zweifel zeigen. Was eine geltende Zone betreffen kann, darf nie ausgeblendet werden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseNormText } from "./norm-structure";
import { buildMatcher, foreignZonesIn, selectSections, type SectionContext } from "./norm-sections";

const ctx = (zone: string, over: Partial<SectionContext> = {}): SectionContext => ({
  zone, zoneConfidence: "exact", layer: 4, normZone: null, fullTextLoaded: true, ...over,
});

/** Dokument in römischer Schreibweise. Nennt die eigene Zone (Beleg) über `nennung`. */
function doc(nennung: string, titel: string): string {
  return `Art. 1 Zweck
Dieses Reglement gilt für die ${nennung}.
Art. 2 Geltung
Gilt überall.
Art. 3 Vollzug
Der Gemeinderat vollzieht.
Art. 10 ${titel}
Bestimmungen.
Art. 11 Zone für Sport und Freizeit SF9
Sportanlagen.
Art. 12 Schluss
Inkrafttreten.`;
}

function verdict(zone: string, titel: string, nennung: string) {
  const p = parseNormText(doc(nennung, titel));
  const sel = selectSections(p, ctx(zone));
  const i = p.blocks.findIndex((b) => b.kind === "article" && b.label === "Art. 10");
  assert.ok(i >= 0, `Art. 10 «${titel}» nicht erkannt`);
  return { show: sel.verdicts[i].show, active: sel.active, inactive: sel.inactive };
}

// ── Kernrisiko: römische Bereiche und Aufzählungen ──────────────────────────

const BEREICHE = [
  "Wohnzonen I–III",
  "Wohnzonen I - III",
  "Wohnzonen I bis III",
  "Wohnzone I–III",
  "Wohnzonen W I – W III",
  "W I – W III",
  "Zonen I und II",
  "Wohnzonen I und II",
  "Wohnzonen I, II und III",
  "Wohnzonen I/II",
];

// BEFUND (neu durch die Nacharbeit): Dokument nur römisch war bisher «zone-not-named» (alles sichtbar).
for (const titel of BEREICHE) {
  test(`römischer Bereich mit eigener Nummer «${titel}» bei W2 sichtbar`, () => {
    // Beleg im Dokument römisch: «Wohnzone II» (seit der Nacharbeit eigene Zone, Filter wird aktiv).
    assert.equal(verdict("W2", titel, "Wohnzone II").show, true, titel);
  });
}

// BEFUND (schon auf main): Langform mit arabischem Bereich gilt als fremd, RANGE_RE greift nur bei Kürzeln.
for (const titel of ["Wohnzonen 1–3", "Wohnzonen 1 bis 3", "Wohnzonen 1 und 2", "Wohnzonen 1/2"]) {
  test(`arabischer Bereich in Langform «${titel}» bei W2 sichtbar`, () => {
    assert.equal(verdict("W2", titel, "W2").show, true, titel);
  });
}

test("Unterzone der eigenen Nummer: «Wohnzone IIa» wie «Wohnzone 2a» bei W2 sichtbar", () => {
  assert.equal(verdict("W2", "Wohnzone 2a", "W2").show, true);
  assert.equal(verdict("W2", "Wohnzone IIa", "Wohnzone II").show, true);
});

test("Gegenprobe: fremde Nummer bleibt fremd («Wohnzone III», «Wohnzone W3» bei W2)", () => {
  assert.equal(verdict("W2", "Wohnzone III", "Wohnzone II").show, false);
  assert.equal(verdict("W2", "Wohnzone W3", "W2").show, false);
});

// ── Wortgrenzen: Gliederungswörter mit römischer Zahl sind nie fremd ────────

test("«Kapitel II», «Abschnitt II», «Teil II», «Anhang II» im Titel: nie fremd", () => {
  const m = buildMatcher("W2");
  for (const t of ["Kapitel II", "Abschnitt II", "Teil II", "Anhang II", "Art. II", "Abschnitt VII", "Titel III"]) {
    assert.deepEqual(foreignZonesIn(t, m), [], t);
  }
});

test("«W VII», «Wohnzone VII», «Zone IIa» gelten nicht als eigene Zone W2", () => {
  const m = buildMatcher("W2");
  const own = (t: string) => m.roman.some((re) => { re.lastIndex = 0; return re.test(t); });
  assert.equal(own("W VII"), false);
  assert.equal(own("Wohnzone VII"), false);
  // Unterzone wie bei Kürzeln: Projekt W2 (ohne Unterzone) trifft «W2a», also auch «IIa».
  assert.equal(own("Wohnzone IIa"), true);
  assert.equal(own("Wohnzone IIIa"), false);
  assert.equal(buildMatcher("W2b").roman.some((re) => { re.lastIndex = 0; return re.test("Wohnzone IIa"); }), false);
  assert.equal(buildMatcher("W2b").roman.some((re) => { re.lastIndex = 0; return re.test("Wohnzone IIb"); }), true);
  assert.equal(own("Zone III"), false);
  assert.equal(own("Zone II"), true);
});

// ── Aktivierung: Beleg der eigenen Zone nur über «Zone II» ──────────────────

test("«Grundwasserschutz Zone II» im Text ist kein Beleg für W2 (kein Filter)", () => {
  const p = parseNormText(doc("Grundwasserschutz Zone II", "Wohnzone W3"));
  const sel = selectSections(p, ctx("W2"));
  // «Zone II» bzw. «Zone 2» ohne Familienwort nennt auch Schutzzonen: zählt nur je Artikel, nicht als Beleg.
  assert.equal(sel.active, false);
  assert.equal(sel.inactive, "zone-not-named");
  const arabisch = selectSections(parseNormText(doc("Grundwasserschutz Zone 2", "Wohnzone W3")), ctx("W2"));
  assert.equal(arabisch.inactive, "zone-not-named");
});

// ── Laufzeit: kein katastrophales Backtracking ──────────────────────────────

test("lange Texte mit vielen Leerzeichen und Ziffern laufen schnell", () => {
  const m = buildMatcher("Wohnzone 2 (W2)");
  const bad = [
    "W" + " ".repeat(20000) + "-",
    "Wohnzone" + "- ".repeat(10000) + "IIx",
    "Zone " + "I".repeat(20000),
    ("W - II ").repeat(5000) + "Kernzone",
  ];
  for (const t of bad) {
    const t0 = performance.now();
    foreignZonesIn(t, m);
    for (const re of m.roman) { re.lastIndex = 0; Array.from(t.matchAll(re)); }
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `zu langsam: ${ms.toFixed(0)} ms`);
  }
});
