import { test } from "node:test";
import assert from "node:assert/strict";

import { parseNormText, type ArticleBlock, type NormBlock, type ParsedNorm } from "./norm-structure";
import { hiddenRuns, runLabel, runSummary, selectSections, type SectionContext, type SectionSelection } from "./norm-sections";

const REGLEMENT = `I. Allgemeine Bestimmungen
Art. 1 Zweck
1 Dieses Reglement ordnet das Bauen in der Gemeinde.
Art. 2 Geltungsbereich
Es gilt für das ganze Gemeindegebiet.
Art. 3 Zuständigkeit
Der Gemeinderat vollzieht dieses Reglement.
II. Zonenvorschriften
Art. 20 Wohnzone W2
1 In der W2 sind zwei Vollgeschosse zulässig.
Art. 21 Wohnzone W3
1 Drei Vollgeschosse sind zulässig.
-- 3 of 9 --
Art. 22 Kernzone K
Die Kernzone dient der Erhaltung des Ortskerns.
Art. 23 Gewerbezone G
In der Gewerbezone sind mässig störende Betriebe zulässig.
III. Verfahren
Art. 40 Baugesuch
Das Baugesuch ist schriftlich einzureichen.
Art. 41 Baukontrolle
Die Baubehörde kontrolliert die Bauten.`;

const CTX: SectionContext = { zone: "W2", zoneConfidence: "exact", layer: 4, normZone: null, fullTextLoaded: true };

const articleAt = (p: ParsedNorm, label: string) => p.blocks.findIndex((b) => b.kind === "article" && b.label === label);
const hiddenLabels = (p: ParsedNorm, sel: SectionSelection) =>
  p.blocks.flatMap((b, i) => (b.kind === "article" && !sel.verdicts[i].show ? [b.label] : []));
const shown = (p: ParsedNorm, sel: SectionSelection, label: string) => sel.verdicts[articleAt(p, label)].show;
const allShown = (sel: SectionSelection) => sel.verdicts.every((v) => v.show);

/** Reglement mit drei allgemeinen Artikeln und einem zusätzlichen Zonenkapitel. */
function mitKapitel(kapitel: string): string {
  return `Art. 1 Zweck
Allgemeines für die W2.
Art. 2 Geltung
Gilt überall.
Art. 3 Vollzug
Der Gemeinderat vollzieht.
${kapitel}`;
}

function invariant(p: ParsedNorm, sel: SectionSelection) {
  assert.equal(sel.verdicts.length, p.blocks.length);
  assert.equal(sel.shownArticles + sel.hiddenArticles, p.articleCount);
}

// ── Positivfälle ─────────────────────────────────────────────────────────────

test("Reglement: fremde Zonenartikel ausgeblendet, allgemeine und eigene gezeigt", () => {
  const p = parseNormText(REGLEMENT);
  assert.equal(p.articleCount, 9);
  const sel = selectSections(p, CTX);
  assert.equal(sel.active, true);
  assert.equal(sel.inactive, null);
  assert.deepEqual(hiddenLabels(p, sel), ["Art. 21", "Art. 22", "Art. 23"]);
  assert.deepEqual(sel.verdicts[articleAt(p, "Art. 20")], { show: true, ownZone: true });
  for (const l of ["Art. 1", "Art. 2", "Art. 3", "Art. 40", "Art. 41"]) assert.ok(shown(p, sel, l), l);
  assert.equal(sel.hiddenArticles, 3);
  assert.equal(sel.shownArticles, 6);
  invariant(p, sel);
  // Kapitelköpfe ohne Zone bleiben stehen.
  p.blocks.forEach((b, i) => {
    if (b.kind === "heading") assert.equal(sel.verdicts[i].show, true, b.text);
  });
});

