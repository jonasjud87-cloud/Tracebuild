import { test } from "node:test";
import assert from "node:assert/strict";

import { isSameHost, normSummary, parseNormText, safeHref, type ArticleBlock, type BodyBlock, type NormBlock } from "./norm-structure";

const articles = (blocks: NormBlock[]) => blocks.filter((b): b is ArticleBlock => b.kind === "article");
const labelsOf = (text: string) => articles(parseNormText(text).blocks).map((a) => a.label);
const paragraphs = (body: (NormBlock | BodyBlock)[]) =>
  body.filter((b): b is Extract<BodyBlock, { kind: "paragraph" }> => b.kind === "paragraph");

/** Alle Zeichen in Lesereihenfolge, ohne Leerraum. */
function flatten(blocks: (NormBlock | BodyBlock)[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "article":
        out.push(b.rawLabel, b.title ?? "", flatten(b.body));
        break;
      case "paragraph":
        out.push(b.marginal ?? "", b.number ?? "", b.text);
        break;
      case "list":
        for (const it of b.items) out.push(it.marker, it.text);
        break;
      case "table":
        out.push(b.rows.map((r) => r.join("")).join(""));
        break;
      case "lines":
        out.push(b.lines.join(""));
        break;
      case "heading":
        out.push(b.text);
        break;
      case "toc":
        for (const e of b.entries) out.push(e.label, e.page ?? "");
        break;
      case "page":
        break;
    }
  }
  return out.join("").replace(/\s+/g, "");
}

test("Artikel mit Titel und einem Absatz", () => {
  const p = parseNormText("Art. 12 Abstände\nW2 kleiner Grenzabstand 3,50 m, grosser 7.50 m.");
  const [a] = articles(p.blocks);
  assert.equal(p.articleCount, 1);
  assert.equal(a.label, "Art. 12");
  assert.equal(a.title, "Abstände");
  assert.equal(a.body.length, 1);
  assert.deepEqual(a.body[0], { kind: "paragraph", number: null, marginal: null, text: "W2 kleiner Grenzabstand 3,50 m, grosser 7.50 m." });
  assert.equal(p.structured, true);
});

test("Paragraf § 3", () => {
  const p = parseNormText("§ 3 Allgemein\n1 Die Bauten fügen sich ein.");
  const [a] = articles(p.blocks);
  assert.equal(a.label, "§ 3");
  assert.equal(a.title, "Allgemein");
  assert.equal(paragraphs(a.body)[0].number, "1");
});

test("langer Kopfsatz wird erster Absatz, kein Titel", () => {
  const p = parseNormText("Art. 3 Die Baubehörde kann in begründeten Fällen Ausnahmen bewilligen, sofern keine öffentlichen Interessen entgegenstehen.");
  const [a] = articles(p.blocks);
  assert.equal(a.title, null);
  assert.match(paragraphs(a.body)[0].text, /^Die Baubehörde/);
});

test("Absätze 1 und 2, «4 m.» bleibt in Absatz 1", () => {
  const p = parseNormText("Art. 5 Grenzabstand\n1 Der Grenzabstand beträgt\n4 m.\n2 Die Höhe ist frei.");
  const ps = paragraphs(articles(p.blocks)[0].body);
  assert.equal(ps.length, 2);
  assert.deepEqual([ps[0].number, ps[0].text], ["1", "Der Grenzabstand beträgt 4 m."]);
  assert.deepEqual([ps[1].number, ps[1].text], ["2", "Die Höhe ist frei."]);
});

test("«2 Vollgeschosse» als erste Zeile ist kein Absatz", () => {
  const p = parseNormText("Art. 7 Geschosse\nZulässig sind\n2 Vollgeschosse und ein Attikageschoss.");
  const ps = paragraphs(articles(p.blocks)[0].body);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].number, null);
  assert.equal(ps[0].text, "Zulässig sind 2 Vollgeschosse und ein Attikageschoss.");
});

