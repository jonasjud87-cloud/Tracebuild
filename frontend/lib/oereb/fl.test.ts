/** Liechtenstein (FL): EGRID, Suche, Parzelle, Adapter, Importfilter, Zone und Migration. Netz immer gestubbt. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { GeoSearchHit, ParcelCandidate } from "../geoadmin/contract";
import { resetGeoAdminBucket } from "../geoadmin/client";
import { cantonFromName, lookupParcel, parseStandTerritory } from "../geoadmin/parcel";
import { parseSearchResponse } from "../geoadmin/search";
import { isValidEgrid, parseParcelIdentity, parseProjectLocation } from "../geoadmin/validate";
import { FlOerebAdapter, flParcelHits } from "./adapters/fl";
import { GenericOerebAdapter } from "./adapters/generic";
import { RuleBasedOerebAdapter } from "./adapters/rule-based";
import { cantonLabel, countryForCanton, isFlMunicipalityCode, isOerebSupportedCanton } from "./cantons";
import { OerebNoEgridError, OerebParseError } from "./errors";
import { lookupFlParcel } from "./fl-parcel";
import { DEFAULT_IMPORT_FILTER, isHostAllowed, resolveFilterRules } from "./import-filter";
import { getAdapter } from "./registry";
import { KNOWN_BASES, oerebPdfUrl } from "./service-quirks";
import type { OerebExtract, OerebTheme } from "./types";

const original = globalThis.fetch;
const BASE = "https://fl.example/oereb";
let requests: string[] = [];

/** Stub für den FL-Dienst: Pfad + Query → Antwort; Unbekanntes → 204. */
function mockOereb(routes: Record<string, unknown>) {
  requests = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    requests.push(u);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (key === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function egridResponse(...items: { egrid: string; number: string }[]) {
  return {
    GetEGRIDResponse: items.map((i) => ({ egrid: i.egrid, number: i.number, identDN: "FL0200000044", type: { Code: "RealEstate" } })),
  };
}

function hit(over: Partial<GeoSearchHit>): GeoSearchHit {
  return {
    id: "1", kind: "parcel", label: "Vaduz 100", e: 2757446, n: 1224141, egrid: null, number: "100",
    municipality: "Vaduz", bfs: 7001, canton: "FL", ...over,
  };
}

beforeEach(() => resetGeoAdminBucket());
afterEach(() => {
  globalThis.fetch = original;
});

// ── Registrierung ────────────────────────────────────────────────────────────

test("FL registriert: Kantonsliste, Gemeinden 7001–7011, Land, Bezeichnung, Basis, Adapter", () => {
  assert.equal(isOerebSupportedCanton("fl"), true);
  assert.equal(isOerebSupportedCanton("LI"), false);
  assert.equal(isFlMunicipalityCode(7001), true);
  assert.equal(isFlMunicipalityCode(7011), true);
  assert.equal(isFlMunicipalityCode(7012), false);
  assert.equal(isFlMunicipalityCode(3271), false);
  assert.equal(isFlMunicipalityCode(null), false);
  assert.equal(countryForCanton("FL"), "LI");
  assert.equal(countryForCanton(" fl "), "LI");
  assert.equal(countryForCanton("SG"), "CH");
  assert.equal(countryForCanton(""), "CH");
  assert.equal(countryForCanton(null), "CH");
  assert.equal(cantonLabel("FL"), "Fürstentum Liechtenstein");
  assert.equal(cantonLabel("zh"), "Kanton ZH");
  assert.equal(cantonLabel(""), "");
  assert.equal(KNOWN_BASES.FL, "https://oereb.llv.li/oereb_service");
  assert.equal(
    oerebPdfUrl("FL", "LI10440010050"),
    "https://oereb.llv.li/oereb_service/extract/pdf/?EGRID=LI10440010050&LANG=de"
  );
  assert.ok(getAdapter("FL") instanceof FlOerebAdapter);
  assert.ok(!(getAdapter("SG") instanceof FlOerebAdapter));
});

// ── EGRID und Standort ───────────────────────────────────────────────────────

test("EGRID: LI + 11 Ziffern und CH + 12 Ziffern gültig, sonst nicht", () => {
  assert.equal(isValidEgrid("LI10440010050"), true);
  assert.equal(isValidEgrid("CH507759798797"), true);
  for (const bad of ["LI1044001005", "LI104400100500", "FL10440010050", "XX10440010050", "li10440010050", "CH50775979879"]) {
    assert.equal(isValidEgrid(bad), false, bad);
  }
  assert.deepEqual(parseParcelIdentity({ egrid: " li10440010050 " }), { egrid: "LI10440010050" });
});

test("Standort: canton FL zulässig, LI nicht", () => {
  assert.deepEqual(parseProjectLocation({ canton: "fl", municipality: "Vaduz" }), { location: { canton: "FL", municipality: "Vaduz" } });
  assert.deepEqual(parseProjectLocation({ canton: "LI" }), { error: "Ungültiger Kanton" });
});

// ── Suche ────────────────────────────────────────────────────────────────────

test("Suche: FL-Adresse ohne Kürzel → FL/7002, Buchs SG bleibt SG, Unbekanntes ohne Kanton", () => {
  const hits = parseSearchResponse({
    results: [
      { id: 1, attrs: { origin: "address", detail: "landstrasse 1 9495 triesen 7002 triesen ch", label: "Landstrasse 1 <b>9495 Triesen</b>", x: 1219000, y: 2758000 } },
      { id: 2, attrs: { origin: "address", detail: "bahnhofstrasse 1 9470 buchs sg 3271 buchs (sg) ch sg", label: "Bahnhofstrasse 1 9470 Buchs SG", x: 1225000, y: 2754000 } },
      { id: 3, attrs: { origin: "address", detail: "irgendwo 1 9999 nirgends 4242 nirgends ch", label: "Irgendwo 1 9999 Nirgends", x: 1225000, y: 2754000 } },
    ],
  });
  assert.equal(hits.length, 3);
  assert.deepEqual([hits[0].canton, hits[0].bfs, hits[0].municipality], ["FL", 7002, "Triesen"]);
  assert.deepEqual([hits[1].canton, hits[1].bfs], ["SG", 3271]);
  assert.deepEqual([hits[2].canton, hits[2].bfs], [null, null]);
});

test("Suche: FL-Parzelle mit drei Tokens → ohne EGRID; drei Tokens mit CH-BFS verworfen", () => {
  const hits = parseSearchResponse({
    results: [
      { id: 7, attrs: { origin: "parcel", detail: "100 vaduz 7001", label: "<b>Vaduz</b> 100", x: 1224141, y: 2757446 } },
      { id: 8, attrs: { origin: "parcel", detail: "100 buchs 3271", label: "Buchs 100", x: 1225000, y: 2754000 } },
    ],
  });
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], {
    id: "7", kind: "parcel", label: "Vaduz 100", e: 2757446, n: 1224141,
    egrid: null, number: "100", municipality: "Vaduz", bfs: 7001, canton: "FL",
  });
});

