// Ergänzende Tests aus dem Review. Alle Beispiele sind synthetisch nachgebildet.
// Die früheren `todo`-Fälle sind behoben und laufen als normale Tests.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isSameHost, parseNormText, safeHref, type ArticleBlock, type BodyBlock, type NormBlock } from "./norm-structure";

const articles = (blocks: NormBlock[]) => blocks.filter((b): b is ArticleBlock => b.kind === "article");
const labels = (text: string) => articles(parseNormText(text).blocks).map((a) => a.label);
const paragraphs = (body: (NormBlock | BodyBlock)[]) =>
  body.filter((b): b is Extract<BodyBlock, { kind: "paragraph" }> => b.kind === "paragraph");

// ---------------------------------------------------------------------------------------------
// Regressionen aus den echten Texten (Bund, Kanton SG, Gemeinden), synthetisch nachgebildet.

test(
  "Inhaltsverzeichnis endet an Seitengrenze: folgende Seite wird nicht als Kopfzeile verschluckt",

  () => {
    const text = [
      "Inhaltsverzeichnis",
      "A. Allgemeines ........ 1",
      "Art. 1 Zweck ........ 1",
      "Art. 2 Geltung ........ 1",
      "",
      "-- 1 of 3 --",
      "",
      "Gemeinde Muster\tHinweise",
      "1",
      "Der Rat erlässt folgendes Reglement:",
      "Art. 1 Zweck",
      "1 Dieses Reglement ordnet das Bauen.",
      "Art. 2 Geltung",
      "1 Es gilt im ganzen Gebiet.",
    ].join("\n");
    assert.deepEqual(labels(text), ["Art. 1", "Art. 2"]);
  },
);

test("Fussnotenkleber mit vier Ziffern «Art. 2217» nach Art. 21 ist Art. 22", () => {
  assert.deepEqual(labels("Art. 21 Erstes\n1 Text eins.\nArt. 2217 Zweites\n1 Text zwei.\nArt. 23 Drittes\n1 Text drei."), [
    "Art. 21",
    "Art. 22",
    "Art. 23",
  ]);
});

test("Fussnotenkleber nach Buchstabenzusatz «Art. 15a49», «Art. 16abis 58», «Art. 24quinquies 85»", () => {
  const got = labels(
    "Art. 15 Bauzonen\n1 Text.\nArt. 15a49 Förderung\n1 Text.\nArt. 16 Landwirtschaft\n1 Text.\nArt. 16a54 Konform\n1 Text.\nArt. 16abis 58 Pferde\n1 Text.\nArt. 24quinquies 85 Netze\n1 Text.",
  );
  assert.deepEqual(got, ["Art. 15", "Art. 15a", "Art. 16", "Art. 16a", "Art. 16abis", "Art. 24quinquies"]);
});

test("drei aufgehobene Artikel in Folge bleiben Artikel, kein Inhaltsverzeichnis", () => {
  const p = parseNormText("Art. 4 Zweck\n1 Text.\nArt. 5 Aufgehoben\nArt. 6 Aufgehoben\nArt. 7 Aufgehoben\nArt. 8 Titel\n1 Text.");
  assert.equal(p.blocks.some((b) => b.kind === "toc"), false);
  assert.equal(p.articleCount, 5);
});

test("aufgehobene Artikel mit Fussnotenziffer «Art. 165 27» sind kein Inhaltsverzeichnis", () => {
  const p = parseNormText("Art. 164 Titel\n1 Text.\nArt. 165 27\nArt. 166 28\nArt. 167 29\nArt. 168 Schluss\n1 Text.");
  assert.equal(p.blocks.some((b) => b.kind === "toc"), false);
  assert.deepEqual(articles(p.blocks).map((a) => a.label), ["Art. 164", "Art. 165", "Art. 166", "Art. 167", "Art. 168"]);
});

test("Änderungstabelle am Ende: Rücksprung «Art. 2 Artikeltitel geändert» ist kein neuer Kopf", () => {
  const got = labels("Art. 1 A\n1 Eins.\nArt. 2 B\n1 Zwei.\nArt. 3 C\n1 Drei.\nÄnderungstabelle\nArt. 2 Artikeltitel geändert 2018-055");
  assert.deepEqual(got, ["Art. 1", "Art. 2", "Art. 3"]);
});