test("«1Die» ohne Leerzeichen ist Absatz 1", () => {
  const ps = paragraphs(articles(parseNormText("Art. 4 Zweck\n1Die Gemeinde regelt.").blocks)[0].body);
  assert.deepEqual([ps[0].number, ps[0].text], ["1", "Die Gemeinde regelt."]);
});

test("Listen a) b) c) und Gedankenstrich", () => {
  const p = parseNormText("Art. 2 Zonen\n1 Es gibt:\na) Wohnzonen;\nb) Gewerbe-\nzonen;\nc) Zonen für öffentliche Bauten.\n\n– erstens\n– zweitens");
  const body = articles(p.blocks)[0].body;
  const lists = body.filter((b) => b.kind === "list");
  assert.equal(lists.length, 2);
  assert.deepEqual(lists[0].kind === "list" && lists[0].items, [
    { marker: "a)", text: "Wohnzonen;" },
    { marker: "b)", text: "Gewerbezonen;" },
    { marker: "c)", text: "Zonen für öffentliche Bauten." },
  ]);
  assert.deepEqual(lists[1].kind === "list" && lists[1].items.map((i) => i.marker), ["–", "–"]);
});

test("Sprung a) → c) beendet die Liste", () => {
  const body = articles(parseNormText("Art. 2 Zonen\na) Wohnzonen;\nc) Gewerbezonen.").blocks)[0].body;
  assert.equal(body[0].kind, "list");
  assert.equal(body[0].kind === "list" && body[0].items.length, 1);
  assert.equal(body[1].kind, "paragraph");
  assert.equal(body[1].kind === "paragraph" && body[1].text, "c) Gewerbezonen.");
});

test("Fedlex-Listen mit angeklebter Fussnote «a.13», «abis.14»", () => {
  const text = "Art. 3 Planungsgrundsätze\n2 Die Landschaft ist zu schonen. Es sollen insbesondere:\na.13 Wohn- und Arbeitsgebiete\neinander zugeordnet werden;\nabis.14 Massnahmen getroffen werden;\nb. Wohngebiete geschützt werden;\nc. Rad- und Fusswege erhalten werden.";
  const p = parseNormText(text);
  const list = articles(p.blocks)[0].body.find((b) => b.kind === "list");
  assert.ok(list && list.kind === "list");
  assert.deepEqual(list.items.map((i) => i.marker), ["a.13", "abis.14", "b.", "c."]);
  assert.equal(list.items[0].text, "Wohn- und Arbeitsgebiete einander zugeordnet werden;");
  assert.equal(flatten(p.blocks), text.replace(/\s+/g, ""));
});

test("Randtitel mit Tabulator", () => {
  const ps = paragraphs(parseNormText("BauG Art. 25 ff. \t1 Das Gebiet der Gemeinde wird in Zonen eingeteilt.").blocks);
  assert.deepEqual([ps[0].marginal, ps[0].number], ["BauG Art. 25 ff.", "1"]);
  assert.equal(ps[0].text, "Das Gebiet der Gemeinde wird in Zonen eingeteilt.");
});

test("Randtitel als Vorzeile", () => {
  const body = articles(parseNormText("Art. 5 Abstände\n1 Der Abstand beträgt 4 m.\nMehrlängenzuschlag\n2 Bei langen Fassaden gilt ein Zuschlag.").blocks)[0].body;
  const ps = paragraphs(body);
  assert.equal(ps.length, 2);
  assert.deepEqual([ps[1].marginal, ps[1].number], ["Mehrlängenzuschlag", "2"]);
});

test("SG-PBG: «a) Grundsatz» vor Absatz 1 ist Untertitel, «b) …» im Kopf bleibt Titel", () => {
  const p = parseNormText(
    "Art. 8 Verfügbarkeit von Bauland\na) Grundsatz\n1 Die politische Gemeinde sorgt für Verfügbarkeit.\nArt. 9 b) gesetzliches Kaufsrecht der politischen Gemeinde\n1 Wird ein Grundstück nicht überbaut, gilt das Kaufsrecht.",
  );
  const [a8, a9] = articles(p.blocks);
  assert.equal(a8.title, "Verfügbarkeit von Bauland");
  assert.equal(a8.body.length, 1);
  assert.deepEqual(a8.body[0].kind === "paragraph" && [a8.body[0].marginal, a8.body[0].number], ["a) Grundsatz", "1"]);
  assert.equal(a9.label, "Art. 9");
  assert.equal(a9.title, "b) gesetzliches Kaufsrecht der politischen Gemeinde");
  assert.equal(paragraphs(a9.body)[0].number, "1");
});