// ── Parzelle an einer FL-Koordinate ──────────────────────────────────────────

const FL_ROW = { gemeindename: "Vaduz", bfs_nr: 7001, kanton: "Fürstentum Liechtenstein", egris_egrid: null };
const CH_ROW = { gemeindename: "Buchs (SG)", bfs_nr: 3271, kanton: "St. Gallen", egris_egrid: "CH123456789012", number: "7", realestate_type: "Liegenschaft" };

function mockIdentify(rows: Record<string, unknown>[]) {
  globalThis.fetch = (async () => new Response(JSON.stringify({ results: rows.map((attributes) => ({ attributes })) }), { status: 200 })) as typeof fetch;
}

const flCandidate: ParcelCandidate = {
  egrid: "LI10440010050", number: "100", municipality: "Vaduz", bfs: 7001, canton: "FL",
  e: 2757446, n: 1224141, type: null, oereb_pdf_url: null,
};

test("Kantonsname: Fürstentum Liechtenstein → FL; Gebiet aus der Gemeindezeile", () => {
  assert.equal(cantonFromName("Fürstentum Liechtenstein"), "FL");
  assert.equal(cantonFromName("Liechtenstein"), "FL");
  assert.deepEqual(parseStandTerritory({ results: [{ attributes: FL_ROW }] }), { canton: "FL", municipality: "Vaduz", bfs: 7001 });
  assert.equal(parseStandTerritory({ results: [] }), null);
});

test("lookupParcel: FL-Gemeindezeile + Rückfall → ein Kandidat", async () => {
  mockIdentify([FL_ROW]);
  const calls: unknown[] = [];
  const r = await lookupParcel({ e: 2757446, n: 1224141 }, {
    fallback: async (e, n, place) => {
      calls.push({ e, n, place });
      return [flCandidate];
    },
  });
  assert.deepEqual(r, { candidates: [flCandidate], unavailable: false });
  assert.deepEqual(calls, [{ e: 2757446, n: 1224141, place: { canton: "FL", municipality: "Vaduz", bfs: 7001 } }]);
});