test("Randtitel vor der Nummer «Geltungsbereich Art. 1» ist ein Artikelkopf", () => {
  const p = parseNormText("Geltungsbereich Art. 1\nDas Reglement gilt für das ganze Gebiet.\nZweck Art. 2\nEs bezweckt eine geordnete Entwicklung.");
  const a = articles(p.blocks);
  assert.deepEqual(a.map((x) => [x.label, x.title]), [
    ["Art. 1", "Geltungsbereich"],
    ["Art. 2", "Zweck"],
  ]);
});

test("umbrochener Fliesstext «Abschnitt 3 dieses …» ist kein Kapitelkopf und beendet den Artikel nicht", () => {
  const p = parseNormText("Art. 3 Regel\n1 Für Bauten nach dem\nAbschnitt 3 dieses Reglements gilt Folgendes\nweiterhin sinngemäss.\n2 Zweiter Absatz.");
  assert.equal(p.blocks.some((b) => b.kind === "heading"), false);
  const [a] = articles(p.blocks);
  assert.deepEqual(paragraphs(a.body).map((x) => x.number), ["1", "2"]);
});

test("Unterschrift «H. Muster» ist kein Kapitelkopf", () => {
  const p = parseNormText("Art. 9 Vollzug\n1 Der Rat vollzieht.\nDer Präsident\nH. Muster");
  assert.equal(p.blocks.some((b) => b.kind === "heading"), false);
});

test("Zahl am Zeilenanfang in einem Listenpunkt «3 Geschossen» ist kein Absatz 3", () => {
  const p = parseNormText("Art. 4 Höhe\n1 Zulässig sind Bauten.\n2 Es gelten:\na) Bauten mit höchstens\n3 Geschossen;\nb) Anbauten.");
  const [a] = articles(p.blocks);
  assert.deepEqual(paragraphs(a.body).map((x) => x.number), ["1", "2"]);
  const list = a.body.find((b) => b.kind === "list");
  assert.ok(list && list.kind === "list");
  assert.deepEqual(list.items.map((i) => i.marker), ["a)", "b)"]);
});

test("aufgehobener Absatz «1 …» trennt Absatz 2 ab", () => {
  const [a] = articles(parseNormText("Art. 6 Grundlagen\n1 …\n2 Für die Erstellung erarbeiten die Kantone Grundlagen.").blocks);
  assert.deepEqual(paragraphs(a.body).map((x) => x.number), ["1", "2"]);
});

test("Fedlex-Liste «bbis.» → «bter.» läuft weiter", () => {
  const [a] = articles(parseNormText("Art. 1 Ziele\n1 Sie fördern:\na. Erstes;\nb. Zweites;\nbbis. Drittes;\nbter. Viertes;\nc. Fünftes.").blocks);
  const list = a.body.find((b) => b.kind === "list");
  assert.ok(list && list.kind === "list");
  assert.deepEqual(list.items.map((i) => i.marker), ["a.", "b.", "bbis.", "bter.", "c."]);
});

test("Verweis in der Hinweisspalte «Art. 56 / EGZ ZGB» ist kein Kopf", () => {
  assert.deepEqual(labels("Art. 12 Abstand\n1 Der Abstand beträgt vier Meter.\nArt. 56 / EGZ ZGB\nArt. 13 Länge\n1 Text."), ["Art. 12", "Art. 13"]);
});

test("Verweis nach «gestützt auf» am Zeilenende ist kein Kopf", () => {
  assert.deepEqual(labels("Art. 1 Grundlage\n1 Der Rat erlässt, gestützt auf\nArt. 36 Kantonsverfassung und weitere Erlasse, dieses Reglement."), ["Art. 1"]);
});

test("Auszug «Art. 2, Art. 31, Art. 32»: Art. 31 wird nicht zu Art. 3 umnummeriert", () => {
  const got = labels("Art. 2 Zuständigkeit\n1 Der Rat entscheidet.\nArt. 31 Abgrabungen\n1 Abgrabungen sind zulässig.\nArt. 32 Gefahrengebiete\n1 Text.");
  assert.deepEqual(got, ["Art. 2", "Art. 31", "Art. 32"]);
});

