/**
 * Gesamtprüfung: weitere Fälle gegen falsches Ausblenden (Kernrisiko) und Gegenproben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseNormText } from "./norm-structure";
import {
  buildMatcher,
  foreignZonesIn,
  sectionContextFromKey,
  sectionContextKey,
  selectSections,
  type SectionContext,
} from "./norm-sections";

const ctx = (zone: string, over: Partial<SectionContext> = {}): SectionContext => ({
  zone, zoneConfidence: "exact", layer: 4, normZone: null, fullTextLoaded: true, ...over,
});

function doc(nennung: string, titel: string, text = "Bestimmungen."): string {
  return `Art. 1 Zweck
Dieses Reglement gilt auch für die ${nennung}.
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

function shown(zone: string, titel: string, text?: string, nennung = zone, over: Partial<SectionContext> = {}): boolean {
  const p = parseNormText(doc(nennung, titel, text));
  const sel = selectSections(p, ctx(zone, over));
  const i = p.blocks.findIndex((b) => b.kind === "article" && b.label === "Art. 10");
  assert.ok(i >= 0, `Art. 10 «${titel}» nicht erkannt`);
  return sel.verdicts[i].show;
}

test("Gegenprobe: fremde Zone im Titel wird ausgeblendet (Filter wirkt)", () => {
  assert.equal(shown("W2", "Wohnzone W3"), false);
});

test("eigene Zone nur im Text des Artikels: sichtbar", () => {
  assert.equal(shown("W2", "Kernzone K", "Abs. 3: In der W2 gilt dies sinngemäss."), true);
});

test("Sammelbegriff im Text: «gilt sinngemäss für alle Zonen»", () => {
  assert.equal(shown("W2", "Kernzone K", "Gilt sinngemäss für alle Zonen."), true);
});

test("Langform-Projektzone «Kernzone», Reglement mit Unterzonen K1/K2: sichtbar", () => {
  assert.equal(shown("Kernzone", "Kernzone K1"), true);
});

test("Kleinschreibung bei manuell erfasster Zone «w2»", () => {
  assert.equal(shown("w2", "Wohnzone W2"), true);
  assert.equal(shown("w2", "Wohnzone W3"), false);
});

test("Zone mit Legende «Wohnzone 2 (W2)»", () => {
  assert.equal(shown("Wohnzone 2 (W2)", "Wohnzone W2", undefined, "W2"), true);
});

test("Konfidenz coarse/low: nie filtern", () => {
  assert.equal(shown("W2", "Wohnzone W3", undefined, "W2", { zoneConfidence: "coarse" }), true);
  assert.equal(shown("W2", "Wohnzone W3", undefined, "W2", { zoneConfidence: "low" }), true);
});

test("Ebene 3 (kantonal): nie filtern", () => {
  assert.equal(shown("W2", "Wohnzone W3", undefined, "W2", { layer: 3 }), true);
});

test("Volltext nicht geladen: nie filtern", () => {
  assert.equal(shown("W2", "Wohnzone W3", undefined, "W2", { fullTextLoaded: false }), true);
});

test("Sonderzeichen in manueller Zone werfen nicht", () => {
  for (const z of ["W2 [", "W2)", "a\-b", "Zone ö. B.", "?*+", "W2/30"]) {
    assert.doesNotThrow(() => shown(z, "Wohnzone W3"));
  }
});

// Befund: römische Ziffern. «Wohnzone II» meint in manchen Reglementen W2.
test("BEFUND: Projekt W2, Titel «Wohnzone II» (römisch) – im Zweifel zeigen", () => {
  assert.equal(shown("W2", "Wohnzone II"), true, "«Wohnzone II» wird bei Projekt W2 ausgeblendet");
});

test("BEFUND: Projekt W2, Titel «Zweigeschossige Wohnzone W II»", () => {
  assert.equal(shown("W2", "Zweigeschossige Wohnzone W II"), true);
});

// ── Römische Zonennummern (Nacharbeit) ──────────────────────────────────────

test("römisch: eigene Nummer in jeder Schreibweise sichtbar", () => {
  for (const titel of ["Wohnzone II", "Wohnzonen II", "Wohnzone W II", "W II", "W-II", "Zone II", "Zweigeschossige Wohnzone II"]) {
    assert.equal(shown("W2", titel), true, titel);
  }
  assert.equal(shown("W3", "Wohnzone III"), true);
  assert.equal(shown("W10", "Wohnzone X"), true);
  assert.equal(shown("K1", "Kernzone I"), true);
  assert.equal(shown("Wohnzone 2", "Wohnzone II"), true);
});

test("römisch: andere Nummer bleibt fremd wie bei arabischen Nummern", () => {
  // Gegenprobe arabisch, damit der Vergleich gilt.
  assert.equal(shown("W2", "Wohnzone 3"), false);
  assert.equal(shown("W2", "Wohnzone III"), false);
  assert.equal(shown("W2", "Wohnzone I"), false);
  assert.equal(shown("W2", "Wohnzone IV"), false);
  assert.equal(shown("W1", "Wohnzone II"), false);
});

test("römisch: andere Familie mit gleicher Nummer bleibt fremd («Kernzone II» bei W2)", () => {
  assert.equal(shown("W2", "Kernzone 2"), false);
  assert.equal(shown("W2", "Kernzone II"), false);
});

test("römisch: keine Treffer in Wörtern oder Kleinschreibung beim Kürzel", () => {
  const m = buildMatcher("W2");
  assert.deepEqual(foreignZonesIn("Wohnzone II", m), []);
  assert.notDeepEqual(foreignZonesIn("Wohnzone III", m), []);
  // «W ii» ist kein Kürzel; «WII» ohne Trenner zählt nicht als eigene Zone.
  assert.equal(m.roman.some((re) => { re.lastIndex = 0; return re.test("W ii"); }), false);
  assert.equal(m.roman.some((re) => { re.lastIndex = 0; return re.test("WII"); }), false);
  // Nummer über 10: keine römischen Muster.
  assert.deepEqual(buildMatcher("W12").roman, []);
});

// ── Konfidenz null mit Herkunft ÖREB (Nacharbeit) ───────────────────────────

test("Zone aus ÖREB ohne Konfidenz: unsicher, kein Filter", () => {
  const p = parseNormText(doc("W2", "Wohnzone W3"));
  const sel = selectSections(p, ctx("W2", { zoneConfidence: null, zoneSource: "oereb" }));
  assert.equal(sel.active, false);
  assert.equal(sel.inactive, "zone-unsure");
});

test("Manuell erfasste Zone ohne Konfidenz: Filter wie bisher", () => {
  assert.equal(shown("W2", "Wohnzone W3", undefined, "W2", { zoneConfidence: null, zoneSource: "manual" }), false);
  assert.equal(shown("W2", "Wohnzone W3", undefined, "W2", { zoneConfidence: null }), false);
  assert.equal(shown("W2", "Wohnzone W3", undefined, "W2", { zoneConfidence: null, zoneSource: null }), false);
});

test("Zone aus ÖREB exakt: Filter aktiv", () => {
  assert.equal(shown("W2", "Wohnzone W3", undefined, "W2", { zoneConfidence: "exact", zoneSource: "oereb" }), false);
});

// ── Kontext-Schlüssel gegen Zurückspringen nach Neuladen (Nacharbeit) ───────

test("Kontext-Schlüssel: gleiche Werte, neues Objekt ergibt gleichen Schlüssel", () => {
  const a = ctx("W2", { zoneSource: "oereb" });
  const b = { ...a };
  assert.notEqual(a, b);
  assert.equal(sectionContextKey(a), sectionContextKey(b));
  assert.equal(sectionContextKey({ ...a, layers: new Set([4, 3]) }), sectionContextKey({ ...a, layers: new Set([3, 4]) }));
});

test("Kontext-Schlüssel: jede geänderte Angabe ändert den Schlüssel", () => {
  const a = ctx("W2");
  const changes: Partial<SectionContext>[] = [
    { zone: "W3" }, { zoneConfidence: "coarse" }, { zoneSource: "oereb" }, { layer: 3 },
    { normZone: "W2" }, { fullTextLoaded: false }, { layers: new Set([3, 4]) },
  ];
  for (const c of changes) assert.notEqual(sectionContextKey({ ...a, ...c }), sectionContextKey(a), JSON.stringify(c));
  assert.equal(sectionContextKey(null), null);
  assert.equal(sectionContextKey(undefined), null);
});

test("Kontext-Schlüssel: Rückweg ergibt dieselbe Auswahl", () => {
  const a = ctx("W2", { layers: new Set([3, 4]), zoneSource: "manual" });
  const back = sectionContextFromKey(sectionContextKey(a));
  assert.ok(back);
  assert.deepEqual({ ...back, layers: Array.from(back.layers ?? []) }, { ...a, layers: [3, 4] });
  assert.equal(sectionContextFromKey(null), null);
  const plain = sectionContextFromKey(sectionContextKey(ctx("W2")));
  assert.equal(plain?.layers, undefined);
  const p = parseNormText(doc("W2", "Wohnzone W3"));
  assert.deepEqual(selectSections(p, back), selectSections(p, a));
});

// ── Bereiche und Aufzählungen in Langform (Nachbesserung tester) ────────────

function verdictOf(zone: string, titel: string, nennung = zone) {
  const p = parseNormText(doc(nennung, titel));
  const sel = selectSections(p, ctx(zone));
  const i = p.blocks.findIndex((b) => b.kind === "article" && b.label === "Art. 10");
  return sel.verdicts[i];
}

test("Langform-Bereich mit eigener Nummer: sichtbar und als eigene Zone markiert", () => {
  for (const titel of ["Wohnzonen I–III", "Wohnzonen 1 bis 3", "Zonen I und II", "Wohnzonen W I – W III"]) {
    assert.deepEqual(verdictOf("W2", titel), { show: true, ownZone: true }, titel);
  }
});

test("Langform-Bereich ohne eigene Nummer: nie fremd (wie arabische Bereiche), aber nicht eigene Zone", () => {
  assert.deepEqual(verdictOf("W2", "Wohnzonen IV–VI"), { show: true, ownZone: false });
  assert.deepEqual(verdictOf("W2", "Kernzonen I–III"), { show: true, ownZone: false });
});

test("Aufzählung mit wiederholtem Kürzel ohne eigene Nummer: arabisch fremd, römisch im Zweifel sichtbar", () => {
  assert.equal(verdictOf("W2", "Zonen W3 und W4").show, false);
  assert.equal(verdictOf("W2", "Kernzonen K3 und K4").show, false);
  // Römische Kürzel allein sind keine erkannte Zone; «Wohnzonen W …» nennt das eigene Präfix.
  assert.equal(verdictOf("W2", "Wohnzonen W III und W IV", "Wohnzone II").show, true);
  assert.equal(verdictOf("W2", "W III und W IV", "Wohnzone II").show, true);
});

test("«Zone II» allein: kein Beleg, je Artikel aber eigene Zone", () => {
  // Beleg über «Wohnzone II», Artikel nennt nur «Zone II»: sichtbar.
  assert.equal(verdictOf("W2", "Zone II", "Wohnzone II").show, true);
});
