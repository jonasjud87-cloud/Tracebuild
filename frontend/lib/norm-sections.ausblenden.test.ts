/**
 * Negativtests gegen falsches Ausblenden (Review). Grundsatz: im Zweifel zeigen. Jeder Fall ist ein Artikel,
 * der für die Projektzone gilt oder gelten kann und deshalb sichtbar bleiben muss. Dazu Gegenproben, dass
 * echte fremde Zonen weiterhin ausgeblendet werden und Kürzel nicht kollidieren.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseNormText, type ParsedNorm } from "./norm-structure";
import { selectSections, type SectionContext, type SectionSelection } from "./norm-sections";
import { zoneHits } from "./zone-mention";

const ctx = (zone: string): SectionContext => ({ zone, zoneConfidence: "exact", layer: 4, normZone: null, fullTextLoaded: true });

/**
 * Reglement mit drei allgemeinen Artikeln (nennen die Projektzone, damit Regel 6 greift), dem zu prüfenden
 * Art. 10, einem sicher fremden Art. 11 (damit der Filter aktiv ist) und einem allgemeinen Art. 12.
 */
function reglement(zone: string, titel: string, text = "Bestimmungen."): string {
  return `Art. 1 Zweck
Dieses Reglement gilt auch für die ${zone}.
Art. 2 Geltung
Gilt überall.
Art. 3 Vollzug
Der Gemeinderat vollzieht.
Art. 10 ${titel}
${text}
Art. 11 Zone für Sport und Freizeit SF9
Sportanlagen.
Art. 12 Schluss
Inkrafttreten.`;
}

function verdictOf(zone: string, titel: string, text?: string): { p: ParsedNorm; sel: SectionSelection; shown: boolean } {
  const p = parseNormText(reglement(zone, titel, text));
  const sel = selectSections(p, ctx(zone));
  const i = p.blocks.findIndex((b) => b.kind === "article" && b.label === "Art. 10");
  assert.ok(i >= 0, "Art. 10 nicht erkannt");
  return { p, sel, shown: sel.verdicts[i].show };
}

const mustShow = (zone: string, titel: string, text?: string) => {
  const { shown } = verdictOf(zone, titel, text);
  assert.equal(shown, true, `Projekt ${zone}: «${titel}» / «${text ?? ""}» darf nicht ausgeblendet werden`);
};

const mustHide = (zone: string, titel: string) => {
  const { shown } = verdictOf(zone, titel);
  assert.equal(shown, false, `Projekt ${zone}: «${titel}» ist eine fremde Zone`);
};

// ── Bereiche: eigene Zone liegt im Bereich ──────────────────────────────────

test("Bereich mit Gedankenstrich/Bindestrich/bis: eigene Zone im Bereich bleibt sichtbar", () => {
  mustShow("W2", "Wohnzonen W1–W3");
  mustShow("W2", "Wohnzonen W1-W3");
  mustShow("W2", "Wohnzonen W1 - W3");
  mustShow("W2", "W1 bis W3");
  mustShow("W2", "Zonen W1 bis W3");
  mustShow("W3", "Wohnzonen W2–W4");
  mustShow("WG3", "Wohn- und Gewerbezonen WG2–WG4");
  mustShow("G2", "Gewerbezonen G1–G3");
});

test("Bereich, der mit der eigenen Zone beginnt: «W2 - W4» / «W2-W4» nennt W2", () => {
  // zoneRegexes schliesst «W2 - X» als Zusatz «W2-B» aus und verliert dadurch die eigene Nennung.
  mustShow("W2", "Zonen W2 - W4");
  mustShow("W2", "Wohnzonen W2-W4");
});

// ── Sammeltitel und Aufzählungen ─────────────────────────────────────────────

test("Sammeltitel mit eigener Familie neben fremder bleibt sichtbar", () => {
  mustShow("W2", "Kernzone, Wohnzonen");
  mustShow("W2", "Wohnzonen, Kernzonen");
  mustShow("W2", "Kernzonen sowie Wohnzonen");
  mustShow("W2", "Wohn-, Kern- und Gewerbezonen");
});

test("Sammeltitel mit eigener Zone bleibt sichtbar (Gegenprobe, heute schon richtig)", () => {
  mustShow("W2", "Wohnzonen W2 und W3");
  mustShow("W3", "Wohnzonen W2 und W3");
  mustShow("W2", "Wohnzonen W2, W2a und W3");
  mustShow("W2", "Kern- und Wohnzone");
  mustShow("W2", "Wohnzone W3; Ausnahme für W2");
  mustShow("W2", "Wohnzone W3 (gilt sinngemäss für alle Wohnzonen)");
});

// ── Unterzonen ───────────────────────────────────────────────────────────────

test("Unterzone: «W2a/b» und «W2a, b» nennen W2b", () => {
  mustShow("W2b", "Wohnzonen W2a/b");
  mustShow("W2b", "Wohnzone W2a, b");
});

test("Unterzone W2a: Artikel der Stammzone «Wohnzone W2» kann gelten, im Zweifel zeigen", () => {
  mustShow("W2a", "Wohnzone W2");
});

// ── Überlagerungen mit Kürzeln ───────────────────────────────────────────────