test("erster Kopf mit Fussnote «Art. 15» vor Art. 2 ist Art. 1", () => {
  assert.deepEqual(labels("Art. 15\nDieses Gesetz bezweckt den Schutz.\nArt. 2\n1 Text.\nArt. 3\n1 Text."), ["Art. 1", "Art. 2", "Art. 3"]);
});

// ---------------------------------------------------------------------------------------------
// Bereits korrektes Verhalten absichern.

test("SG-Format: Kopf mit Titel, Absätze 1–3, Liste a)–c)", () => {
  const p = parseNormText(
    "Art. 7 Grenzabstand\n1 Der Grenzabstand beträgt mindestens vier Meter.\n2 Er wird rechtwinklig gemessen.\n3 Ausgenommen sind:\na) Kleinbauten;\nb) Anbauten;\nc) unterirdische Bauten.",
  );
  const [a] = articles(p.blocks);
  assert.equal(a.title, "Grenzabstand");
  assert.deepEqual(paragraphs(a.body).map((x) => x.number), ["1", "2", "3"]);
  const list = a.body.find((b) => b.kind === "list");
  assert.ok(list && list.kind === "list");
  assert.equal(list.items.length, 3);
});

test("Fedlex-Format: Kopf mit Tabulator vor dem Titel, Kapitelkopf «2. Kapitel:»", () => {
  const p = parseNormText("1. Kapitel: Grundsätze\nArt. 3 \tSorgfalt\n1 Jedermann ist verpflichtet.\n2. Kapitel: Vollzug\nArt. 4 \tAufsicht\n1 Der Bund beaufsichtigt.");
  assert.deepEqual(p.blocks.map((b) => b.kind), ["heading", "article", "heading", "article"]);
  assert.deepEqual(articles(p.blocks).map((a) => a.title), ["Sorgfalt", "Aufsicht"]);
});

test(
  "Absatz über Seitengrenze mit Leerzeilen (pdf-parse-Format) bleibt ein Absatz",

  () => {
  const p = parseNormText("Art. 1 A\n1 Der Satz beginnt hier und\n\n-- 1 of 2 --\n\nendet auf der nächsten Seite.\nArt. 2 B\n1 Text.");
  const [a1, a2] = articles(p.blocks);
  assert.equal(paragraphs(a1.body)[0].text, "Der Satz beginnt hier und endet auf der nächsten Seite.");
  assert.equal(a2.page, 2);
  assert.equal(p.pageCount, 2);
  },
);

test("Seitenmarke mit Leerzeilen: Seite des Folgeartikels und pageCount", () => {
  const p = parseNormText("Art. 1 A\n1 Text eins.\n\n-- 1 of 2 --\n\nArt. 2 B\n1 Text zwei.");
  const [, a2] = articles(p.blocks);
  assert.equal(a2.page, 2);
  assert.equal(p.pageCount, 2);
});

test("Querverweis «Art. 5 KEG» nach Satzende ist ein Kopf (bekannte Grenze der Verweisliste)", () => {
  // Dokumentiert die Grenze: unbekannte Abkürzungen gelten als Titel. Ändert sich das, Test anpassen.
  assert.deepEqual(labels("Art. 1 Zweck\n1 Es gilt.\nArt. 5 KEG bleibt vorbehalten."), ["Art. 1", "Art. 5"]);
});

test("ungültige Eingaben: Zahl, Objekt, sehr lange Ziffernfolge", () => {
  assert.deepEqual(parseNormText(42 as unknown as string).blocks, []);
  assert.deepEqual(parseNormText({} as unknown as string).blocks, []);
  const p = parseNormText(`Art. ${"9".repeat(5000)} Titel`);
  assert.equal(p.articleCount, 0);
});

test("Laufzeit: Zeile mit 180 Zeichen Punktführer ohne Seitenzahl, 250'000 Zeichen", () => {
  const line = `x${". ".repeat(90)}\n`;
  const text = line.repeat(Math.ceil(250_000 / line.length)).slice(0, 250_000);
  const start = performance.now();
  parseNormText(text);
  assert.ok(performance.now() - start < 1000);
});

