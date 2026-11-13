import assert from "node:assert/strict";
import test from "node:test";
import { cleanPlainText, describeChange, diffTexts, fingerprint, formatStandDate, hasChanges, looksStructured, similarity, wordsOf, xmlToText } from "./text";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?><akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"><act><meta><identification><FRBRWork><FRBRname value="USG"/></FRBRWork></identification></meta><body><article eId="art_7"><num><b>Art. 7</b></num><heading>Definitionen</heading><paragraph eId="p1"><num>1</num><content><p> Einwirkungen sind Luftverunreinigungen, Lärm &amp; Erschütterungen.<authorialNote><p>Fussnote AS 1995 1234</p></authorialNote></p></content></paragraph></article></body></act></akomaNtoso>`;

test("xmlToText: Metadaten und Fussnoten fallen weg, Entities werden aufgelöst", () => {
  const text = xmlToText(SAMPLE);
  assert.ok(text.includes("Art. 7"));
  assert.ok(text.includes("Definitionen"));
  assert.ok(text.includes("Einwirkungen sind Luftverunreinigungen, Lärm & Erschütterungen."));
  assert.ok(!text.includes("FRBR"));
  assert.ok(!text.includes("Fussnote"));
  assert.ok(!text.includes("<"));
});

test("xmlToText: Artikel stehen auf eigenen Zeilen", () => {
  const lines = xmlToText(SAMPLE).split("\n");
  assert.ok(lines.includes("Art. 7"));
  assert.ok(lines.includes("Definitionen"));
});

test("cleanPlainText: Leerraum wird vereinheitlicht, leere Zeilen entfallen", () => {
  assert.equal(cleanPlainText("a   b\r\n\r\n  c \n"), "a b\nc");
});

test("wordsOf: Umlaute bleiben, Satzzeichen trennen", () => {
  assert.deepEqual(wordsOf("Lärm, Erschütterungen; Art. 7!"), ["lärm", "erschütterungen", "art", "7"]);
});

test("similarity: identisch ist 1, grundverschieden ist niedrig", () => {
  const a = "Dieses Gesetz soll Menschen Tiere und Pflanzen vor schädlichen Einwirkungen schützen und die Fruchtbarkeit des Bodens erhalten.";
  assert.equal(similarity(a, a), 1);
  assert.ok(similarity(a, "Ein völlig anderer Text über Bauabstände und Gebäudehöhen in der Wohnzone ohne Überschneidung.") < 0.2);
});

test("diffTexts: erkennt neue und entfernte Sätze, ignoriert die Stand-Zeile", () => {
  const before = ["vom 7. Oktober 1983 (Stand am 1. April 2026)", "Art. 1", "Dieses Gesetz soll Menschen vor schädlichen Einwirkungen schützen."].join("\n");
  const same = ["vom 7. Oktober 1983 (Stand am 1. August 2026)", "Art. 1", "Dieses Gesetz soll Menschen vor schädlichen Einwirkungen schützen."].join("\n");
  assert.equal(hasChanges(diffTexts(before, same)), false);

  const changed = [same, "Selbst kleine Mengen von Abfällen dürfen nicht ausserhalb der Sammlungen weggeworfen werden."].join("\n");
  const diff = diffTexts(before, changed);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 0);
  assert.ok(diff.samplesAdded[0].startsWith("Selbst kleine Mengen"));
  assert.equal(hasChanges(diff), true);
});

test("diffTexts: kürzt lange Beispiele und begrenzt ihre Zahl", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `Neue Bestimmung Nummer ${i} regelt etwas völlig anderes als zuvor ${"x".repeat(300)}`).join("\n");
  const diff = diffTexts("Alter Text mit genug Wörtern für eine Einheit hier.", lines);
  assert.equal(diff.added, 20);
  assert.equal(diff.samplesAdded.length, 10);
  assert.ok(diff.samplesAdded.every((s) => s.length <= 240));
});

const TABLE = (a: string, b: string) =>
  `<akomaNtoso><body><article><num>Art. 1</num><content><p>Immissionsgrenzwerte gelten für alle Empfindlichkeitsstufen im Anhang.</p></content></article><table><tr><td>ES II</td><td>${a}</td><td>${b}</td></tr></table></body></akomaNtoso>`;

test("xmlToText: Tabellenzellen werden getrennt statt verklebt", () => {
  const text = xmlToText(TABLE("60", "55"));
  assert.ok(text.includes("ES II\n60\n55"));
  assert.ok(!text.includes("6055"));
});

test("Änderung nur in einer Tabellenzelle wird erkannt, auch ohne Satzänderung", () => {
  const before = xmlToText(TABLE("60", "55"));
  const after = xmlToText(TABLE("57", "55"));
  const result = describeChange(before, after);
  assert.equal(result.changed, true);
  assert.equal(hasChanges(result.diff), true);
  assert.ok(result.diff.samplesAdded.includes("57"));
  assert.ok(result.diff.samplesRemoved.includes("60"));
});

