/** Suche, Parzellenauflösung und Kantonsnamen gegen gemockte api3-Antworten. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { canonicalThemeCode, isFederalTheme, matchOerebNorms } from "../oereb/mapping";
import { resetGeoAdminBucket } from "./client";
import { cantonFromName, lookupParcel, resolveParcel } from "./parcel";
import { parseSearchResponse, searchGeo } from "./search";
import { parseParcelIdentity } from "./validate";

const original = globalThis.fetch;
let searches: string[] = [];
let finds: string[] = [];
let identifies: string[] = [];
const identifyRows = new Map<string, Record<string, unknown>>();

interface Stand { gemeindename: string; kanton: string; number: string; bfs_nr: number; realestate_type?: string }

function parcelHit(detail: string) {
  return { attrs: { origin: "parcel", detail, label: "Name 1 (CH 0)", x: 1254543.375, y: 2746223.5 }, id: 1 };
}

function mockApi(searchResults: Record<string, string[]>, stands: Record<string, Stand>) {
  searches = [];
  finds = [];
  identifies = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("SearchServer")) {
      const text = u.searchParams.get("searchText") ?? "";
      searches.push(text);
      return new Response(JSON.stringify({ results: (searchResults[text] ?? []).map(parcelHit) }), { status: 200 });
    }
    if (u.pathname.endsWith("identify")) {
      identifies.push(u.searchParams.get("geometry") ?? "");
      const attributes = identifyRows.get(u.searchParams.get("geometry") ?? "");
      return new Response(JSON.stringify({ results: attributes ? [{ attributes }] : [] }), { status: 200 });
    }
    const egrid = u.searchParams.get("searchText") ?? "";
    finds.push(egrid);
    const stand = stands[egrid];
    return new Response(
      JSON.stringify({ results: stand ? [{ attributes: { egris_egrid: egrid, realestate_type: "Liegenschaft", ...stand } }] : [] }),
      { status: 200 }
    );
  }) as typeof fetch;
}

beforeEach(() => {
  resetGeoAdminBucket();
  identifyRows.clear();
});
afterEach(() => {
  globalThis.fetch = original;
});

test("Suche: x ist Nord, y ist Ost; HTML weg; Parzelle mit EGRID, Adresse mit Kanton", () => {
  const hits = parseSearchResponse({
    results: [
      {
        id: 3175798,
        attrs: {
          origin: "parcel",
          detail: "c0716 saint-gall                                         3203 ch507759798797",
          label: "<b>Saint-Gall                                        </b> C0716 (CH 5077 5979 8797)",
          x: 1254543.375, y: 2746223.5,
        },
      },
      {
        id: 2589394,
        attrs: {
          origin: "address",
          detail: "limmatquai 55 8001 zuerich 261 zuerich ch zh",
          label: "Limmatquai 55 <b>8001 Zürich</b>",
          x: 1247329.25, y: 2683393.25,
        },
      },
      { id: 3, attrs: { origin: "parcel", detail: "kaputt" , label: "x", x: 1, y: 2 } },
    ],
  });
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    id: "3175798", kind: "parcel", label: "Saint-Gall C0716 (CH 5077 5979 8797)", e: 2746223.5, n: 1254543.375,
    egrid: "CH507759798797", number: "C0716", municipality: "Saint-Gall", bfs: 3203, canton: null,
  });
  assert.deepEqual(hits[1], {
    id: "2589394", kind: "address", label: "Limmatquai 55 8001 Zürich", e: 2683393.25, n: 1247329.25,
    egrid: null, number: null, municipality: "Zürich", bfs: 261, canton: "ZH",
  });
});

test("Suche: Ausfall ergibt unavailable statt Fehler", async () => {
  globalThis.fetch = (async () => new Response("", { status: 503 })) as typeof fetch;
  assert.deepEqual(await searchGeo("Bahnhofstrasse"), { results: [], unavailable: true });
});

test("Kantonsnamen: Sprachformen und Unbekanntes", () => {
  const cases: [string, string][] = [
    ["Genève", "GE"], ["Ticino", "TI"], ["Vaud", "VD"], ["Valais", "VS"], ["St. Gallen", "SG"], ["Fribourg", "FR"],
    ["Neuchâtel", "NE"], ["Zürich", "ZH"], ["Graubünden", "GR"], ["Basel-Stadt", "BS"], ["Basel-Landschaft", "BL"],
    ["Appenzell Ausserrhoden", "AR"], ["Appenzell Innerrhoden", "AI"], ["Uri", "UR"], ["Jura", "JU"],
  ];
  for (const [name, code] of cases) assert.equal(cantonFromName(name), code, name);
  assert.equal(cantonFromName("Atlantis"), null);
  assert.equal(cantonFromName(null), null);
});

test("resolveParcel: St. Gallen via «saint-gall» (Name kommt aus dem Layer)", async () => {
  mockApi(
    { "st. gallen C0716": ["c0716 saint-gall 3203 ch507759798797", "c07160 saint-gall 3203 ch000000000009"] },
    { CH507759798797: { gemeindename: "St. Gallen", kanton: "St. Gallen", number: "C0716", bfs_nr: 3203 } }
  );
  const r = await resolveParcel({ canton: "SG", municipality: "St. Gallen", number: "C0716" });
  assert.equal(r.status, "ok");
  assert.equal(r.candidates[0].egrid, "CH507759798797");
  assert.equal(r.candidates[0].canton, "SG");
  assert.equal(r.candidates[0].e, 2746223.5);
  assert.deepEqual(finds, ["CH507759798797"], "andere Nummer wird nicht nachgeschlagen");
});

test("resolveParcel: identify am Trefferort genügt, find entfällt", async () => {
  mockApi({ "zug 557": ["557 zug 1711 ch727473066563"] }, {});
  identifyRows.set("2746223.5,1254543.375", {
    egris_egrid: "CH727473066563", gemeindename: "Zug", kanton: "Zug", number: "557", bfs_nr: 1711, realestate_type: "Liegenschaft",
  });
  const r = await resolveParcel({ canton: "ZG", municipality: "Zug", number: "557" });
  assert.equal(r.status, "ok");
  assert.deepEqual(identifies, ["2746223.5,1254543.375"]);
  assert.deepEqual(finds, []);
});

test("resolveParcel: SH, zwei Grundstücke mit gleicher Nummer ergeben ambiguous", async () => {
  mockApi(
    { "schaffhausen 481": ["481 schaffhausen 2939 ch215434087129", "481 schaffhouse 2939 ch445408781787"] },
    {
      CH215434087129: { gemeindename: "Schaffhausen", kanton: "Schaffhausen", number: "481", bfs_nr: 2939 },
      CH445408781787: { gemeindename: "Schaffhausen", kanton: "Schaffhausen", number: "481", bfs_nr: 2939 },
    }
  );
  const r = await resolveParcel({ canton: "SH", municipality: "Schaffhausen", number: "481" });
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.candidates.map((c) => c.egrid), ["CH215434087129", "CH445408781787"]);
});

test("resolveParcel: Nummer mit führender Null, Baurecht zählt nicht neben der Liegenschaft", async () => {
  mockApi(
    { "basel 0121": ["0121 basel 2701 ch907067448984", "121 basel 2701 ch000000000001"] },
    {
      CH907067448984: { gemeindename: "Basel", kanton: "Basel-Stadt", number: "0121", bfs_nr: 2701 },
      CH000000000001: { gemeindename: "Basel", kanton: "Basel-Stadt", number: "121", bfs_nr: 2701, realestate_type: "Baurecht" },
    }
  );
  const r = await resolveParcel({ canton: "BS", municipality: "Basel", number: "0121" });
  assert.equal(r.status, "ok");
  assert.equal(r.candidates[0].egrid, "CH907067448984");
});

test("resolveParcel: Umlaute umschreiben, Kantonszusatz, zweite Suche mit Kanton", async () => {
  mockApi(
    {
      "buehler 10": ["10 buehler 3021 ch767765607741"],
      "teufen 10": ["10 teufen _ar_ 3024 ch312181527734", "10 teufenthal _ag_ 4145 ch000000000001"],
      "stein 10": ["10 stein _ag_ 4260 ch000000000002"],
      "stein ar 10": ["10 stein _ar_ 3005 ch175477742904"],
    },
    {
      CH767765607741: { gemeindename: "Bühler", kanton: "Appenzell Ausserrhoden", number: "10", bfs_nr: 3021 },
      CH312181527734: { gemeindename: "Teufen (AR)", kanton: "Appenzell Ausserrhoden", number: "10", bfs_nr: 3024 },
      CH000000000001: { gemeindename: "Teufenthal (AG)", kanton: "Aargau", number: "10", bfs_nr: 4145 },
      CH000000000002: { gemeindename: "Stein (AG)", kanton: "Aargau", number: "10", bfs_nr: 4260 },
      CH175477742904: { gemeindename: "Stein (AR)", kanton: "Appenzell Ausserrhoden", number: "10", bfs_nr: 3005 },
    }
  );
  const egridOf = async (municipality: string) =>
    (await resolveParcel({ canton: "AR", municipality, number: "10" })).candidates.map((c) => c.egrid);
  assert.deepEqual(await egridOf("Bühler"), ["CH767765607741"]);
  assert.deepEqual(await egridOf("Teufen"), ["CH312181527734"]);
  assert.deepEqual(await egridOf("Stein"), ["CH175477742904"]);
  assert.deepEqual(searches, ["buehler 10", "teufen 10", "stein 10", "stein ar 10"]);
});

test("resolveParcel: mit BFS genügt die Nummer, Filter nach BFS", async () => {
  mockApi(
    { "3203 C0716": ["c0716 saint-gall 3203 ch507759798797", "c0716 anderswo 1234 ch000000000005"] },
    {}
  );
  const r = await resolveParcel({ canton: "SG", municipality: "", number: "C0716", bfs: 3203 });
  assert.equal(r.status, "ok");
  assert.equal(r.candidates[0].egrid, "CH507759798797");
  assert.equal(finds.length, 0);
});

test("resolveParcel: null Treffer und Ausfall", async () => {
  mockApi({}, {});
  assert.equal((await resolveParcel({ canton: "ZG", municipality: "Zug", number: "9" })).status, "no_egrid");
  globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;
  assert.equal((await resolveParcel({ canton: "ZG", municipality: "Zug", number: "9" })).status, "unavailable");
});

test("lookupParcel: Zeilen ohne EGRID verworfen, dedupliziert, PDF-Link aus bekannter Basis", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ results: [
      { attributes: { gemeindename: "Zug", kanton: "Zug", bfs_nr: 1711 } },
      { attributes: { egris_egrid: "CH727473066563", number: "557", gemeindename: "Zug", kanton: "Zug", bfs_nr: 1711, realestate_type: "Liegenschaft", oereb_extract_pdf: "https://oereb.zg.ch/ors/extract/pdf/?EGRID=CH727473066563" } },
      { attributes: { egris_egrid: "CH727473066563", number: "557", gemeindename: "Zug", kanton: "Zug", bfs_nr: 1711, realestate_type: "Liegenschaft" } },
    ] }), { status: 200 })) as typeof fetch;
  const r = await lookupParcel({ e: 2681000, n: 1224000 });
  assert.equal(r.unavailable, false);
  assert.deepEqual(r.candidates, [{
    egrid: "CH727473066563", number: "557", municipality: "Zug", bfs: 1711, canton: "ZG", e: 2681000, n: 1224000,
    type: "Liegenschaft", oereb_pdf_url: "https://oereb.zg.ch/oereb/extract/pdf/?EGRID=CH727473066563&LANG=de",
  }]);
});

test("Token-Bucket: Über 20 Requests pro Minute ergibt unavailable", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch;
  for (let i = 0; i < 20; i++) assert.equal((await searchGeo("abc")).unavailable, false);
  assert.equal((await searchGeo("abc")).unavailable, true);
});

test("Eingaben: EGRID-Regex und LV95-Grenzen, sonst verwerfen", () => {
  assert.deepEqual(
    parseParcelIdentity({ egrid: "ch507759798797", lv95_e: 2746223.5, lv95_n: "1254543.4" }),
    { egrid: "CH507759798797", lv95_e: 2746223.5, lv95_n: 1254543.4 }
  );
  assert.deepEqual(parseParcelIdentity({ egrid: "CH123", lv95_e: 1, lv95_n: 2 }), {});
  assert.deepEqual(parseParcelIdentity({}), {});
});

test("Themencodes: kanonisch auf das Grundthema", () => {
  const cases: [string, string][] = [
    ["ch.NutzungsplanungAenderungMitVorwirkung", "ch.Nutzungsplanung"],
    ["ch.NutzungsplanungAenderungOhneVorwirkung", "ch.Nutzungsplanung"],
    ["ch.GewaesserraumAenderungMitVorwirkung", "ch.Gewaesserraum"],
    ["ch.SchutzmassnahmenNaturLandschaftlokalOhneVorwirkung", "ch.SchutzmassnahmenNaturLandschaftlokal"],
    ["ch.GR.NutzungsplanungZpGgp", "ch.Nutzungsplanung"],
    ["ch.GR.NutzungsplanungGep", "ch.Nutzungsplanung"],
    ["ch.GR.NutzungsplanungFp", "ch.Nutzungsplanung"],
    ["ch.NutzungsplanungSchutz", "ch.Nutzungsplanung"],
    ["ch.Nutzungsplanung", "ch.Nutzungsplanung"],
    ["ch.OW.KantonaleNutzungsplanung", "ch.OW.KantonaleNutzungsplanung"],
  ];
  for (const [code, canonical] of cases) assert.equal(canonicalThemeCode(code), canonical, code);
  assert.equal(isFederalTheme("ch.Planungszonen"), true);
  assert.equal(isFederalTheme("ch.PlanungszonenAenderungMitVorwirkung"), true);
  assert.equal(isFederalTheme("ch.SG.Gemeindestrassenplan"), false);
});

test("Mapping vergleicht kanonisch und zählt ein Thema einmal", () => {
  const result = matchOerebNorms(
    [
      { theme_code: "ch.GR.NutzungsplanungZpGgp", theme_name: "Zonenplan" },
      { theme_code: "ch.Nutzungsplanung", theme_name: "Nutzungsplanung" },
      { theme_code: "ch.LaermempfindlichkeitsstufenAenderungMitVorwirkung", theme_name: "Lärm" },
    ],
    [{ theme_code: "ch.Nutzungsplanung", category_pattern: "baureglement" }],
    [{ id: "n1", category: "Baureglement" }]
  );
  assert.deepEqual(Array.from(result.byNorm.entries()), [["n1", ["ch.Nutzungsplanung"]]]);
  assert.deepEqual(result.gaps, [{ themeCode: "ch.Laermempfindlichkeitsstufen", themeName: "Lärm" }]);
});