test("Laufzeit: 20'000 Blöcke (Absatzfolgen und Seitenmarken)", () => {
  const unit = "1 Der Text.\n2 Der Text.\n-- 1 of 2 --\n";
  const text = unit.repeat(Math.ceil(250_000 / unit.length)).slice(0, 250_000);
  const start = performance.now();
  const p = parseNormText(text);
  assert.ok(p.blocks.length > 10_000);
  assert.ok(performance.now() - start < 1000);
});

// ---------------------------------------------------------------------------------------------
// Sicherheit: Links und eingebettetes PDF.

test("safeHref: Negativfälle", () => {
  for (const u of [
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\nscript:alert(1)",
    "\tjavascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:application/pdf;base64,AAAA",
    "file:///C:/Windows/win.ini",
    "blob:https://x.supabase.co/123",
    "//evil.example/x.pdf",
    "/storage/v1/object/public/documents/a.pdf",
    "../a.pdf",
    "#anker",
    "ftp://example.org/a.pdf",
    "https://",
    "",
  ]) {
    assert.equal(safeHref(u), null, JSON.stringify(u));
  }
  assert.equal(safeHref(42 as unknown as string), null);
});

test("safeHref: gültige Adresse wird getrimmt zurückgegeben", () => {
  assert.equal(safeHref("  https://x.supabase.co/a.pdf  "), "https://x.supabase.co/a.pdf");
  assert.equal(safeHref("HTTPS://x.supabase.co/a.pdf"), "HTTPS://x.supabase.co/a.pdf");
});

test("isSameHost: fremde Hosts, ähnliche Namen und Ports werden abgelehnt", () => {
  const base = "https://proj.supabase.co";
  assert.equal(isSameHost("https://proj.supabase.co.evil.example/a.pdf", base), false);
  assert.equal(isSameHost("https://evil-proj.supabase.co/a.pdf", base), false);
  assert.equal(isSameHost("https://other.supabase.co/a.pdf", base), false);
  assert.equal(isSameHost("https://proj.supabase.co:8443/a.pdf", base), false);
  assert.equal(isSameHost("javascript:alert(1)//proj.supabase.co", base), false);
  assert.equal(isSameHost("/storage/v1/object/public/documents/a.pdf", base), false);
  assert.equal(isSameHost("https://proj.supabase.co/a.pdf", ""), false);
  assert.equal(isSameHost("https://proj.supabase.co/a.pdf", "proj.supabase.co"), false);
  assert.equal(isSameHost("https://PROJ.supabase.co/a.pdf", base), true);
});

// ---------------------------------------------------------------------------------------------
// Zweite Prüfrunde: Auszüge, Hinweis- und Fussnotenmodus ohne Seitenmarken.

test("Satzende «4 m.» vor dem nächsten Kopf ist kein Verweis (i.V.m.)", () => {
  assert.deepEqual(labels("Art. 40 Abstände\n1 Der Grenzabstand beträgt 4 m.\nArt. 41 Höhe\n1 Die Höhe beträgt 10 m."), ["Art. 40", "Art. 41"]);
});

test("Auszug mit Lücken «Art. 12, 31, 75»: Nummern bleiben, nichts wird Randtitel", () => {
  const p = parseNormText("Art. 12 Abstände\n1 Text.\nArt. 31 Höhe\n1 Text.\nArt. 75 Parkplätze\n1 Text.");
  assert.deepEqual(articles(p.blocks).map((a) => a.label), ["Art. 12", "Art. 31", "Art. 75"]);
});

test("Auszug mit zwei Köpfen «Art. 12, Art. 31»", () => {
  assert.deepEqual(labels("Art. 12 Abstände\n1 Text.\nArt. 31 Höhe\n1 Text."), ["Art. 12", "Art. 31"]);
});

test("Auszug «Art. 7, 25, 90» mit Leerzeilen", () => {
  assert.deepEqual(labels("Art. 7 Zonen\n1 Text.\n\nArt. 25 Abstellplätze\n1 Text.\n\nArt. 90 Gewässer\n1 Text."), ["Art. 7", "Art. 25", "Art. 90"]);
});