test("Tabelle mit Tabulatoren 3×3", () => {
  const p = parseNormText("Zone\tAZ\tHöhe\nW2\t0.35\t7.5\nW3\t0.45\t10.5");
  assert.deepEqual(p.blocks, [{ kind: "table", rows: [["Zone", "AZ", "Höhe"], ["W2", "0.35", "7.5"], ["W3", "0.45", "10.5"]] }]);
});

test("OCR-Tabelle mit « | »", () => {
  const p = parseNormText("| Zone | AZ | Höhe |\n| W2 | 0.35 | 7.5 |\nW3 | 0.45 | 10.5");
  assert.equal(p.blocks[0].kind, "table");
  assert.deepEqual(p.blocks[0].kind === "table" && p.blocks[0].rows[2], ["W3", "0.45", "10.5"]);
});

test("Einzelzeile mit Tabulatoren ist keine Tabelle", () => {
  const p = parseNormText("Zone\tAZ\tHöhe wird festgelegt.");
  assert.deepEqual(p.blocks, [{ kind: "paragraph", number: null, marginal: null, text: "Zone AZ Höhe wird festgelegt." }]);
});

test("kurze Zeilen werden «lines»", () => {
  const p = parseNormText("Art. 16 Regelbauweise\nW1\nW2 / 4)WG2\nW2-B\n0.35\n0.45");
  const [a] = articles(p.blocks);
  assert.equal(a.title, "Regelbauweise");
  assert.deepEqual(a.body, [{ kind: "lines", lines: ["W1", "W2 / 4)WG2", "W2-B", "0.35", "0.45"] }]);
});

test("Seitenmarken: pageCount und Seite des Artikels", () => {
  const pages = Array.from({ length: 12 }, (_, k) => `Text der Seite ${k + 1}.\n-- ${k + 1} of 12 --`);
  pages.splice(3, 0, "Art. 7 Zweck\n1 Dieses Reglement gilt.");
  const p = parseNormText(pages.join("\n"));
  assert.equal(p.pageCount, 12);
  const [a] = articles(p.blocks);
  assert.equal(a.page, 4);
  assert.equal(p.blocks.filter((b) => b.kind === "page").length + a.body.filter((b) => b.kind === "page").length, 12);
});

test("Artikel vor der ersten Seitenmarke liegt auf Seite 1", () => {
  const p = parseNormText("Art. 1 Zweck\nText.\n-- 1 of 2 --\nArt. 2 Geltung\nText.\n-- 2 of 2 --");
  assert.deepEqual(articles(p.blocks).map((a) => a.page), [1, 2]);
});

test("laufende Kopfzeilen nach Seitenmarke unterbrechen den Absatz nicht", () => {
  const p = parseNormText(
    "Art. 3 Ziele\n1 Die Behörden achten darauf, die Landschaft zu\n3\n-- 3 of 58 --\nRaumplanungsgesetz\n3 / 30\n700\nschonen und Siedlungen abzustim-\nmen.15\n13 Fassung gemäss Ziff. I des BG vom 15. Juni 2012, in Kraft seit 1. Mai 2014\n(AS 2014 899; BBl 2010 1049).\n\n-- 4 of 58 --",
  );
  const body = articles(p.blocks)[0].body;
  const ps = paragraphs(body);
  assert.equal(ps.length, 1, "Fussnote 13 ist kein Absatz");
  assert.equal(ps[0].text, "Die Behörden achten darauf, die Landschaft zu schonen und Siedlungen abzustimmen.15");
  const headers = body.filter((b) => b.kind === "lines" && b.variant === "header");
  assert.deepEqual(headers.map((h) => h.kind === "lines" && h.lines), [["3"], ["Raumplanungsgesetz", "3 / 30", "700"]]);
  const notes = body.filter((b) => b.kind === "lines" && b.variant === "footnote");
  assert.deepEqual(notes.map((h) => h.kind === "lines" && h.lines), [
    ["13 Fassung gemäss Ziff. I des BG vom 15. Juni 2012, in Kraft seit 1. Mai 2014", "(AS 2014 899; BBl 2010 1049)."],
  ]);
});

