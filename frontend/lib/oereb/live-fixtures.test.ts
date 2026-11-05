/**
 * Normalisierer und Zonenregeln gegen gekürzte echte Antworten (Live-Stichprobe 4.11.2026,
 * eine Parzelle pro Kanton). Die Zonen-Erwartungen stammen aus der Spezifikation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GenericOerebAdapter, parseExtractResponse } from "./adapters/generic";
import { RuleBasedOerebAdapter } from "./adapters/rule-based";
import { officialIdentity } from "./documents";
import { normalizeExtract } from "./normalize";
import { OTHER_LEGEND_CANTONS, PRESET_LANGUAGES } from "./service-quirks";
import { xmlToObject } from "./xml";
import { parseZoneCode } from "./zone-rules";
import type { OerebExtract } from "./types";

function load(name: string): unknown {
  const url = new URL(`./__fixtures__/live/${name}`, import.meta.url);
  const text = readFileSync(url, "utf8");
  return name.endsWith(".xml") ? xmlToObject(text) : JSON.parse(text);
}

function extractOf(canton: string, file = `${canton}.json`): OerebExtract {
  const normalized = normalizeExtract(load(file), { otherLegend: OTHER_LEGEND_CANTONS.has(canton) });
  return parseExtractResponse(normalized, canton, PRESET_LANGUAGES[canton] ?? "de");
}

function zoneOf(canton: string, file?: string) {
  const { zone, confidence } = new RuleBasedOerebAdapter(canton, "https://example.invalid").extractZone(extractOf(canton, file));
  return { zone, confidence };
}

// ── Zonen-Erwartungstabelle (Spezifikation 4.9) ──────────────────────────────

const ZONE_TABLE: [string, string | undefined, string | null, string][] = [
  ["AG", undefined, "ASA", "exact"],
  ["AI", undefined, "K", "exact"],
  ["BE", undefined, "Untere Altstadt und Wohngebiet Matte", "coarse"],
  ["BL", undefined, "Kernzone", "coarse"],
  ["BS", undefined, "Stadt- und Dorfbild-Schutzzone", "coarse"],
  ["FR", undefined, "ZV", "exact"],
  ["GE", undefined, "Zone 1", "exact"],
  ["GL", undefined, "Kernzone Wiederaufbaugebiet Glarus", "coarse"],
  ["GR", undefined, "Zone für öffentliche Bauten und Anlagen", "coarse"],
  ["JU", undefined, "CCc", "exact"],
  ["LU", undefined, "Zone für öffentliche Zwecke", "coarse"],
  ["NW", undefined, "K14a", "exact"],
  ["OW", undefined, "W3A", "exact"],
  // Parser-Ergebnis festgehalten: «1» allein ist kein Kürzel.
  ["UR", undefined, "Kernzone 1", "coarse"],
  ["SH", "SH.xml", "A", "exact"],
  ["SO", "SO-solothurn.xml", null, "none"],
  ["SO", "SO-olten.xml", "Zone für öffentliche Bauten und Anlagen", "coarse"],
  ["SZ", undefined, "Öffentliche Zone", "coarse"],
  ["TG", undefined, "KA", "exact"],
  ["VD", undefined, "Zone centrale", "coarse"],
  ["VS", undefined, "Vieille ville (1)", "coarse"],
  // Parser-Ergebnis festgehalten: aus «Kernzone C» wird das Kürzel C.
  ["ZG", undefined, "C", "exact"],
  ["ZH", undefined, "K", "exact"],
];

for (const [canton, file, zone, confidence] of ZONE_TABLE) {
  test(`Zone ${canton}${file ? ` (${file})` : ""}: ${zone} / ${confidence}`, () => {
    assert.deepEqual(zoneOf(canton, file), { zone, confidence });
  });
}

test("Zone TI: keine Grundnutzung in der Stichprobe, also nur unsicher", () => {
  const { confidence } = zoneOf("TI");
  assert.ok(confidence === "low" || confidence === "none", confidence);
});

// ── Normalisierer je Muster ──────────────────────────────────────────────────

test("Normalisierer: Item-Hülle und Zahlen-Enums (FR)", () => {
  const ex = extractOf("FR");
  assert.equal(ex.canton, "FR");
  assert.equal(ex.bfsNumber, 2196);
  const np = ex.themes.find((t) => t.subTheme === "ch.FR.Affectationsprimaires");
  assert.equal(np?.legalStatus, "inForce");
  assert.equal(np?.legendText, "Zone de ville 1 (ZV)");
  assert.equal(np?.lawLinks[0].kind, "LegalProvision");
});

test("Normalisierer: Französisch als Sprache, Canton 24 und Dokumenttypen (GE, VD)", () => {
  const ge = extractOf("GE");
  assert.equal(ge.canton, "GE");
  assert.equal(ge.municipality, "Genève");
  const vd = extractOf("VD");
  assert.equal(vd.canton, "VD");
  const kinds = new Set(vd.themes.flatMap((t) => t.lawLinks.map((l) => l.kind)));
  assert.ok(kinds.size > 0);
  for (const kind of Array.from(kinds)) assert.ok(["LegalProvision", "Law", "Hint"].includes(String(kind)), String(kind));
});

test("Normalisierer: LU-Alias für Legende, Dokument und Stelle; Schema ergänzt", () => {
  const ex = extractOf("LU");
  const zone = ex.themes.find((t) => t.typeCode === "5100");
  assert.equal(zone?.legendText, "Zone für öffentliche Zwecke");
  const link = ex.themes.flatMap((t) => t.lawLinks).find((l) => l.url);
  assert.match(String(link?.url), /^https?:\/\//);
  assert.equal(link?.kind, "LegalProvision");
  assert.ok(zone?.authority?.name);
});

test("Normalisierer: {LocalisedText} und echte Legende aus Map.OtherLegend (OW, NW, UR)", () => {
  const ow = extractOf("OW");
  const grund = ow.themes.find((t) => t.legendText === "Dreigeschossige Wohnzone A, W3A");
  assert.equal(grund?.subTheme, "Grundnutzung (Sarnen)");
  const nw = extractOf("NW");
  assert.ok(nw.themes.some((t) => t.legendText === "Kernzone 14a, K14a" && t.subTheme === "Grundnutzung Stans"));
  const ur = extractOf("UR");
  const kern = ur.themes.filter((t) => t.legendText === "Kernzone 1");
  assert.equal(kern.length, 3, "UR führt Kernzone 1 in drei Zeilen");
  assert.equal(ur.themes[0].themeName, "Gemeindliche Nutzungsplanung");
});

test("Normalisierer: ohne otherLegend bleibt der Ebenenname stehen", () => {
  const ex = parseExtractResponse(normalizeExtract(load("OW.json")), "OW");
  assert.ok(ex.themes.some((t) => t.legendText === "Grundnutzung (Sarnen)"));
});

test("Normalisierer: Thema mit kleinem code (ZH) und bare extract (AG) bleiben lesbar", () => {
  assert.ok(extractOf("ZH").themes.some((t) => t.themeCode === "ch.Nutzungsplanung"));
  assert.ok(extractOf("AG").themes.length > 0);
});

test("XML: SH liefert denselben Vertrag wie JSON", () => {
  const ex = extractOf("SH", "SH.xml");
  assert.equal(ex.canton, "SH");
  assert.equal(ex.egrid, "CH445408781787");
  assert.equal(ex.bfsNumber, 2939);
  const zone = ex.themes.find((t) => t.legendText === "Altstadtzone [A]");
  assert.equal(zone?.legalStatus, "inForce");
  assert.equal(zone?.areaPct, 100);
});

test("XML-Leser: Präfixe weg, Wiederholung als Array, Entitäten, leere Elemente", () => {
  const doc = xmlToObject(
    `<?xml version="1.0"?><a:Root xmlns:a="x"><b:Item id="1">A &amp; B</b:Item><b:Item>&#xE9;</b:Item><b:Empty/><c>  t  </c></a:Root>`
  );
  assert.deepEqual(doc, { Root: { Item: ["A & B", "é"], Empty: "", c: "t" } });
});

test("Code-Parser: Reihenfolge der Muster", () => {
  const cases: [string, string | null][] = [
    ["Zone Altstadt A [ASA]", "ASA"],
    ["Kernzone Altstadt (KA)", "KA"],
    ["Vieille ville (1)", null],
    ["Dreigeschossige Wohnzone A, W3A", "W3A"],
    ["Zone centre - CCc", "CCc"],
    ["Kernzone C", "C"],
    ["Kernzone 1", null],
    ["Kernzone", null],
  ];
  for (const [legend, code] of cases) assert.equal(parseZoneCode(legend), code, legend);
});

// ── Abruf mit gemocktem Dienst ───────────────────────────────────────────────

test("Abruf: LANG und GEOMETRY in der URL, XML-Wechsel bei 415, EGRID-Prüfung", async () => {
  const body = readFileSync(new URL("./__fixtures__/live/SH.xml", import.meta.url), "utf8");
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url));
    if (String(url).includes("/extract/json/")) return new Response("", { status: 415 });
    return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
  }) as typeof fetch;
  try {
    const adapter = new GenericOerebAdapter("BE", async () => ({
      baseUrl: "https://example.invalid/oereb", language: "de", format: "json", source: "fixed",
    }));
    const ex = await adapter.getExtract("CH445408781787");
    assert.equal(ex.egrid, "CH445408781787");
    assert.deepEqual(calls.filter((u) => u.includes("example.invalid")), [
      "https://example.invalid/oereb/extract/json/?EGRID=CH445408781787&LANG=de&GEOMETRY=false",
      "https://example.invalid/oereb/extract/xml/?EGRID=CH445408781787&LANG=de&GEOMETRY=false",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

// ── Korrekturen aus dem Review ───────────────────────────────────────────────

test("HTTP 200 mit RealEstate, aber ohne Themen ist ein Fehler, kein leerer Auszug", () => {
  assert.throws(
    () => parseExtractResponse({ RealEstate: { EGRID: "CH000000000001", Canton: "ZH" } }, "ZH"),
    /keine Themen/
  );
  assert.equal(
    parseExtractResponse({ RealEstate: { EGRID: "CH000000000001" }, NotConcernedTheme: [{ Code: "ch.X" }] }, "ZH").themes.length,
    1
  );
});

test("Legendenzusatz wird nicht zum Kürzel, echte Kürzel bleiben", () => {
  for (const legend of ["Wohnzone, Hanglage", "Kernzone - Dorfkern", "Wohnzone (Hanglage)"]) {
    assert.equal(parseZoneCode(legend), null, legend);
  }
  assert.equal(parseZoneCode("Dreigeschossige Wohnzone A, W3A"), "W3A");
  assert.equal(parseZoneCode("Kernzone 14a, K14a"), "K14a");
  assert.equal(parseZoneCode("Centre - CCc"), "CCc");
  assert.equal(parseZoneCode("Kernzone (KA)"), "KA");
});

test("Herkunft: Kanton, BFS und Gemeinde stehen im gespeicherten Rohauszug jedes Dienstes", () => {
  const files = ["AG", "AI", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NW", "OW", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH"];
  for (const canton of files) {
    const ex = extractOf(canton);
    const identity = officialIdentity({ canton: ex.canton, raw: ex.raw });
    assert.ok(identity, canton);
    assert.equal(identity.canton, canton);
    assert.equal(identity.bfs, ex.bfsNumber, canton);
    assert.ok(identity.municipality, canton);
  }
  for (const [canton, file] of [["SH", "SH.xml"], ["SO", "SO-olten.xml"]]) {
    const ex = extractOf(canton, file);
    assert.ok(officialIdentity({ canton: ex.canton, raw: ex.raw }), file);
  }
});