test("fingerprint: gleich bei geänderter Stand-Zeile oder Leerraum, verschieden bei geänderter Zahl", () => {
  const a = ["vom 7. Oktober 1983 (Stand am 1. April 2026)", "Art. 1", "Grenzwert 60 dB am Tag."].join("\n");
  const b = ["vom 7. Oktober 1983 (Stand am 1. August 2026)", "Art. 1", "Grenzwert   60 dB am Tag."].join("\n");
  const c = ["vom 7. Oktober 1983 (Stand am 1. August 2026)", "Art. 1", "Grenzwert 57 dB am Tag."].join("\n");
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(c));
  assert.equal(describeChange(a, b).changed, false);
});

test("describeChange: nur Reihenfolge geändert führt zu einem Hinweis statt leerem Diff", () => {
  const a = ["Erster Absatz mit genug Wörtern hier.", "Zweiter Absatz mit anderen Wörtern dort."].join("\n");
  const b = ["Zweiter Absatz mit anderen Wörtern dort.", "Erster Absatz mit genug Wörtern hier."].join("\n");
  const result = describeChange(a, b);
  assert.equal(result.changed, true);
  assert.equal(hasChanges(result.diff), false);
  assert.ok(result.diff.note);
});

const FEDLEX_LIKE =
  '<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"><act><meta><identification/></meta><preface><p><docNumber>814.01</docNumber></p><p><docTitle>Bundesgesetz <br/>über den Umweltschutz</docTitle></p><p xmlns:mig="urn:x">(Umweltschutzgesetz, USG)</p><p>vom 7. Oktober 1983 (Stand am 1. August 2026)</p></preface><preamble><p>Die Bundesversammlung der Schweizerischen Eidgenossenschaft,</p><p>gestützt auf Artikel 74</p></preamble><body><chapter><heading>Grundsätze</heading><article><num><b>Art. 2</b></num><heading>Verursacherprinzip</heading><paragraph><content><p>Wer Massnahmen nach diesem Gesetz verursacht, trägt die Kosten dafür.</p></content></paragraph></article></chapter></body></act></akomaNtoso>';

test("xmlToText: Kopf, Überschriften und Absätze stehen auf eigenen Zeilen", () => {
  const lines = xmlToText(FEDLEX_LIKE).split("\n");
  assert.deepEqual(lines, [
    "814.01",
    "Bundesgesetz über den Umweltschutz",
    "(Umweltschutzgesetz, USG)",
    "vom 7. Oktober 1983 (Stand am 1. August 2026)",
    "Die Bundesversammlung der Schweizerischen Eidgenossenschaft,",
    "gestützt auf Artikel 74",
    "Grundsätze",
    "Art. 2",
    "Verursacherprinzip",
    "Wer Massnahmen nach diesem Gesetz verursacht, trägt die Kosten dafür.",
  ]);
});

test("xmlToText: Tags mit Namensraum-Präfix und Grossschreibung brechen ebenfalls", () => {
  const lines = xmlToText("<akn:act><akn:P>Erster Absatz.</akn:P><akn:Paragraph>Zweiter Absatz.</akn:Paragraph></akn:act>").split("\n");
  assert.deepEqual(lines, ["Erster Absatz.", "Zweiter Absatz."]);
});

test("looksStructured: erkennt Text ohne Zeilenumbrüche", () => {
  assert.equal(looksStructured("kurz"), true);
  assert.equal(looksStructured("wort ".repeat(3000)), false);
  assert.equal(looksStructured(Array.from({ length: 300 }, () => "Eine ganz normale Zeile Text im Gesetz.").join("\n")), true);
});

test("Seitenmarker der PDF-Extraktion zählen weder im Vergleich noch im gespeicherten Text", () => {
  const withMarkers = ["-- 1 of 9 --", "Art. 1", "Dieses Gesetz regelt die Planung und das Bauen im Kanton.", "-- 2 of 9 --"].join("\n");
  const sixteen = ["-- 1 of 16 --", "Art. 1", "Dieses Gesetz regelt die Planung und das Bauen im Kanton."].join("\n");
  assert.equal(fingerprint(withMarkers), fingerprint(sixteen));
  assert.equal(describeChange(withMarkers, sixteen).changed, false);
  assert.equal(cleanPlainText(withMarkers), "Art. 1\nDieses Gesetz regelt die Planung und das Bauen im Kanton.");
});

test("xmlToText: ungültige Entities brechen nicht ab", () => {
  const text = xmlToText("<a><p>Wert &#99999999; und &#x110000; sowie &amp;lt; bleibt</p></a>");
  assert.ok(text.includes("Wert"));
  assert.ok(text.includes("&lt;"));
});

test("formatStandDate: ISO-Datum wird deutsch ausgeschrieben", () => {
  assert.equal(formatStandDate("2026-08-01"), "1. August 2026");
  assert.equal(formatStandDate("2026-03-31"), "31. März 2026");
  assert.equal(formatStandDate("kaputt"), "kaputt");
});