test("SR-Nummer allein nach Seitenmarke ist Kopfzeile", () => {
  const body = articles(parseNormText("Art. 1 Zweck\n1 Dieses Gesetz regelt die\n-- 1 of 3 --\n731.1\nNutzung.").blocks)[0].body;
  assert.deepEqual(body.map((b) => b.kind), ["paragraph", "page", "lines"]);
  assert.equal(paragraphs(body)[0].text, "Dieses Gesetz regelt die Nutzung.");
});

test("Silbentrennung: «Grenz-/abstand» verbinden, «Nord-/und» behalten", () => {
  const [p1] = paragraphs(parseNormText("Der Grenz-\nabstand gilt.").blocks);
  assert.equal(p1.text, "Der Grenzabstand gilt.");
  const [p2] = paragraphs(parseNormText("Die Nord-\nund Südfassade.").blocks);
  assert.equal(p2.text, "Die Nord- und Südfassade.");
});

test("Verweise sind keine Köpfe", () => {
  for (const t of ["Art. 2 Abs. 3 gilt sinngemäss.", "Art. 1 BauG, Art. 2 PBG und weitere.", "Art. 4 gilt auch hier."]) {
    const p = parseNormText(t);
    assert.equal(p.articleCount, 0, t);
  }
  const p = parseNormText("1 Die Abstände richten sich nach\nArt. 12 Grenzabstand des Gesetzes.");
  assert.equal(p.articleCount, 0);
});

test("Inhaltsverzeichnis mit Punktführern und drei leere Köpfe", () => {
  const p = parseNormText(
    "E. Bau- und Hygienevorschriften ......13\nArt. 23 Mobilfunkanlagen ......13\n-- 2 of 58 --\nBaureglement Gemeinde Mels \tInhaltsverzeichnis\nVerfahrensvorschriften........16\n\nArt. 1 Zweck\nArt. 2 Geltung\nArt. 3 Begriffe\nArt. 1 Zweck\n1 Dieses Reglement gilt.",
  );
  const tocs = p.blocks.filter((b) => b.kind === "toc");
  assert.equal(tocs.length, 2);
  assert.deepEqual(tocs[0].kind === "toc" && tocs[0].entries, [
    { label: "E. Bau- und Hygienevorschriften", page: "13" },
    { label: "Art. 23 Mobilfunkanlagen", page: "13" },
    { label: "Verfahrensvorschriften", page: "16" },
  ]);
  assert.deepEqual(tocs[1].kind === "toc" && tocs[1].entries.map((e) => e.label), ["Art. 1 Zweck", "Art. 2 Geltung", "Art. 3 Begriffe"]);
  assert.equal(p.articleCount, 1);
  assert.equal(articles(p.blocks)[0].label, "Art. 1");
});

test("Fussnotenkleber «Art. 625» nach Art. 5 ist Art. 6", () => {
  // Aufteilung nur, wenn der Folgekopf sie strikt bestätigt (Art. 7); ohne ihn bleibt «Art. 625».
  const [, a6] = articles(parseNormText("Art. 5 Abstände\nText.\nArt. 625 Von der Strasse\nText.\nArt. 7 Höhe\nText.").blocks);
  assert.deepEqual(labelsOf("Art. 5 Abstände\nText.\nArt. 625 Von der Strasse\nText."), ["Art. 5", "Art. 625"]);
  assert.equal(a6.label, "Art. 6");
  assert.equal(a6.rawLabel, "Art. 625");
});