test("lookupParcel: LI-EGRID mit Koordinate ohne find, Rückfall gefiltert auf die EGRID", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ results: [{ attributes: FL_ROW }] }), { status: 200 });
  }) as typeof fetch;
  const other = { ...flCandidate, egrid: "LI99999999999" };
  const r = await lookupParcel({ egrid: "LI10440010050", e: 2757446, n: 1224141 }, { fallback: async () => [other, flCandidate] });
  assert.deepEqual(r.candidates, [flCandidate]);
  assert.ok(urls.every((u) => u.includes("identify")), "kein langsames find für LI");
});

test("lookupParcel: CH-Zeile → Rückfall wird nicht aufgerufen", async () => {
  mockIdentify([CH_ROW]);
  let called = false;
  const r = await lookupParcel({ e: 2754000, n: 1225000 }, { fallback: async () => { called = true; return []; } });
  assert.equal(called, false);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].canton, "SG");
});

test("lookupParcel: Rückfall im Timeout → unavailable; ohne Rückfall → leer", async () => {
  mockIdentify([FL_ROW]);
  const slow = await lookupParcel({ e: 2757446, n: 1224141 }, {
    budgetMs: 50,
    fallback: () => new Promise<ParcelCandidate[]>(() => undefined),
  });
  assert.deepEqual(slow, { candidates: [], unavailable: true });

  const failing = await lookupParcel({ e: 2757446, n: 1224141 }, { fallback: async () => { throw new Error("HTTP 503"); } });
  assert.deepEqual(failing, { candidates: [], unavailable: true });

  mockIdentify([FL_ROW]);
  assert.deepEqual(await lookupParcel({ e: 2757446, n: 1224141 }), { candidates: [], unavailable: false });
});

test("lookupFlParcel: EGRID über GetEGRID (EN), Ort aus der Gemeindezeile", async () => {
  mockOereb({ "/getegrid/json/?EN=2757446,1224141": egridResponse({ egrid: "LI10440010050", number: "100" }) });
  const out = await lookupFlParcel(2757446, 1224141, { canton: "FL", municipality: "Vaduz", bfs: 7001 }, AbortSignal.timeout(5000), new FlOerebAdapter(BASE));
  assert.deepEqual(out, [{ ...flCandidate, oereb_pdf_url: oerebPdfUrl("FL", "LI10440010050") }]);
});

// ── Adapter ──────────────────────────────────────────────────────────────────

test("FlOerebAdapter.resolveEgrid: mit EN direkt; 204 → leer", async () => {
  mockOereb({ "EN=2757446,1224141": egridResponse({ egrid: "LI10440010050", number: "100" }) });
  const adapter = new FlOerebAdapter(BASE, async () => { throw new Error("Suche darf nicht laufen"); });
  const ok = await adapter.resolveEgrid({ municipality: "", parcelNumber: "", en: [2757446, 1224141] });
  assert.deepEqual(ok.egrids, ["LI10440010050"]);
  assert.equal(ok.candidates[0].canton, "FL");

  const none = await adapter.resolveEgrid({ municipality: "", parcelNumber: "", en: [2754000, 1225000] });
  assert.deepEqual(none, { egrids: [], candidates: [] });
});