test("hiddenRuns: Art. 21–23 sind eine Folge", () => {
  const p = parseNormText(REGLEMENT);
  const sel = selectSections(p, CTX);
  const runs = hiddenRuns(sel, p.blocks);
  assert.equal(runs.length, 1);
  const [run] = runs;
  assert.deepEqual(run.labels, ["Art. 21", "Art. 22", "Art. 23"]);
  assert.deepEqual(run.zones, ["Wohnzone W3", "Kernzone K", "Gewerbezone G"]);
  assert.equal(run.from, articleAt(p, "Art. 21"));
  assert.equal(run.to, articleAt(p, "Art. 23"));
  assert.equal(runSummary(run), "Art. 21–23 gelten für Wohnzone W3, Kernzone K, Gewerbezone G.");
});

/** Von Hand gegliedert, damit Seitenmarken und Kopfzeilen auf oberster Ebene stehen. */
function art(label: string, title: string | null, text: string): ArticleBlock {
  return { kind: "article", label, rawLabel: label, title, page: null, body: [{ kind: "paragraph", number: null, marginal: null, text }] };
}

test("hiddenRuns: Seitenmarke und Kopfzeile zwischen ausgeblendeten Artikeln gehören zur Folge, am Rand nicht", () => {
  const blocks: NormBlock[] = [
    art("Art. 1", "Zweck", "Gilt für die W2."),
    art("Art. 2", "Geltung", "Überall."),
    { kind: "page", number: 2, total: null },
    art("Art. 21", "Wohnzone W3", "Drei Geschosse."),
    { kind: "page", number: 3, total: null },
    { kind: "lines", lines: ["Baureglement 2020"], variant: "header" },
    art("Art. 22", "Kernzone K", "Erhaltung."),
    { kind: "lines", lines: ["1 Fussnote zur W3"], variant: "footnote" },
    art("Art. 40", "Baugesuch", "Schriftlich."),
  ];
  const p: ParsedNorm = { blocks, articleCount: 5, pageCount: 3, structured: true };
  const sel = selectSections(p, CTX);
  assert.deepEqual(
    sel.verdicts.map((v) => v.show),
    [true, true, true, false, false, false, false, true, true],
  );
  const runs = hiddenRuns(sel, blocks);
  assert.deepEqual(runs.map((r) => [r.from, r.to]), [[3, 6]]);
  assert.equal(runSummary(runs[0]), "Art. 21–22 gelten für Wohnzone W3, Kernzone K.");
  invariant(p, sel);
});

test("Text ausserhalb von Artikeln bleibt immer sichtbar und trennt Folgen", () => {
  const blocks: NormBlock[] = [
    art("Art. 1", "Zweck", "Gilt für die W2."),
    art("Art. 21", "Wohnzone W3", "Drei Geschosse."),
    { kind: "paragraph", number: null, marginal: null, text: "Kernzone K: Übergangsbestimmung." },
    art("Art. 22", "Kernzone K", "Erhaltung."),
    { kind: "toc", entries: [{ label: "Kernzone K", page: "3" }] },
  ];
  const p: ParsedNorm = { blocks, articleCount: 3, pageCount: 0, structured: true };
  const sel = selectSections(p, CTX);
  assert.deepEqual(sel.verdicts.map((v) => v.show), [true, false, true, false, true]);
  assert.equal(hiddenRuns(sel, blocks).length, 2);
});

test("Kapitelkopf bindet nicht: Artikel ohne Zone im Titel bleiben unter «Kernzonen» sichtbar", () => {
  const p = parseNormText(
    mitKapitel(`II. Kernzonen
Art. 30 Zweck
Erhaltung des Ortsbilds.
Art. 31 Anbauten
Gilt auch für die W2.
Art. 32 Dächer
Steildächer sind Pflicht.
III. Schluss
Art. 40 Inkrafttreten
Der Gemeinderat bestimmt das Inkrafttreten.`),
  );
  const sel = selectSections(p, CTX);
  assert.equal(sel.inactive, "nothing-hidden");
  assert.ok(allShown(sel));
  invariant(p, sel);
});