test("Kürzel einer Überlagerung sind keine fremden Bauzonen", () => {
  mustShow("W2", "Grundwasserschutzzonen S1, S2 und S3");
  mustShow("W2", "Erdbebenzone Z1");
  mustShow("W2", "Lärmschutz, Zone ES3");
  mustShow("W2", "Schutzzone S2");
  mustShow("W2", "Gefahrenzonen H1 und H2");
});

// ── Fliesstext öffnet den Geltungsbereich ────────────────────────────────────

test("Fliesstext erweitert auf eigene Familie oder «andere Zonen»: sichtbar", () => {
  mustShow("W2", "Kernzone", "Für Bauten in der Wohnzone gelten diese Regeln sinngemäss.");
  mustShow("W2", "Kernzone", "Gilt auch für die anderen Bauzonen.");
  mustShow("W2", "Kernzone", "Gilt auch für die W 2.");
  mustShow("W2", "Kernzone", "Gilt in allen Wohnzonen.");
});

// ── Schreibweisen der eigenen Zone ──────────────────────────────────────────

test("Leerzeichen, Zeilenumbruch, Gross/Klein: eigene Zone wird erkannt", () => {
  for (const [zone, zeile] of [
    ["K4", "K 4"],
    ["K4", "K\n4"],
    ["G3", "G\n3"],
    ["GI5", "GI\n5"],
    ["W2", "w2"],
    ["W2", "W 2"],
  ] as const) {
    assert.ok(zoneHits(zeile, zone).eigene.length > 0, `${zone} in «${zeile}»`);
  }
  mustShow("K4", "Kernzonen K 1 und K 4");
  mustShow("K4", "Zonen K 3, K 4 und WG 2");
  mustShow("W2", "Wohnzone w2");
  mustShow("W2", "Wohnzone W 2");
});

test("Bindestrich-Variante «W-2» im Titel bei Projekt W2", () => {
  mustShow("W2", "Wohnzone W-2");
  mustShow("W2", "Gestaltung in Zonen K2 und W-2");
});

test("Fussnotenzeichen am Kürzel «W2¹» nennt die eigene Zone", () => {
  mustShow("W2", "Gestaltung in Zonen K2 und W2¹");
});

// ── Kürzel-Kollisionen: kein Teiltreffer ────────────────────────────────────

test("WG2 ist nicht W2: fremd, aber kein Teiltreffer der eigenen Zone", () => {
  const h = zoneHits("WG2", "W2");
  assert.equal(h.eigene.length, 0);
  assert.equal(h.fremde.length, 1);
  assert.equal(zoneHits("WG 2", "W2").eigene.length, 0);
  mustHide("W2", "WG2");
  mustHide("W2", "Wohn- und Gewerbezone WG 2");
});

test("KD2/K2 und DK2/D2 kollidieren nicht", () => {
  assert.equal(zoneHits("KD2", "K2").eigene.length, 0);
  assert.equal(zoneHits("K2", "KD2").eigene.length, 0);
  assert.equal(zoneHits("DK2", "D2").eigene.length, 0);
  assert.equal(zoneHits("D2", "DK2").eigene.length, 0);
  assert.equal(zoneHits("DK2", "K2").eigene.length, 0);
  mustHide("K2", "Kernzone KD2");
  mustHide("D2", "Dorfkernzone DK2");
});

test("Gegenprobe: echte fremde Zonen werden weiter ausgeblendet", () => {
  mustHide("W2", "Wohnzone W3");
  mustHide("W2", "Zone W3");
  mustHide("W2", "W3/W4");
  mustHide("W2", "Kernzone K");
  mustHide("W2", "Industriezone");
  mustHide("Wohnzone W2", "Wohnzone W3");
});

// ── Kapitelbindung ──────────────────────────────────────────────────────────

test("Kapitelbindung läuft nicht über einen vom Parser nicht erkannten Kapitelkopf hinaus", () => {
  for (const kopf of ["Allgemeine Bauvorschriften", "C Allgemeine Bauvorschriften", "3 Allgemeine Bauvorschriften", "ALLGEMEINE BAUVORSCHRIFTEN"]) {
    const text = `I. Allgemeines
Art. 1 Zweck
Für die W2 gilt dies.
Art. 2 Geltung
Gilt.
II. Kernzonen
Art. 10 Gestaltung
Dächer.
Art. 11 Nutzung
Mässig störend.
${kopf}
Art. 30 Grenzabstand
Der Grenzabstand beträgt 4 m.
Art. 31 Gebäudehöhe
Höchstens 12 m.`;
    const p = parseNormText(text);
    const sel = selectSections(p, ctx("W2"));
    for (const label of ["Art. 30", "Art. 31"]) {
      const i = p.blocks.findIndex((b) => b.kind === "article" && b.label === label);
      assert.equal(sel.verdicts[i].show, true, `${label} nach «${kopf}» darf nicht ausgeblendet werden`);
    }
  }
});

// ── Projektzone in Langform ─────────────────────────────────────────────────

test("Langform der Projektzone und Kurzform im Reglement: «Wohnzone 2» vs «Zone 2»", () => {
  mustShow("Wohnzone 2", "Zone 2");
});