test("FlOerebAdapter.resolveEgrid: Gemeinde + Nummer über die Suche, Nummer geprüft", async () => {
  mockOereb({
    "EN=1,1": egridResponse({ egrid: "LI10440010050", number: "100" }),
    "EN=2,2": egridResponse({ egrid: "LI20000000001", number: "100" }),
    "EN=3,3": egridResponse({ egrid: "LI30000000001", number: "101" }),
  });
  const texts: string[] = [];
  const search = (results: GeoSearchHit[]) => async (text: string) => {
    texts.push(text);
    return results;
  };

  const single = new FlOerebAdapter(BASE, search([hit({ e: 1, n: 1 }), hit({ e: 9, n: 9, bfs: 3271, canton: null })]));
  const r1 = await single.resolveEgrid({ municipality: "Vaduz", parcelNumber: "100", bfsNumber: 7001 });
  assert.deepEqual(r1.egrids, ["LI10440010050"]);
  assert.deepEqual([r1.candidates[0].municipality, r1.candidates[0].bfs], ["Vaduz", 7001]);
  assert.deepEqual(texts, ["vaduz 100"]);

  const two = new FlOerebAdapter(BASE, search([hit({ e: 1, n: 1 }), hit({ e: 2, n: 2 })]));
  const r2 = await two.resolveEgrid({ municipality: "Vaduz", parcelNumber: "100" });
  assert.deepEqual(r2.egrids, ["LI10440010050", "LI20000000001"], "zwei Grundstücke → ambiguous");

  const wrongNumber = new FlOerebAdapter(BASE, search([hit({ e: 3, n: 3 })]));
  assert.deepEqual(await wrongNumber.resolveEgrid({ municipality: "Vaduz", parcelNumber: "100" }), { egrids: [], candidates: [] });

  const nothing = new FlOerebAdapter(BASE, search([]));
  assert.deepEqual(await nothing.resolveEgrid({ municipality: "Vaduz", parcelNumber: "100" }), { egrids: [], candidates: [] });
});

test("FlOerebAdapter.resolveEgrid: nie resolveParcel (kein Layer-Abruf), ohne Gemeinde leer", async () => {
  mockOereb({});
  const adapter = new FlOerebAdapter(BASE, async () => []);
  assert.deepEqual(await adapter.resolveEgrid({ municipality: "", parcelNumber: "100" }), { egrids: [], candidates: [] });
  await adapter.resolveEgrid({ municipality: "Vaduz", parcelNumber: "100" });
  assert.ok(requests.every((u) => !u.includes("geo.admin.ch")), requests.join(", "));
});

test("flParcelHits: nur FL, gleiche Nummer, BFS oder angezeigter Name", () => {
  const hits = [
    hit({ id: "a" }),
    hit({ id: "b", number: "0100", e: 5 }),
    hit({ id: "c", bfs: 7005, municipality: "Schaan", e: 6 }),
    hit({ id: "d", bfs: 3271, canton: null, e: 7 }),
    hit({ id: "e", number: "1000", e: 8 }),
  ];
  assert.deepEqual(flParcelHits(hits, { parcelNumber: "100", bfsNumber: 7001 }).map((h) => h.id), ["a", "b"]);
  assert.deepEqual(flParcelHits(hits, { parcelNumber: "100", municipality: "Schaan" }).map((h) => h.id), ["c"]);
});

test("getExtract: LI zulässig, fremde EGRID im Auszug → ParseError, CH an FL mit 204 → NoEgrid", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/live/FL.json", import.meta.url), "utf8"));
  mockOereb({ "EGRID=LI10440010050": fixture, "EGRID=LI99999999999": fixture });
  const adapter = new GenericOerebAdapter("FL", BASE);
  const ex = await adapter.getExtract("li10440010050");
  assert.equal(ex.egrid, "LI10440010050");
  assert.ok(requests[0].includes("LANG=de"));
  await assert.rejects(adapter.getExtract("LI99999999999"), OerebParseError);
  await assert.rejects(adapter.getExtract("CH507759798797"), OerebNoEgridError);
  await assert.rejects(adapter.getExtract("LI123"), OerebNoEgridError);
});

// ── Importfilter ─────────────────────────────────────────────────────────────

const FL_FILTER_ROW = {
  scope: "FL",
  rules: { doc_types: [], allowed_hosts_add: ["oereblex.llv.li"], neutral_themes_add: ["fl.Nutzungsplanung"], ocr_themes_add: ["fl.Nutzungsplanung"] },
};

test("isHostAllowed: .li nur für FL und nur Hosts aus der Liste", () => {
  const fl = resolveFilterRules([FL_FILTER_ROW], "FL");
  assert.equal(isHostAllowed("oereblex.llv.li", fl, "FL"), true);
  assert.equal(isHostAllowed("OEREBLEX.LLV.LI", fl, "fl"), true);
  assert.equal(isHostAllowed("evil.li", fl, "FL"), false);
  assert.equal(isHostAllowed("oereblex.llv.li.evil.ch", fl, "FL"), false);
  assert.equal(isHostAllowed("x.fl.ch", fl, "FL"), false, "FL ist kein Kanton: kein *.fl.ch");
  assert.equal(isHostAllowed("oereblex.llv.li", fl, "SG"), false);
  assert.equal(isHostAllowed("oereblex.llv.li", DEFAULT_IMPORT_FILTER, "FL"), false, "ohne FL-Zeile nichts aus .li");
  const zh = resolveFilterRules([{ scope: "default", rules: { allowed_hosts_add: ["*.li"] } }], "ZH");
  assert.equal(isHostAllowed("oereblex.llv.li", zh, "ZH"), false);
  assert.equal(isHostAllowed("x.zh.ch", zh, "ZH"), true);
});