test("Kapitelkopf fremd und alle Artikel aus eigenem Grund ausgeblendet: Kopf gehört zur Folge", () => {
  const p = parseNormText(
    mitKapitel(`II. Kernzonen
Art. 30 Kernzone K1
Erhaltung des Ortsbilds.
Art. 32 Kernzone K2
Steildächer sind Pflicht.
III. Schluss
Art. 40 Inkrafttreten
Der Gemeinderat bestimmt das Inkrafttreten.`),
  );
  const sel = selectSections(p, CTX);
  const heading = p.blocks.findIndex((b) => b.kind === "heading" && b.text === "II. Kernzonen");
  assert.equal(sel.verdicts[heading].show, false);
  const runs = hiddenRuns(sel, p.blocks);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].from, heading);
  assert.deepEqual(runs[0].labels, ["Art. 30", "Art. 32"]);
  assert.deepEqual(runs[0].zones, ["Kernzonen", "Kernzone K1", "Kernzone K2"]);
  // Ein Artikel darunter sichtbar: Kopf bleibt.
  const q = parseNormText(mitKapitel(`II. Kernzonen
Art. 30 Kernzone K1
Erhaltung.
Art. 31 Dächer
Steildächer.`));
  const sq = selectSections(q, CTX);
  assert.equal(sq.verdicts[q.blocks.findIndex((b) => b.kind === "heading")].show, true);
  assert.ok(shown(q, sq, "Art. 31"));
  assert.equal(shown(q, sq, "Art. 30"), false);
});

test("Konfidenz null (manuell erfasst) aktiviert den Filter", () => {
  const sel = selectSections(parseNormText(REGLEMENT), { ...CTX, zoneConfidence: null });
  assert.equal(sel.active, true);
});

test("Projektzone als Legende «Wohnzone 2 [W2]» wird über das Kürzel erkannt", () => {
  const p = parseNormText(REGLEMENT);
  const sel = selectSections(p, { ...CTX, zone: "Wohnzone 2 [W2]", zoneConfidence: null });
  assert.equal(sel.active, true);
  assert.ok(shown(p, sel, "Art. 20"));
  assert.equal(shown(p, sel, "Art. 21"), false);
});

test("Ebene über Parameter erweiterbar (später kantonal), Standard nur Gemeinde", () => {
  const p = parseNormText(REGLEMENT);
  assert.equal(selectSections(p, { ...CTX, layer: 3 }).inactive, "layer");
  assert.equal(selectSections(p, { ...CTX, layer: 3, layers: new Set([3, 4]) }).active, true);
});

// ── Negativfälle: Filter aus ─────────────────────────────────────────────────

test("Filter aus: Zone fehlt, unsicher, grob oder unbekannte Konfidenz", () => {
  const p = parseNormText(REGLEMENT);
  const cases: [Partial<SectionContext>, string][] = [
    [{ zone: null }, "no-zone"],
    [{ zone: "  " }, "no-zone"],
    [{ zoneConfidence: "low" }, "zone-unsure"],
    [{ zoneConfidence: "coarse" }, "zone-unsure"],
    [{ zoneConfidence: "none" }, "zone-unsure"],
  ];
  for (const [patch, reason] of cases) {
    const sel = selectSections(p, { ...CTX, ...patch });
    assert.equal(sel.active, false, reason);
    assert.equal(sel.inactive, reason);
    assert.ok(allShown(sel));
    assert.ok(sel.verdicts.every((v) => v.show && !v.ownZone), "ohne Filter keine Zonen-Chips");
    assert.equal(hiddenRuns(sel, p.blocks).length, 0);
    invariant(p, sel);
  }
});

test("Filter aus: Volltext nicht geladen (Vorschau, Ladefehler)", () => {
  const sel = selectSections(parseNormText(REGLEMENT), { ...CTX, fullTextLoaded: false });
  assert.equal(sel.inactive, "not-loaded");
  assert.ok(allShown(sel));
});