test("OCR mit gesperrten Buchstaben «A r t . 42»", () => {
  const [a] = articles(parseNormText("A r t . 42 Gestaltung\n1 Bauten sind gut zu gestalten.").blocks);
  assert.equal(a.label, "Art. 42");
  assert.equal(a.title, "Gestaltung");
});

test("Französisch und Italienisch", () => {
  assert.equal(articles(parseNormText("Article 12 Distances\nTexte.").blocks)[0].label, "Art. 12");
  assert.equal(articles(parseNormText("Art. 3 Distanze\nTesto.").blocks)[0].title, "Distanze");
  assert.deepEqual(parseNormText("Chapitre II Zones").blocks, [{ kind: "heading", text: "Chapitre II Zones", page: null }]);
});

test("Kapitelköpfe", () => {
  const p = parseNormText("I. Allgemeine Bestimmungen\nArt. 1 Zweck\nText.\n2. Kapitel: Bauvorschriften\nArt. 2 Höhe\nText.");
  assert.deepEqual(p.blocks.map((b) => b.kind), ["heading", "article", "heading", "article"]);
});

test("Fliesstext ohne Struktur ist nicht gegliedert", () => {
  const p = parseNormText("Dies ist ein einfacher Text\nüber mehrere Zeilen, ohne Artikel und ohne Absatznummern, der einfach weiterläuft.");
  assert.equal(p.structured, false);
});

test("leer, null und Leerraum", () => {
  for (const t of ["", null, undefined, "   \n\t\n  "]) {
    assert.deepEqual(parseNormText(t).blocks, []);
  }
});

test("CRLF, NUL und weiches Trennzeichen", () => {
  const p = parseNormText("Art. 1 Zweck\r\n1 Die Ge\u00ADmeinde\u0000 regelt.\r\n");
  assert.equal(paragraphs(articles(p.blocks)[0].body)[0].text, "Die Gemeinde regelt.");
});

test("«…» am Ende bleibt erhalten", () => {
  const [ps] = paragraphs(parseNormText("Es gilt «sinngemäss»").blocks);
  assert.equal(ps.text, "Es gilt «sinngemäss»");
});

test("kein Textverlust im gemischten Beispiel", () => {
  const text = [
    "Baureglement der Gemeinde",
    "I. Allgemeine Bestimmungen",
    "Art. 1 Zweck",
    "1 Das Reglement ordnet das Bauen.",
    "2 Es gilt für das ganze Gebiet.",
    "Art. 2 Zonen",
    "Zonenplan \t1 Es gibt:",
    "a) Wohnzonen;",
    "b) Gewerbezonen.",
    "Zone\tAZ\tHöhe",
    "W2\t0.35\t7.5",
    "W3\t0.45\t10.5",
    "-- 1 of 2 --",
    "Art. 3 Regelbauweise",
    "W1",
    "W2",
    "W3",
    "Art. 4 Die Baubehörde kann in begründeten Fällen Ausnahmen bewilligen, sofern keine Interessen entgegenstehen.",
    "| A | B | C |",
    "| 1 | 2 | 3 |",
    "Schluss «Ende»",
  ].join("\n");
  const p = parseNormText(text);
  const expected = text.replace(/^-- \d+ of \d+ --$/gm, "").replace(/\|/g, "").replace(/\s+/g, "");
  assert.equal(flatten(p.blocks).replace(/\|/g, ""), expected);
});