test("resolveFilterRules FL: doc_types [] stoppt, inaktiv stoppt, ohne Zeile Standard", () => {
  const fl = resolveFilterRules([FL_FILTER_ROW], "FL");
  assert.deepEqual(fl.doc_types, []);
  assert.ok(fl.neutral_themes.includes("fl.Nutzungsplanung"));
  assert.ok(fl.ocr_themes.includes("fl.Nutzungsplanung"));
  assert.equal(fl.ocr_enabled, false);
  const inactive = resolveFilterRules([{ ...FL_FILTER_ROW, rules: { doc_types: ["LegalProvision"] }, active: false }], "FL");
  assert.deepEqual(inactive.doc_types, []);
  const missing = resolveFilterRules([], "FL");
  assert.deepEqual(missing.doc_types, DEFAULT_IMPORT_FILTER.doc_types);
  assert.ok(!missing.allowed_hosts.includes("oereblex.llv.li"));
});

// ── Zone ─────────────────────────────────────────────────────────────────────

function theme(themeCode: string, legendText: string, over: Partial<OerebTheme> = {}): OerebTheme {
  return {
    themeCode, themeName: themeCode, subTheme: null, concern: "affects", legalStatus: "inForce", areaPct: 100,
    areaM2: null, typeCode: "VA-1", legendText, lawLinks: [], authority: null, raw: {}, ...over,
  };
}

function extractWith(themes: OerebTheme[]): OerebExtract {
  return { canton: "FL", egrid: "LI10440010050", identDn: null, parcelNumber: "100", municipality: "Vaduz", bfsNumber: 7001, themes, raw: {} };
}

test("Zone FL: Grundnutzung zählt, Overlay und Rm nie", () => {
  const adapter = new RuleBasedOerebAdapter("FL", BASE);
  const only = adapter.extractZone(extractWith([
    theme("fl.NutzungsplanungOverlay", "Wohnzone W3", { areaPct: 100 }),
    theme("fl.NutzungsplanungRm", "Kernzone K", { areaPct: 100 }),
  ]));
  assert.deepEqual([only.zone, only.confidence], [null, "none"]);
  const mixed = adapter.extractZone(extractWith([
    theme("fl.NutzungsplanungOverlay", "Kernzone K", { areaPct: 100 }),
    theme("fl.Nutzungsplanung", "Wohnzone W2", { areaPct: 60 }),
  ]));
  assert.deepEqual([mixed.zone, mixed.confidence], ["W2", "exact"]);
  const ch = new RuleBasedOerebAdapter("SG", BASE).extractZone(extractWith([theme("fl.Nutzungsplanung", "Wohnzone W2")]));
  assert.equal(ch.confidence, "none", "fl.* zählt nur für FL");
});

// ── Migration ────────────────────────────────────────────────────────────────

test("Migration FL: Trigger-Liste mit FL, Filterzeile gestoppt, CHECK auf country, kein DROP", () => {
  const raw = readFileSync(new URL("../../../supabase/migrations/20261112000001_oereb_fl.sql", import.meta.url), "utf8");
  const sql = raw.replace(/^\s*--.*$/gm, "");
  assert.match(sql, /SET lock_timeout/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.protect_project_identity\(\)/);
  assert.match(sql, /SET search_path = ''/);
  assert.match(sql, /'ZG','ZH','FL'/);
  assert.ok(!/CREATE TRIGGER/.test(sql), "Trigger bleibt bestehen");
  assert.match(sql, /INSERT INTO (public\.)?oereb_import_filters[\s\S]*'FL'[\s\S]*"doc_types":\s*\[\][\s\S]*ON CONFLICT \(scope\) DO NOTHING/);
  assert.match(sql, /"allowed_hosts_add":\s*\["oereblex\.llv\.li"\]/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS country text/);
  assert.match(sql, /CHECK \(country IS NULL OR country IN \('CH', ?'LI'\)\)/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
  assert.ok(!/\bDROP\b/i.test(sql), "kein DROP ausserhalb der Kommentare");
  assert.ok(!/\bTRUNCATE\b|\bDELETE\b/i.test(sql));
});