test("Filter aus: ungegliedert oder weniger als 3 Artikel", () => {
  const flat = parseNormText("Die Wohnzone W2 erlaubt zwei Geschosse. Die Kernzone K drei.");
  assert.equal(selectSections(flat, CTX).inactive, "unstructured");
  const zwei = parseNormText("Art. 20 Wohnzone W2\nZwei Geschosse.\nArt. 21 Wohnzone W3\nDrei Geschosse.");
  assert.equal(zwei.articleCount, 2);
  assert.equal(selectSections(zwei, CTX).inactive, "unstructured");
  assert.equal(selectSections(parseNormText(""), CTX).inactive, "unstructured");
});

test("Filter aus: Norm ist schon an eine Zone gebunden", () => {
  assert.equal(selectSections(parseNormText(REGLEMENT), { ...CTX, normZone: "W2" }).inactive, "zone-tagged");
  // Leerer Eintrag zählt nicht als Bindung.
  assert.equal(selectSections(parseNormText(REGLEMENT), { ...CTX, normZone: " " }).active, true);
});

test("Filter aus: Bund (RPG mit «Landwirtschaftszonen») und Kanton", () => {
  const rpg = parseNormText(`Art. 15 Bauzonen
Bauzonen werden so festgelegt.
Art. 16 Landwirtschaftszonen
Landwirtschaftszonen dienen der Landwirtschaft. Für W2 gilt nichts.
Art. 17 Schutzzonen
Schutzzonen umfassen Bäche.`);
  for (const layer of [1, 2, 3]) {
    const sel = selectSections(rpg, { ...CTX, layer });
    assert.equal(sel.inactive, "layer", `Ebene ${layer}`);
    assert.ok(allShown(sel));
  }
});

test("Filter aus: eigene Zone nirgends genannt (andere Schreibweise)", () => {
  const p = parseNormText(REGLEMENT);
  const sel = selectSections(p, { ...CTX, zone: "W2A" });
  assert.equal(sel.inactive, "zone-not-named");
  assert.ok(allShown(sel));
  // «Wohnzone zweigeschossig» kommt im Text nie vor.
  assert.equal(selectSections(p, { ...CTX, zone: "Wohnzone zweigeschossig", zoneConfidence: null }).inactive, "zone-not-named");
});

test("Filter aus: nichts auszublenden, keine Umschalt-UI", () => {
  const p = parseNormText(`Art. 1 Zweck
Für die W2 und alle anderen Zonen.
Art. 2 Geltung
Gilt überall.
Art. 3 Vollzug
Der Gemeinderat vollzieht.`);
  const sel = selectSections(p, CTX);
  assert.equal(sel.inactive, "nothing-hidden");
  assert.equal(hiddenRuns(sel, p.blocks).length, 0);
});

// ── Negativfälle: Artikel bleibt sichtbar ─────────────────────────────────────

/** Ergebnis für einen zusätzlichen Artikel 50 in einem Reglement, das W2 und W3 sonst nennt. */
function verdictFor(title: string, body: string, zone = "W2"): { shown: boolean; sel: SectionSelection; p: ParsedNorm } {
  const p = parseNormText(
    mitKapitel(`Art. 20 Wohnzone W3
Drei Geschosse.
Art. 50 ${title}
${body}
Art. 51 Schluss
Inkrafttreten.`).replace("Allgemeines für die W2.", `Allgemeines für die ${zone}.`),
  );
  const sel = selectSections(p, { ...CTX, zone });
  const idx = articleAt(p, "Art. 50");
  assert.ok(idx >= 0, `Art. 50 nicht erkannt: ${title}`);
  assert.equal((p.blocks[idx] as ArticleBlock).title, title);
  return { shown: sel.verdicts[idx].show, sel, p };
}

test("Tabellenartikel mit allen Zonen bleibt sichtbar", () => {
  const p = parseNormText(
    mitKapitel(`Art. 20 Kernzone K
Ausnützung siehe Tabelle.
Zone | AZ | Geschosse
K | 0.8 | 3
W3 | 0.6 | 3
Art. 21 Kernzone K2
Dächer.`),
  );
  const sel = selectSections(p, CTX);
  const idx = articleAt(p, "Art. 20");
  assert.ok((p.blocks[idx] as ArticleBlock).body.some((b) => b.kind === "table"), "Tabelle erkannt");
  assert.equal(sel.verdicts[idx].show, true);
  assert.equal(shown(p, sel, "Art. 21"), false);
});