test("Kürzel am Zeilenanfang im Fliesstext «RPG Art. 24 und …» startet keine Hinweisspalte", () => {
  const p = parseNormText(
    "Art. 1 Grundlage\n1 Die Bewilligung richtet sich nach dem\nRPG Art. 24 und weiteren Erlassen.\nArt. 2 Zuständigkeit\n1 Der Rat entscheidet.\nArt. 3 Gebühren\n1 Es werden Gebühren erhoben.",
  );
  assert.deepEqual(articles(p.blocks).map((a) => a.label), ["Art. 1", "Art. 2", "Art. 3"]);
});

test("Hinweisspalte ohne Seitenmarke verschluckt keine echten Köpfe", () => {
  const p = parseNormText("Art. 1 Grundlage\n1 Es gelten die Vorschriften des Bundes.\nBauG\nArt. 2 Gebühren\n1 Es werden Gebühren erhoben.\nArt. 3 Inkrafttreten\n1 Sofort.");
  assert.deepEqual(articles(p.blocks).map((a) => a.label), ["Art. 1", "Art. 2", "Art. 3"]);
});

test("Absatz «2 Aufgehoben durch …» ohne Seitenmarke: Absatz 3 bleibt Absatz", () => {
  const [a] = articles(
    parseNormText("Art. 1 Zweck\n1 Dieses Gesetz regelt das Bauen.\n2 Aufgehoben durch Nachtrag vom 1. Mai 2020.\n3 Die Regierung erlässt Vorschriften.").blocks,
  );
  assert.ok(paragraphs(a.body).some((x) => x.number === "3"));
});

test("Text ohne Artikel bleibt ungegliedert (Rückfall auf Rohtext)", () => {
  for (const t of ["Die Gemeinde regelt das Bauen.\nDie Bauten fügen sich ein.", "Zone\tAZ\tHöhe\nW2\t0.35\t7.5\nW3\t0.45\t10.5", "W2\nW3\nK\nGI"]) {
    assert.equal(parseNormText(t).structured, false, t);
  }
});

test("Auszug mit Start bei Art. 40 und Anhang mit Neubeginn", () => {
  assert.deepEqual(labels("Art. 40 Abstände\n1 Der Abstand gilt.\nArt. 41 Höhe\n1 Die Höhe gilt."), ["Art. 40", "Art. 41"]);
  assert.deepEqual(labels("Art. 47 A\n1 Text.\nArt. 48 B\n1 Text.\nAnhang\nArt. 21 Altstadt\n1 Text.\nArt. 22 Fassaden\n1 Text."), [
    "Art. 47",
    "Art. 48",
    "Art. 21",
    "Art. 22",
  ]);
});

// ---------------------------------------------------------------------------------------------
// Abschlussprüfung: Auszüge und Randfälle. Grundsatz: nie eine falsche Artikelnummer.

test("Auszug § mit Lücken (§ 3, § 17, § 40)", () => {
  assert.deepEqual(labels("§ 3 Begriffe\n1 Text.\n§ 17 Abstände\n1 Text.\n§ 40 Gebühren\n1 Text."), ["§ 3", "§ 17", "§ 40"]);
});

test("Auszug mit Zusätzen «12a», «12bis», «12ter» und angeklebter Fussnote «5a12»", () => {
  assert.deepEqual(labels("Art. 12 Abstände\n1 Text.\nArt. 12a Ausnahmen\n1 Text.\nArt. 12bis Sonderfall\n1 Text.\nArt. 13 Höhe\n1 Text."), [
    "Art. 12",
    "Art. 12a",
    "Art. 12bis",
    "Art. 13",
  ]);
  assert.deepEqual(labels("Art. 12a Ausnahmen\n1 Text."), ["Art. 12a"]);
  assert.deepEqual(labels("Art. 12bis Sonderfall\n1 Text.\nArt. 12ter Weitere\n1 Text."), ["Art. 12bis", "Art. 12ter"]);
  assert.deepEqual(labels("Art. 5 A\n1 Text.\nArt. 5a12 Neu\n1 Text."), ["Art. 5", "Art. 5a"]);
});

