/**
 * Parser-/Zonen-Tests gegen das Fixture __fixtures__/extract-sample.json.
 *
 * Läuft ohne Test-Framework mit Node ≥ 22 (natives Type-Stripping):
 *   node --test lib/oereb/parse.test.ts
 * Weil die Imports hier bewusst ohne .ts-Endung geschrieben sind (tsc/Next-Konvention),
 * braucht Node einen kleinen Resolve-Hook — siehe Report / Skript im Scratchpad:
 *   node --import <hook.mjs> --test lib/oereb/parse.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OerebParseError,
  OerebUnreachableError,
  localizedText,
  mapLawStatus,
  parseEgridResponse,
  parseExtractResponse,
  pickZoneRestriction,
} from "./adapters/generic";
import { ArOerebAdapter, arExactZoneCode, arZoneClass } from "./adapters/ar";
import { SgOerebAdapter, sgExactZoneCode, sgZoneClass } from "./adapters/sg";
import type { OerebExtract, OerebTheme } from "./types";

const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/extract-sample.json", import.meta.url), "utf8")
) as unknown;

const arFixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/extract-ar-sample.json", import.meta.url), "utf8")
) as unknown;

const sg = new SgOerebAdapter("https://example.invalid/oereb");
const ar = new ArOerebAdapter("https://example.invalid/oereb");

function themeOf(extract: OerebExtract, code: string, concern: OerebTheme["concern"] = "affects"): OerebTheme[] {
  return extract.themes.filter((t) => t.themeCode === code && t.concern === concern);
}

// ── Klassifikation ───────────────────────────────────────────────────────────

test("Fixture: Grundstück und Themen werden korrekt klassifiziert", () => {
  const ex = parseExtractResponse(fixture, "SG");

  assert.equal(ex.canton, "SG");
  assert.equal(ex.egrid, "CH123456789012");
  assert.equal(ex.identDn, "SG0200329300");
  assert.equal(ex.parcelNumber, "1234");
  assert.equal(ex.municipality, "Mels");

  const affects = ex.themes.filter((t) => t.concern === "affects");
  const notAffects = ex.themes.filter((t) => t.concern === "not_affects");
  const noData = ex.themes.filter((t) => t.concern === "no_data");

  // 4 RestrictionOnLandownership-Zeilen → 4 'affects' (2× Nutzungsplanung, Lärm, Gewässerraum)
  assert.equal(affects.length, 4);
  assert.deepEqual(
    Array.from(new Set(affects.map((t) => t.themeCode))).sort(),
    ["ch.Gewaesserraum", "ch.Laermempfindlichkeitsstufen", "ch.Nutzungsplanung"]
  );
  // 19 NotConcernedTheme (inkl. 2 Gewässerraum-SubCodes, die getrennt bleiben)
  assert.equal(notAffects.length, 19);
  assert.equal(themeOf(ex, "ch.Gewaesserraum", "not_affects").length, 2);
  // 2 ThemeWithoutData
  assert.equal(noData.length, 2);
  assert.deepEqual(noData.map((t) => t.themeCode), ["ch.SG.BaulinienStrassengesetz", "ch.SG.Gemeindestrassenplan"]);

  assert.equal(ex.themes.length, 25);
});

test("Fixture: Details einer Restriction (Nutzungsplanung W2)", () => {
  const ex = parseExtractResponse(fixture, "SG");
  const w2 = themeOf(ex, "ch.Nutzungsplanung").find((t) => t.typeCode === "1104101");
  assert.ok(w2, "Wohnzone-Eintrag fehlt");
  assert.equal(w2.themeName, "Nutzungsplanung Zonenplan");
  assert.equal(w2.subTheme, null);
  assert.equal(w2.legalStatus, "inForce");
  assert.equal(w2.areaPct, 92);
  assert.equal(w2.areaM2, 747);
  assert.equal(w2.legendText, "BauG Wohnzone W2");
  assert.deepEqual(w2.lawLinks, [
    { title: "Baureglement", url: "https://oereblex.sg.ch/api/attachments/17273" },
    { title: "Planungs- und Baugesetz", url: "https://www.lexfind.ch/tolv/258420/de" },
  ]);
  assert.deepEqual(w2.authority, { name: "Gemeinde Mels", url: "http://www.mels.ch" });
});

test("Fixture: SubCode des Themas landet in subTheme, Lärm ES II als Code", () => {
  const ex = parseExtractResponse(fixture, "SG");
  const gw = themeOf(ex, "ch.Gewaesserraum")[0];
  assert.equal(gw.subTheme, "Wasser_Zusatz");
  assert.equal(gw.lawLinks.length, 3);

  const laerm = themeOf(ex, "ch.Laermempfindlichkeitsstufen")[0];
  assert.equal(laerm.typeCode, "II");
  assert.equal(laerm.legendText, "Empfindlichkeitsstufe II");
  assert.equal(laerm.areaPct, 100);

  const stub = themeOf(ex, "ch.Grundwasserschutzzonen", "not_affects")[0];
  assert.equal(stub.legalStatus, "unknown");
  assert.equal(stub.areaPct, null);
  assert.deepEqual(stub.lawLinks, []);
});

test("Fixture: Rohdaten sind verschlankt (keine Logos, Karten, Geometrien)", () => {
  const ex = parseExtractResponse(fixture, "SG");
  const raw = ex.raw as Record<string, unknown>;
  for (const k of ["LogoPLRCadastreRef", "FederalLogoRef", "QRCodeRef", "Glossary", "Disclaimer", "GeneralInformation"]) {
    assert.equal(k in raw, false, `${k} sollte entfernt sein`);
  }
  assert.equal("ConcernedTheme" in raw, true);
  const realEstate = raw.RealEstate as Record<string, unknown>;
  assert.equal("RestrictionOnLandownership" in realEstate, false);
  assert.equal(realEstate.EGRID, "CH123456789012");

  const themeRaw = themeOf(ex, "ch.Nutzungsplanung")[0].raw as Record<string, unknown>;
  assert.equal("Map" in themeRaw, false);
  assert.equal("SymbolRef" in themeRaw, false);
  assert.equal("LegalProvisions" in themeRaw, true);
});

// ── Zone ─────────────────────────────────────────────────────────────────────

test("Fixture: Zone W2 wird exakt extrahiert (Hinweis-Flächen ignoriert)", () => {
  const ex = parseExtractResponse(fixture, "SG");
  const zone = sg.extractZone(ex);
  assert.deepEqual(zone, { zone: "W2", confidence: "exact", source: "oereb:SG" });
});

function extractWith(entries: Partial<OerebTheme>[]): OerebExtract {
  return {
    canton: "SG", egrid: "CH000000000000", identDn: null, parcelNumber: null, municipality: null, raw: null,
    themes: entries.map((e) => ({
      themeCode: "ch.Nutzungsplanung", themeName: "Nutzungsplanung", subTheme: null, concern: "affects",
      legalStatus: "inForce", areaPct: null, areaM2: null, typeCode: null, legendText: null,
      lawLinks: [], authority: null, raw: null, ...e,
    })),
  };
}

test("Zone: Grobklasse aus Code-Tabelle → 'coarse'", () => {
  const ex = extractWith([{ typeCode: "2102001", legendText: "BauG Landwirtschaftszone", areaPct: 100 }]);
  assert.deepEqual(sg.extractZone(ex), { zone: "Landwirtschaftszone", confidence: "coarse", source: "oereb:SG" });
});

test("Zone: grösster Flächenanteil gewinnt, Überlagerungen zählen nicht", () => {
  const ex = extractWith([
    { typeCode: "1304201", legendText: "BauG Wohn-Gewerbezone WG4", areaPct: 8.5 },
    { typeCode: "1608001", legendText: "BauG Grünzone Freihaltung", areaPct: 91.5 },
    { typeCode: "5302001", legendText: "BauG Naturgefahren kommunaler Hinweis", areaPct: 100 },
    { typeCode: "4401101", legendText: "Hinweis Wald", areaPct: 100 },
  ]);
  assert.deepEqual(sg.extractZone(ex), { zone: "Grünzone Freihaltung", confidence: "coarse", source: "oereb:SG" });

  const picked = pickZoneRestriction(ex);
  assert.equal(picked?.typeCode, "5302001"); // generisch: nur "Hinweis …"-Legenden gefiltert
});

test("Zone: ohne Nutzungsplanung oder nur Überlagerungen → 'none'", () => {
  assert.equal(sg.extractZone(extractWith([])).confidence, "none");
  const overlaysOnly = extractWith([{ typeCode: "6911001", legendText: "BauG Festlegung Planungswert Laerm", areaPct: 100 }]);
  assert.deepEqual(sg.extractZone(overlaysOnly), { zone: null, confidence: "none", source: "oereb:SG" });
  const notAffected = extractWith([{ typeCode: "1104101", legendText: "BauG Wohnzone W2", concern: "not_affects" }]);
  assert.equal(sg.extractZone(notAffected).confidence, "none");
});

test("Zone: kommunale Kürzel aus echten SG-Legenden", () => {
  const cases: [string, string | null][] = [
    ["BauG Wohnzone W2", "W2"],
    ["BauG Wohnzone WE", "WE"],
    ["BauG Wohn-Gewerbezone WG3", "WG3"],
    ["BauG Dorfkernzone DK2", "DK2"],
    ["Wohnzone 9 5 W9.5", "W9.5"],
    ["Wohnzone niedrige Dichte W 11.0", "W11.0"],
    ["Kernzone K 12.5", "K12.5"],
    ["Arbeitszone A13 0 A13.0", "A13.0"],
    ["BauG Gewerbe-Industriezone GI A", "GI A"],
    ["BauG Industriezone IA", "IA"],
    ["Zone für öffentliche Bauten und Anlagen ÖBA", "ÖBA"],
    ["Landwirtschaftszone L", "L"],
    ["Freihaltezone Sport und Freizeit FiB SF", "FiB SF"],
    ["BauG Zone für öffentliche Bauten und Anlagen", null],
    ["BauG Landwirtschaftszone", null],
    ["BauG Grünzone Freihaltung", null],
    ["BauG übriges Gemeindegebiet Strasse Weg", null],
    ["Hinweis Wald", null],
    ["", null],
  ];
  for (const [legend, expected] of cases) {
    assert.equal(sgExactZoneCode(legend), expected, `Legende "${legend}"`);
  }
});

test("Zone: Code-Tabelle (ARE-Hauptnutzung + SG-Verfeinerung)", () => {
  assert.equal(sgZoneClass("1104101"), "Wohnzone");
  assert.equal(sgZoneClass("11011W9.5"), "Wohnzone");
  assert.equal(sgZoneClass("1402501"), "Dorfkernzone");
  assert.equal(sgZoneClass("1499999"), "Zentrumszone");
  assert.equal(sgZoneClass("2102001"), "Landwirtschaftszone");
  assert.equal(sgZoneClass("4301001"), "Übriges Gemeindegebiet");
  assert.equal(sgZoneClass("S2"), null);
  assert.equal(sgZoneClass(null), null);
});

// ── Tolerantes Parsing ───────────────────────────────────────────────────────

test("Tolerant: Extract/extract, Klein-/Grossschreibung, Strings statt Text-Arrays, deutsche Lawstatus-Codes", () => {
  const variant = {
    GetExtractByIdResponse: {
      Extract: {
        realestate: {
          egrid: "ch987654321098",
          number: 77,
          identdn: "SG0200329300",
          Municipality: [{ Language: "fr", Text: "Mels (fr)" }, { Language: "de", Text: "Mels" }],
          restrictiononlandownership: {
            theme: { code: "ch.Nutzungsplanung", text: "Nutzungsplanung" },
            lawstatus: { code: "AenderungMitVorwirkung" },
            partinpercent: "100",
            areashare: "812",
            typecode: 1104201,
            legendtext: "BauG Wohnzone W3",
            legalprovisions: [{ title: "Baureglement", textatweb: "https://example.invalid/br" }],
            responsibleoffice: { name: "Gemeinde Mels" },
          },
        },
        concernedtheme: [
          { code: "ch.Nutzungsplanung", text: "Nutzungsplanung" },
          { code: "ch.Grundwasserschutzzonen", text: [{ language: "de", text: "Grundwasserschutzzonen" }] },
        ],
        notconcernedtheme: { code: "ch.Waldreservate", text: "Waldreservate" },
        themewithoutdata: [],
      },
    },
  };
  const ex = parseExtractResponse(variant, "SG");
  assert.equal(ex.egrid, "ch987654321098");
  assert.equal(ex.parcelNumber, "77");
  assert.equal(ex.municipality, "Mels"); // deutsch bevorzugt
  assert.equal(ex.canton, "SG"); // Fallback auf Aufrufer-Kanton

  const np = themeOf(ex, "ch.Nutzungsplanung")[0];
  assert.equal(np.legalStatus, "changeWithPreEffect");
  assert.equal(np.areaPct, 100);
  assert.equal(np.areaM2, 812);
  assert.equal(np.typeCode, "1104201");
  assert.equal(np.legendText, "BauG Wohnzone W3");
  assert.deepEqual(np.lawLinks, [{ title: "Baureglement", url: "https://example.invalid/br" }]);
  assert.deepEqual(np.authority, { name: "Gemeinde Mels", url: null });

  // ConcernedTheme ohne Restriction bleibt als 'affects' ohne Details erhalten
  const gw = themeOf(ex, "ch.Grundwasserschutzzonen");
  assert.equal(gw.length, 1);
  assert.equal(gw[0].themeName, "Grundwasserschutzzonen");
  assert.equal(gw[0].legalStatus, "unknown");

  assert.equal(themeOf(ex, "ch.Waldreservate", "not_affects").length, 1);
  assert.equal(ex.themes.length, 3);
  assert.deepEqual(sg.extractZone(ex), { zone: "W3", confidence: "exact", source: "oereb:SG" });
});

test("Tolerant: Auszug ohne Hülle (direkt extract-Objekt) wird akzeptiert", () => {
  const bare = (fixture as { GetExtractByIdResponse: { extract: unknown } }).GetExtractByIdResponse.extract;
  const ex = parseExtractResponse(bare, "SG");
  assert.equal(ex.egrid, "CH123456789012");
  assert.equal(ex.themes.length, 25);
});

test("Fehler: kein RealEstate / keine EGRID → OerebParseError (kein stiller Fallback)", () => {
  assert.throws(() => parseExtractResponse({ GetExtractByIdResponse: { extract: {} } }, "SG"), OerebParseError);
  assert.throws(() => parseExtractResponse({ RealEstate: { Number: "1" } }, "SG"), OerebParseError);
  assert.throws(() => parseExtractResponse("nope", "SG"), OerebParseError);
  assert.throws(() => parseExtractResponse(null, "SG"), OerebParseError);
});

test("Helfer: localizedText und mapLawStatus", () => {
  assert.equal(localizedText([{ Language: "fr", Text: "Zone" }, { Language: "de", Text: "Zone (de)" }]), "Zone (de)");
  assert.equal(localizedText([{ Language: "it", Text: "Zona" }]), "Zona");
  assert.equal(localizedText({ Language: "de", Text: "  Einzeln  " }), "Einzeln");
  assert.equal(localizedText("plain"), "plain");
  assert.equal(localizedText(""), null);
  assert.equal(localizedText(undefined), null);

  assert.equal(mapLawStatus("inKraft"), "inForce");
  assert.equal(mapLawStatus("inForce"), "inForce");
  assert.equal(mapLawStatus("AenderungOhneVorwirkung"), "changeWithoutPreEffect");
  assert.equal(mapLawStatus("changeWithPreEffect"), "changeWithPreEffect");
  assert.equal(mapLawStatus("???"), "unknown");
  assert.equal(mapLawStatus(undefined), "unknown");
});

test("GetEGRIDResponse: SG-Form, Liste ohne Hülle, 204 (null)", () => {
  const sgShape = {
    GetEGRIDResponse: [
      { egrid: "CH481900187727", number: "10044", identDN: "SG0200329600", type: { Code: "Distinct_and_permanent_rights.BuildingRight" } },
      { egrid: "ch471877190001", number: "1216", identDN: "SG0200329600", type: { Code: "RealEstate" } },
    ],
  };
  const parsed = parseEgridResponse(sgShape);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].egrid, "CH471877190001");
  assert.equal(parsed[1].typeCode, "RealEstate");
  assert.equal(parsed[0].typeCode, "Distinct_and_permanent_rights.BuildingRight");

  assert.equal(parseEgridResponse([{ EGRID: "CH000000000001" }]).length, 1);
  assert.deepEqual(parseEgridResponse(null), []);
  assert.deepEqual(parseEgridResponse({ GetEGRIDResponse: [] }), []);
});

// ── Kanton AR ────────────────────────────────────────────────────────────────

test("AR-Fixture: echter Auszug Herisau (anonymisiert) wird geparst", () => {
  const ex = parseExtractResponse(arFixture, "AR");
  assert.equal(ex.canton, "AR");
  assert.equal(ex.egrid, "CH987654321098");
  assert.equal(ex.identDn, "AR0200300100");
  assert.equal(ex.municipality, "Herisau");

  const zone = themeOf(ex, "ch.Nutzungsplanung")[0];
  assert.equal(zone.typeCode, "1310");
  assert.equal(zone.legendText, "Wohn- und Gewerbezone WG2");
  assert.equal(zone.legalStatus, "inForce");
  assert.equal(zone.areaPct, 100);
  assert.deepEqual(zone.authority, { name: "Gemeinde Herisau", url: "https://www.herisau.ch/" });
  assert.equal(themeOf(ex, "ch.Laermempfindlichkeitsstufen")[0].typeCode, "III");
  assert.equal(themeOf(ex, "ch.AR.ZonenplanGefahren", "no_data").length, 1);

  assert.deepEqual(ar.extractZone(ex), { zone: "WG2", confidence: "exact", source: "oereb:AR" });
});

test("AR: kommunale Kürzel aus echten AR-Legenden", () => {
  const cases: [string, string | null][] = [
    ["Wohnzone W2", "W2"],
    ["Wohnzone W2b", "W2b"],
    ["Wohnzone W3a", "W3a"],
    ["Wohnzone W1.4", "W1.4"],
    ["Wohn- und Gewerbezone WG45", "WG45"],
    ["Gewerbezone GE I", "GE I"],
    ["Industriezone I4", "I4"],
    ["Kernzone K", "K"],
    ["Zone für öffentliche Bauten und Anlagen OE", "OE"],
    ["Grünzone im Baugebiet GRiF", "GRiF"],
    ["Verkehrsfläche VFiB", "VFiB"],
    ["übriges Gemeindegebiet ÜG", "ÜG"],
    ["Wald WA", "WA"],
  ];
  for (const [legend, expected] of cases) {
    assert.equal(arExactZoneCode(legend), expected, `Legende "${legend}"`);
  }
});

test("AR: Code-Tabelle (ARE-Hauptnutzung + AR-Verfeinerung)", () => {
  assert.equal(arZoneClass("1120"), "Wohnzone");
  assert.equal(arZoneClass("1260"), "Industriezone");
  assert.equal(arZoneClass("1220"), "Gewerbezone");
  assert.equal(arZoneClass("1650"), "Grünzone nach altem Baugesetz");
  assert.equal(arZoneClass("1630"), "Grünzone im Baugebiet");
  assert.equal(arZoneClass("4410"), "Wald");
  assert.equal(arZoneClass("4110"), "Weilerzone");
  assert.equal(arZoneClass("S2"), null);
  assert.equal(arZoneClass(null), null);
});

test("AR: Wald ist Grundnutzung, Quartierplanpflicht/Wintersport sind Überlagerungen", () => {
  const qpp = extractWith([
    { typeCode: "1320", legendText: "Wohn- und Gewerbezone WG3", areaPct: 98.4 },
    { typeCode: "4310", legendText: "übriges Gemeindegebiet ÜG", areaPct: 1.6 },
    { typeCode: "6220", legendText: "Zone mit Quartierplanpflicht QPPF", areaPct: 98.4 },
  ]);
  assert.deepEqual(ar.extractZone(qpp), { zone: "WG3", confidence: "exact", source: "oereb:AR" });

  const ski = extractWith([
    { typeCode: "2110", legendText: "Landwirtschaftszone L", areaPct: 64 },
    { typeCode: "5910", legendText: "Zone für Wintersport WS", areaPct: 100 },
  ]);
  assert.equal(ar.extractZone(ski).zone, "L");

  const wald = extractWith([
    { typeCode: "2110", legendText: "Landwirtschaftszone L", areaPct: 20 },
    { typeCode: "4410", legendText: "Wald", areaPct: 80 },
  ]);
  assert.deepEqual(ar.extractZone(wald), { zone: "Wald", confidence: "coarse", source: "oereb:AR" });
});

test("AR: GetEGRID über IDENTDN = AR0200 + BFS + 00", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({ GetEGRIDResponse: [{ egrid: "CH987654321098", number: "4321", identDN: "AR0200300100", type: { Code: "RealEstate" } }] }),
      { status: 200 }
    );
  }) as typeof fetch;
  try {
    const egrids = await ar.getEgrid({ municipality: "Herisau", parcelNumber: "4321", bfsNumber: 3001 });
    assert.deepEqual(egrids, ["CH987654321098"]);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/getegrid\/json\/\?IDENTDN=AR0200300100&NUMBER=4321$/);
  } finally {
    globalThis.fetch = original;
  }
});

test("AR: ohne Basis-URL → unreachable", async () => {
  await assert.rejects(new ArOerebAdapter("").getExtract("CH987654321098"), OerebUnreachableError);
});

test("geo.admin-Fallback: Umlaute umschreiben, Kantonszusatz akzeptieren, zweite Suche mit Kanton", async () => {
  const searches: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url));
    const text = u.searchParams.get("searchText") ?? "";
    searches.push(text);
    const results: Record<string, string[]> = {
      "buehler 10": ["10 buehler 3021 ch767765607741"],
      "teufen 10": ["10 teufen _ar_ 3024 ch312181527734", "10 teufenthal _ag_ 4145 ch000000000001"],
      "stein 10": ["10 stein _ag_ 4260 ch000000000002"],
      "stein ar 10": ["10 stein _ar_ 3005 ch175477742904"],
    };
    const details = results[text] ?? [];
    return new Response(JSON.stringify({ results: details.map((detail) => ({ attrs: { detail } })) }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await ar.getEgrid({ municipality: "Bühler", parcelNumber: "10" }), ["CH767765607741"]);
    assert.deepEqual(await ar.getEgrid({ municipality: "Teufen", parcelNumber: "10" }), ["CH312181527734"]);
    assert.deepEqual(await ar.getEgrid({ municipality: "Stein", parcelNumber: "10" }), ["CH175477742904"]);
    assert.deepEqual(searches, ["buehler 10", "teufen 10", "stein 10", "stein ar 10"]);
  } finally {
    globalThis.fetch = original;
  }
});