test("«Wohnzonen» bei W2 gezeigt, bei K2 ausgeblendet", () => {
  assert.equal(verdictFor("Wohnzonen", "Dachgestaltung.").shown, true);
  assert.equal(verdictFor("Wohnzonen", "Dachgestaltung.", "K2").shown, false);
  assert.equal(verdictFor("Wohn- und Gewerbezonen", "Dachgestaltung.").shown, true);
});

test("Überlagerungen und Sammelbegriffe bleiben sichtbar", () => {
  for (const title of [
    "Gefahrenzone",
    "Grundwasserschutzzone",
    "Überlagerte Zonen",
    "Ortsbildschutzzone",
    "Lärmempfindlichkeitsstufen",
    "Bauten in allen Zonen",
    "Sämtliche Bauzonen",
    "Übrige Zonen",
    "Zonen",
  ]) {
    assert.equal(verdictFor(title, "Bestimmung.").shown, true, title);
  }
});

test("«alle Zonen» im Text hält einen fremden Artikel sichtbar", () => {
  assert.equal(verdictFor("Kernzone K", "Abs. 2 gilt in allen Zonen.").shown, true);
});

test("Kürzel ohne Zonenbezug nennt keine Zone", () => {
  for (const title of ["Format A4", "Energiestandard E1", "Abstand A1 und A2", "Parkplätze P1"]) {
    assert.equal(verdictFor(title, "Bestimmung.").shown, true, title);
  }
});

test("Kürzel mit Zonenbezug oder nur Kürzel sind fremd", () => {
  for (const title of ["W3", "W3 / W4", "Zonen W3 und W4", "Zone 3"]) {
    assert.equal(verdictFor(title, "Bestimmung.").shown, false, title);
  }
});

test("Unbekanntes Kürzel der Projektzone: Familienwörter blenden nicht aus", () => {
  const p = parseNormText(`Art. 1 Zweck
Für die ZöN gilt Art. 30.
Art. 2 Kernzone
Erhaltung.
Art. 3 Gewerbezonen
Betriebe.
Art. 4 Kernzone K
Dächer.
Art. 5 Wohnzone W3
Drei Geschosse.`);
  const sel = selectSections(p, { ...CTX, zone: "ZöN" });
  assert.equal(sel.active, true);
  assert.deepEqual(hiddenLabels(p, sel), ["Art. 4", "Art. 5"]);
});

test("Unbekanntes Familienwort ist nie fremd", () => {
  assert.equal(verdictFor("Spezialzone", "Bestimmung.").shown, true);
  assert.equal(verdictFor("Arbeitszone", "Bestimmung.").shown, true);
  assert.equal(verdictFor("Wohnzone für Familien", "Bestimmung.").shown, true);
});

test("Fremde Zone nur im Fliesstext blendet nicht aus", () => {
  assert.equal(verdictFor("Dachgestaltung", "In der Kernzone K sind Steildächer Pflicht.").shown, true);
});

test("Eigene Zone neben fremder im Titel: gezeigt mit Zonen-Chip", () => {
  const r = verdictFor("Wohnzonen W2 und W3", "Bestimmung.");
  assert.deepEqual(r.sel.verdicts[articleAt(r.p, "Art. 50")], { show: true, ownZone: true });
});