test("Auszug mit einem Artikel und nummerierten Absätzen", () => {
  const [a] = articles(
    parseNormText("Art. 25 Abstellplätze\n1 Pro Wohnung ist ein Abstellplatz zu erstellen.\n2 Die Baubehörde kann Ausnahmen bewilligen.\n3 Es gelten die Normen.").blocks,
  );
  assert.equal(a.label, "Art. 25");
  assert.deepEqual(paragraphs(a.body).map((x) => x.number), ["1", "2", "3"]);
});

test("Kapitelköpfe im Auszug bleiben Köpfe, Artikelnummern bleiben", () => {
  const p = parseNormText("II. Bauvorschriften\nArt. 12 Abstände\n1 Text.\nIII. Verfahren\nArt. 40 Gesuch\n1 Text.");
  assert.deepEqual(p.blocks.map((b) => b.kind), ["heading", "article", "heading", "article"]);
  assert.deepEqual(articles(p.blocks).map((a) => a.label), ["Art. 12", "Art. 40"]);
});

test("Satzende mit «m.», «Abs.», «Ziff.» vor dem nächsten Kopf", () => {
  for (const end of ["Der Abstand beträgt 4 m.", "Es gilt Art. 5 Abs.", "Vorbehalten bleibt Ziff."]) {
    assert.deepEqual(labels(`Art. 12 Abstände\n1 ${end}\nArt. 13 Höhe\n1 Text.`), ["Art. 12", "Art. 13"], end);
  }
});

test("Verweis nach «nach» am Zeilenende, auch mit grossgeschriebenem Folgewort", () => {
  assert.deepEqual(labels("Art. 12 Abstände\n1 Die Abstände richten sich nach\nArt. 7 Kantonsverfassung.\nArt. 13 Höhe\n1 Text."), ["Art. 12", "Art. 13"]);
});

test("Französisch und Italienisch: «al.» und «cpv.» sind Verweise", () => {
  assert.deepEqual(labels("Art. 7 Zones\n1 Texte.\nArt. 8 al. 1 est applicable.\nArt. 8 Constructions\n1 Texte."), ["Art. 7", "Art. 8"]);
  assert.deepEqual(labels("Art. 3 Distanze\n1 La distanza è di 4 m.\nArt. 4 cpv. 2 resta riservato.\nArt. 4 Altezza\n1 Testo."), ["Art. 3", "Art. 4"]);
  assert.deepEqual(labels("Article 12 Distances\n1 La distance est de 4 m.\nArticle 13 Hauteur\n1 Texte."), ["Art. 12", "Art. 13"]);
});

test("sehr kurze Spezialnormen bleiben Rohtext (structured=false)", () => {
  for (const t of [
    "Die Gebäudehöhe beträgt höchstens 10 m.",
    "Gemäss Art. 12 BauR beträgt der Grenzabstand 4 m. Die Höhe ist auf 10 m begrenzt.",
    "Art. 12 BauR: Grenzabstand 4 m.",
    "Art. 12 Abs. 2 BauR: Der Grenzabstand beträgt 4 m.",
    "Art. 2020 wurde der Zonenplan revidiert.",
  ]) {
    assert.equal(parseNormText(t).structured, false, t);
  }
});

test("ungeordneter Auszug: keine erfundene Nummer, kein Textverlust", () => {
  const text = "Art. 31 Höhe\n1 Text eins.\nArt. 12 Abstände\n1 Text zwei.\nArt. 75 Parkplätze\n1 Text drei.";
  const p = parseNormText(text);
  for (const a of articles(p.blocks)) assert.equal(a.label.replace(/\s+/g, ""), a.rawLabel.replace(/\s+/g, ""));
  const all = JSON.stringify(p.blocks);
  for (const s of ["Text eins.", "Text zwei.", "Text drei.", "Abstände"]) assert.ok(all.includes(s), s);
});

test("Fedlex-Fussnotenzeile ohne Seitenmarken: Folgekopf bleibt erkannt", () => {
  const p = parseNormText(
    "Art. 3 Sorgfalt\n1 Jedermann ist verpflichtet.12\n12 Fassung gemäss Ziff. I des BG vom 1. Jan. 2000 (AS 2000 1; BBl 1999 1).\nArt. 4 Begriffe\n1 In diesem Gesetz bedeuten:",
  );
  assert.deepEqual(articles(p.blocks).map((a) => a.label), ["Art. 3", "Art. 4"]);
});
