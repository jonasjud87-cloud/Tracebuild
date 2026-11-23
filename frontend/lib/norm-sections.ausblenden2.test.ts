/**
 * Review Runde 2: Negativtests gegen falsches Ausblenden nach den grosszügigeren Regeln, dazu Gegenproben,
 * dass der Filter nicht wirkungslos geworden ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseNormText } from "./norm-structure";
import { selectSections, type SectionContext } from "./norm-sections";

const ctx = (zone: string): SectionContext => ({ zone, zoneConfidence: "exact", layer: 4, normZone: null, fullTextLoaded: true });

function reglement(zone: string, titel: string, text: string): string {
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

function shown(zone: string, titel: string, text = "Bestimmungen."): boolean {
  const p = parseNormText(reglement(zone, titel, text));
  const sel = selectSections(p, ctx(zone));
  const i = p.blocks.findIndex((b) => b.kind === "article" && b.label === "Art. 10");
  assert.ok(i >= 0, `Art. 10 «${titel}» nicht erkannt`);
  return sel.verdicts[i].show;
}

const mustShow = (zone: string, titel: string, text?: string) =>
  assert.equal(shown(zone, titel, text), true, `Projekt ${zone}: «${titel}» darf nicht ausgeblendet werden`);
const mustHide = (zone: string, titel: string, text?: string) =>
  assert.equal(shown(zone, titel, text), false, `Projekt ${zone}: «${titel}» ist eine fremde Zone`);

// ── Falsch ausgeblendet (Runde 2) ───────────────────────────────────────────

test("Kurzaufzählung mit eigener Nummer: «W1/2», «W 1/2», «W1 und 2»", () => {
  mustShow("W2", "Zonen W1/2");
  mustShow("W2", "Wohnzone W 1/2");
  mustShow("W2", "Wohnzone W1 und 2");
});

test("Stammkürzel ohne Nummer mit eigenem Präfix: «Wohnzone W» bei W2", () => {
  mustShow("W2", "Wohnzone W");
  mustShow("W2", "Kernzone K, Wohnzone W");
});

test("(a) Projekt W2, Unterzonen W2a/W2b im Reglement: im Zweifel zeigen", () => {
  // ÖREB nennt oft nur die Stammzone, das Reglement unterscheidet Unterzonen. Welche gilt, ist unbekannt.
  mustShow("W2", "Wohnzone W2a");
  mustShow("W2", "Wohnzonen W2a und W2b");
});

// ── Heute richtig: bleibt sichtbar ──────────────────────────────────────────

test("Bereiche und Kurzformen bleiben sichtbar", () => {
  mustShow("W2", "Zonen W1–W3");
  mustShow("W2", "Wohnzonen W1 bis 3");
  mustShow("W2", "Wohnzonen W 1 – W 3");
  mustShow("W2", "Zonen W2-W4");
  mustShow("W2", "Zonen W 2 - W 4");
  mustShow("W2", "Zonen W1-2");
  mustShow("W2", "Wohnzone W1/W2");
  mustShow("W2", "Wohnzonen W1 + W2");
});

test("Fliesstext öffnet auf die eigene Zone oder Familie", () => {
  mustShow("W2", "Wohnzone W3", "Für die W2 gilt Abs. 2.");
  mustShow("W2", "Wohnzone W3", "Für die Wohnzone 2 gilt Abs. 2.");
  mustShow("W2", "Kernzone K", "Gilt auch für Wohnzonen.");
  mustShow("W2", "Kernzone K", "Abs. 2 gilt für Zone 2 sinngemäss.");
  mustShow("W2", "Wohnzonen W1, W3", "Für die übrigen Wohnzonen gilt Abs. 1.");
});

test("Titel mit eigener Familie neben fremder Zone", () => {
  mustShow("W2", "Kernzone (gilt auch für Wohnzonen)");
  mustShow("W2", "Wohnzonen W3-W4, Kernzone");
  mustShow("G", "Gewerbe-Industriezone GI");
  mustShow("GI", "Industriezone");
});

// ── Gegenproben: Filter wirkt weiterhin ─────────────────────────────────────

test("Gegenprobe: fremde Zonen mit Kürzel werden ausgeblendet", () => {
  mustHide("W2", "Wohnzone W3", "Die Wohnzone W3 ist für Wohnbauten bestimmt.");
  mustHide("W2", "Kernzone K", "Die Kernzone bezweckt die Erhaltung des Ortsbildes.");
  mustHide("W2", "Kernzone", "Neubauten haben sich einzuordnen.");
  mustHide("W2", "Gewerbezone G", "Mässig störende Betriebe.");
  mustHide("W2", "Wohn- und Gewerbezone WG3", "In der Wohn- und Gewerbezone sind mässig störende Betriebe zulässig.");
  mustHide("W2", "Wohnzonen W3 und W4");
  mustHide("W2", "W3/W4");
  mustHide("W2", "Mischzone WG2");
  mustHide("W2", "Zone 3");
  mustHide("W2", "Industriezone I");
  mustHide("W12", "Wohnzone W1");
  mustHide("W1", "Wohnzone W12");
  mustHide("D2", "Kernzone K2");
  mustHide("KD2", "Kernzone K2");
  mustHide("K2", "Wohnzonen");
});

test("Gegenprobe: ganzes Musterreglement filtert die fremden Zonenartikel", () => {
  const text = `I. Allgemeine Bestimmungen
Art. 1 Zweck
Dieses Reglement ordnet das Bauen.
Art. 2 Geltungsbereich
Es gilt für das ganze Gemeindegebiet.
II. Zonenvorschriften
Art. 20 Wohnzone W2
In der W2 sind zwei Vollgeschosse zulässig.
Art. 21 Wohnzone W3
Drei Vollgeschosse sind zulässig.
Art. 22 Kernzone K
Die Kernzone dient der Erhaltung des Ortskerns.
Art. 23 Gewerbezone G
In der Gewerbezone sind mässig störende Betriebe zulässig.
Art. 24 Industriezone I
Industriebetriebe sind zulässig.
III. Verfahren
Art. 40 Baugesuch
Das Baugesuch ist schriftlich einzureichen.`;
  const p = parseNormText(text);
  const sel = selectSections(p, ctx("W2"));
  assert.equal(sel.active, true);
  const hidden = p.blocks.flatMap((b, i) => (b.kind === "article" && !sel.verdicts[i].show ? [b.label] : []));
  assert.deepEqual(hidden, ["Art. 21", "Art. 22", "Art. 23", "Art. 24"]);
});