test("Fussnoten und Hinweisspalte zählen nicht als Nennung der eigenen Zone, Randtitel schon", () => {
  const withBody = (body: ArticleBlock["body"]): SectionSelection => {
    const kern: ArticleBlock = { ...art("Art. 22", "Kernzone K", "Erhaltung."), body };
    const blocks: NormBlock[] = [art("Art. 1", "Zweck", "Gilt für die W2."), art("Art. 2", "Geltung", "Überall."), kern];
    return selectSections({ blocks, articleCount: 3, pageCount: 0, structured: true }, CTX);
  };
  const para = { kind: "paragraph" as const, number: null, marginal: null, text: "Erhaltung." };
  assert.equal(withBody([para, { kind: "lines", lines: ["1 Siehe auch W2"], variant: "footnote" }]).verdicts[2].show, false);
  assert.equal(withBody([para, { kind: "lines", lines: ["W2 / Art. 5"], variant: "note" }]).verdicts[2].show, false);
  assert.equal(withBody([{ ...para, marginal: "Anbauten W2" }]).verdicts[2].show, true);
  assert.equal(withBody([para, { kind: "list", items: [{ marker: "a)", text: "auch in der W2" }] }]).verdicts[2].show, true);
});

// ── Hilfen und Laufzeit ──────────────────────────────────────────────────────

test("runLabel und runSummary", () => {
  assert.equal(runLabel(["Art. 21"]), "Art. 21");
  assert.equal(runLabel(["Art. 21", "Art. 22", "Art. 23"]), "Art. 21–23");
  assert.equal(runLabel(["Art. 21", "§ 3"]), "Art. 21 bis § 3");
  assert.equal(runSummary({ from: 0, to: 0, labels: ["Art. 22"], zones: ["Kernzone K"] }), "Art. 22 gilt für Kernzone K.");
  assert.equal(runSummary({ from: 0, to: 0, labels: [], zones: [] }), "Abschnitt für andere Zonen.");
});

test("hiddenRuns ohne aktiven Filter ist leer", () => {
  const p = parseNormText(REGLEMENT);
  assert.deepEqual(hiddenRuns(selectSections(p, { ...CTX, zone: null }), p.blocks), []);
});

test("Laufzeit: 1500 Artikel", () => {
  const zones = ["W2", "W3", "K", "G"];
  const parts: string[] = [];
  for (let i = 1; i <= 1500; i++) {
    const z = zones[i % zones.length];
    parts.push(`Art. ${i} ${z === "K" ? "Kernzone K" : z === "G" ? "Gewerbezone G" : `Wohnzone ${z}`}\n1 Bestimmung Nummer ${i} mit etwas Text.`);
  }
  const p = parseNormText(parts.join("\n"));
  const t0 = performance.now();
  const sel = selectSections(p, CTX);
  const ms = performance.now() - t0;
  assert.equal(sel.active, true);
  assert.ok(sel.hiddenArticles > 0);
  invariant(p, sel);
  assert.ok(ms < 500, `${ms} ms`);
});

// Typprüfung: blocks und verdicts bleiben indexgleich, auch mit Seitenmarken.
test("Invariante über alle Beispiele", () => {
  for (const t of [REGLEMENT, mitKapitel("II. Kernzonen\nArt. 30 Zweck\nText.")]) {
    const p = parseNormText(t);
    const sel = selectSections(p, CTX);
    invariant(p, sel);
    const blocks: NormBlock[] = p.blocks;
    assert.equal(blocks.length, sel.verdicts.length);
  }
});

test("Runde 2: Kurzaufzählung, Stammkürzel, Unterzone, Familie Gewerbe/Industrie", () => {
  for (const title of ["Wohnzonen W1, 2", "Wohnzonen W1+2", "Zonen W 1 / 2"]) assert.equal(verdictFor(title, "Bestimmung.").shown, true, title);
  // Aufzählung ohne eigene Nummer ist nie fremd.
  assert.equal(verdictFor("Wohnzonen W4/5", "Bestimmung.").shown, true);
  assert.equal(verdictFor("Wohnzone W", "Bestimmung.").shown, true);
  assert.equal(verdictFor("Industriezone I", "Bestimmung.").shown, false);
  assert.equal(verdictFor("Wohnzone W2b", "Bestimmung.").shown, true);
  assert.equal(verdictFor("Industriezone", "Bestimmung.", "G2").shown, true);
  assert.equal(verdictFor("Industriezone I", "Bestimmung.", "G2").shown, false);
  assert.equal(verdictFor("Industriezone GI", "Bestimmung.", "G2").shown, false);
});