test("Laufzeit unter 1000 ms für 250'000 Zeichen", () => {
  const unit = "Art. 12 Abstände\n1 Der Grenzabstand beträgt 4 m.\na) Wohnzone;\nZone\tAZ\tH\nW2\t0.3\t7\n-- 1 of 9 --\nW1\nW2\nW3\n";
  const cases = [
    unit.repeat(Math.ceil(250_000 / unit.length)).slice(0, 250_000),
    "x".repeat(250_000),
    "Art. ".repeat(50_000),
    "Art. \n".repeat(41_000),
    "\t\n".repeat(50_000),
    "a\tb\tc\n".repeat(50_000),
    ". ".repeat(125_000),
    "A b c ".repeat(41_000),
  ];
  for (const c of cases) {
    const start = performance.now();
    parseNormText(c);
    const ms = performance.now() - start;
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms für ${JSON.stringify(c.slice(0, 20))}`);
  }
});

test("HTML bleibt Text", () => {
  const [ps] = paragraphs(parseNormText("<script>alert(1)</script>").blocks);
  assert.equal(ps.text, "<script>alert(1)</script>");
});

test("safeHref", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<b>x</b>"), null);
  assert.equal(safeHref("Baureglement.pdf"), null);
  assert.equal(safeHref(null), null);
  assert.equal(safeHref("https://x.supabase.co/storage/v1/object/public/documents/a.pdf"), "https://x.supabase.co/storage/v1/object/public/documents/a.pdf");
  assert.equal(safeHref("http://www.geo.lu.ch/x.pdf"), "http://www.geo.lu.ch/x.pdf");
});

test("isSameHost", () => {
  assert.equal(isSameHost("https://x.supabase.co/storage/a.pdf", "https://x.supabase.co"), true);
  assert.equal(isSameHost("http://www.geo.lu.ch/x.pdf", "https://x.supabase.co"), false);
  assert.equal(isSameHost("https://x.supabase.co/a.pdf", undefined), false);
});

test("normSummary", () => {
  assert.equal(normSummary({ articleCount: 1, pageCount: 0 }), "1 Artikel");
  assert.equal(normSummary({ articleCount: 42, pageCount: 18 }), "42 Artikel · 18 Seiten");
  assert.equal(normSummary({ articleCount: 0, pageCount: 1 }), "1 Seite");
  assert.equal(normSummary({ articleCount: 0, pageCount: 0 }), "");
});

// ── Nacharbeit nach Prüfung an echten Texten (synthetisch nachgebildet) ─────────────────────────


test("Hinweisspalte «BauG / Art. 4 …» wird Hinweisblock, keine Köpfe", () => {
  const p = parseNormText(
    "Art. 2 Zuständigkeit\n1 Der Rat entscheidet.\nBauG\nArt. 4 Aufgabe\nArt. 8 Baureglement\n\n-- 1 of 2 --\n\nArt. 3 Planungsmittel\n1 Text.",
  );
  assert.deepEqual(articles(p.blocks).map((a) => a.label), ["Art. 2", "Art. 3"]);
  const note = articles(p.blocks)[0].body.find((b) => b.kind === "lines" && b.variant === "note");
  assert.deepEqual(note && note.kind === "lines" && note.lines, ["BauG", "Art. 4 Aufgabe", "Art. 8 Baureglement"]);
});

test("Erlasskürzel als Fortsetzung eines Satzes leitet keine Hinweisspalte ein", () => {
  const ps = paragraphs(
    articles(parseNormText("Art. 2 Zuständigkeit\n1 Zuständig ist der Rat gemäss\nStrG\nsowie weiteren Erlassen.\n2 Der Rat entscheidet.").blocks)[0].body,
  );
  assert.deepEqual(ps.map((x) => x.number), ["1", "2"]);
  assert.equal(ps[0].text, "Zuständig ist der Rat gemäss StrG sowie weiteren Erlassen.");
});

test("nach der Änderungstabelle gibt es keine Köpfe mehr", () => {
  assert.deepEqual(labelsOf("Art. 1 A\n1 Eins.\nArt. 2 B\n1 Zwei.\n* Änderungstabelle - Nach Bestimmung\nArt. 3 Artikeltitel geändert 2018-055\nArt. 4 Artikeltitel geändert 2018-055"), [
    "Art. 1",
    "Art. 2",
  ]);
});

test("Inhaltsverzeichnis ohne Punktführer mit Kapitelköpfen, Ingress am letzten Eintrag", () => {
  const p = parseNormText(
    [
      "Inhaltsverzeichnis",
      "1. Allgemeine Bestimmungen",
      "Art. 1 Geltungsbereich",
      "Art. 2 Zielsetzung",
      "2. Planungsmittel",
      "Art. 3 Richtpläne",
      "Der Gemeinderat erlässt das nachstehende Baureglement:",
      "1. Allgemeine Bestimmungen",
      "Geltungsbereich Art. 1",
      "Das Reglement gilt im ganzen Gebiet.",
      "Zielsetzung Art. 2",
      "Es bezweckt eine geordnete Entwicklung.",
      "Richtpläne Art. 3",
      "Der Rat beschliesst die Richtpläne.",
    ].join("\n"),
  );
  assert.deepEqual(
    p.blocks.map((b) => b.kind),
    ["paragraph", "toc", "paragraph", "heading", "article", "article", "article"],
  );
  const toc = p.blocks[1];
  assert.equal(toc.kind === "toc" && toc.entries.length, 5);
  assert.deepEqual(articles(p.blocks).map((a) => [a.label, a.title]), [
    ["Art. 1", "Geltungsbereich"],
    ["Art. 2", "Zielsetzung"],
    ["Art. 3", "Richtpläne"],
  ]);
});

test("Zusatz mit Leerzeichen «Art. 10 bis» ist Art. 10bis, «Art. 21 bis 32 des …» ist kein Kopf", () => {
  assert.deepEqual(labelsOf("Art. 10 Zone\nText.\nArt. 10 bis\nText.\nArt. 11 Zone\nText."), ["Art. 10", "Art. 10bis", "Art. 11"]);
  assert.deepEqual(labelsOf("Art. 1 A\nText.\nArt. 21 bis 32 des alten Reglements gelten weiter."), ["Art. 1"]);
});

// ── decideNumber: je Regel ein Fall ──────────────────────────────────────────────────────────────
// Streng (≥ 5 Köpfe und Seitenmarken) gilt die Sprunggrenze +15; sonst (Auszug) nicht.
const strict = (heads: string[]) => heads.map((h, i) => `${h}\n1 Text.\n\n-- ${i + 1} of ${heads.length} --\n`).join("\n");

test("decideNumber a) ganze Nummer, nächster Kopf schliesst lose an (Lücke bis +3)", () => {
  assert.deepEqual(labelsOf(strict(["Art. 1 A", "Art. 2 B", "Art. 5 C", "Art. 6 D", "Art. 7 E"])), ["Art. 1", "Art. 2", "Art. 5", "Art. 6", "Art. 7"]);
});

test("decideNumber b) Fussnotenkleber nur bei strikter Bestätigung, nie gegen eine aufsteigende Folge", () => {
  assert.deepEqual(labelsOf(strict(["Art. 3 A", "Art. 4 B", "Art. 512 C", "Art. 6 D", "Art. 7 E"])), ["Art. 3", "Art. 4", "Art. 5", "Art. 6", "Art. 7"]);
  assert.deepEqual(labelsOf("Art. 15\nText.\nArt. 2\n1 Text."), ["Art. 1", "Art. 2"]);
  assert.deepEqual(labelsOf("Art. 12 A\n1 Text.\nArt. 31 B\n1 Text."), ["Art. 12", "Art. 31"]);
});

test("decideNumber c) unmittelbarer Nachfolger ohne Bestätigung; e) strenger Text verwirft unbestätigten Sprung", () => {
  const got = labelsOf(strict(["Art. 1 A", "Art. 2 B", "Art. 3 C", "Art. 4 D", "Art. 5 E", "Art. 40 Verweis ohne Folge"]));
  assert.deepEqual(got, ["Art. 1", "Art. 2", "Art. 3", "Art. 4", "Art. 5"]);
});

test("decideNumber d) Auszug: höhere Nummer ohne Sprunggrenze", () => {
  assert.deepEqual(labelsOf("Art. 7 A\n1 Text.\nArt. 25 B\n1 Text.\nArt. 90 C\n1 Text."), ["Art. 7", "Art. 25", "Art. 90"]);
});

test("decideNumber e) Neubeginn, von zwei Folgeköpfen strikt bestätigt", () => {
  const got = labelsOf(strict(["Art. 46 A", "Art. 47 B", "Art. 48 C", "Art. 21 Altstadt", "Art. 22 Fassaden", "Art. 23 Dächer"]));
  assert.deepEqual(got, ["Art. 46", "Art. 47", "Art. 48", "Art. 21", "Art. 22", "Art. 23"]);
});

test("decideNumber f) Neubeginn bei 1 nach drei leeren Köpfen; g) erster Kopf mit ganzer Nummer", () => {
  assert.deepEqual(labelsOf("Art. 1 Zweck\nArt. 2 Geltung\nArt. 3 Begriffe\nArt. 1 Zweck\n1 Text."), ["Art. 1"]);
  assert.deepEqual(labelsOf("Art. 625 Von der Strasse\nText."), ["Art. 625"]);
});

test("verworfener Kopf wird Text, kein Randtitel", () => {
  const p = parseNormText(strict(["Art. 1 A", "Art. 2 B", "Art. 3 C", "Art. 4 D", "Art. 5 E", "Art. 40 Verweis ohne Folge"]));
  const last = articles(p.blocks)[4];
  const ps = paragraphs(last.body);
  assert.ok(ps.every((x) => x.marginal === null));
  assert.ok(ps.some((x) => x.number === null && x.text.startsWith("Art. 40 Verweis ohne Folge")));
});

test("Fussnotenmodus nur am Seitenende, Änderungstabelle am Anfang stoppt nichts", () => {
  assert.deepEqual(labelsOf("Änderungstabelle siehe Anhang\nArt. 1 Zweck\n1 Text.\nArt. 2 Geltung\n1 Text."), ["Art. 1", "Art. 2"]);
});

test("nummerierter Satz «2. Die Behörde entscheidet» im Artikel ist kein Kapitelkopf", () => {
  const p = parseNormText("Art. 4 Fristen\n1 Die Frist beträgt 30 Tage.\n2. Die Behörde entscheidet umgehend\nArt. 5 X\n1 Y.");
  assert.equal(p.blocks.some((b) => b.kind === "heading"), false);
  assert.deepEqual(articles(p.blocks).map((a) => a.label), ["Art. 4", "Art. 5"]);
});

test("umbrochener Titel «Gebäudeab-» + «stand» und Absatz nach Fussnotenziffer «…23»", () => {
  const [a] = articles(parseNormText("Art. 12 Grenzabstand, Gebäudeab-\nstand\n1 …23\n2 Für die Erstellung gilt Folgendes.").blocks);
  assert.equal(a.title, "Grenzabstand, Gebäudeabstand");
  assert.deepEqual(paragraphs(a.body).map((x) => [x.number, x.text]), [
    ["1", "…23"],
    ["2", "Für die Erstellung gilt Folgendes."],
  ]);
});

test("nummerierter Satz «2. Sie verfolgt …; …» ist kein Kapitelkopf", () => {
  const p = parseNormText("Art. 12 Organisationen\n1 Die Organisation ist gesamtschweizerisch tätig.\n2. Sie verfolgt rein ideelle Zwecke; allfällige");
  assert.equal(p.blocks.some((b) => b.kind === "heading"), false);
});

test("Fedlex-Seitenkopf «Titel / Seitenzahl / SR-Nummer» und Fussnoten am Seitenende", () => {
  const p = parseNormText(
    "Art. 7 Zweck\n1 Der Bund sorgt für den Schutz\n4 \tFassung gemäss Ziff. I des BG vom 24. März 1995\n(AS 1996 214).\n\n-- 1 of 2 --\n\nBundesgesetz\n2\n451\nder Landschaft.\nArt. 8 Aufgaben\n1 Text.",
  );
  const [a7] = articles(p.blocks);
  assert.equal(paragraphs(a7.body)[0].text, "Der Bund sorgt für den Schutz der Landschaft.");
  const kinds = a7.body.map((b) => (b.kind === "lines" ? `lines:${b.variant}` : b.kind));
  assert.deepEqual(kinds, ["paragraph", "lines:footnote", "page", "lines:header"]);
  assert.equal(articles(p.blocks)[1].page, 2);
});
