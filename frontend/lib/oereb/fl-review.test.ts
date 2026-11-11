/**
 * Liechtenstein: Formate wörtlich aus Live-Abrufen (11.11.2026, api3.geo.admin.ch und oereb.llv.li),
 * Negativfälle und Regressionen CH. Netz immer gestubbt, kein Modellaufruf.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resetGeoAdminBucket } from "../geoadmin/client";
import { lookupParcel } from "../geoadmin/parcel";
import { parseSearchResponse } from "../geoadmin/search";
import { FlOerebAdapter } from "./adapters/fl";
import { lookupFlParcel } from "./fl-parcel";
import { DEFAULT_IMPORT_FILTER, isHostAllowed, resolveFilterRules } from "./import-filter";
import { applies, normsForThemeMapping, uploadCountry, type ApplicableNorm } from "../norm-applies";

const original = globalThis.fetch;
beforeEach(() => resetGeoAdminBucket());
afterEach(() => {
  globalThis.fetch = original;
});

// ── SearchServer, wörtlich (Abstände in label/detail wie geliefert) ─────────────

const PAD = " ".repeat(45);
const LIVE_SEARCH = {
  results: [
    { id: 1, attrs: { origin: "parcel", label: `<b>Vaduz${PAD}</b> 100 ()`, detail: `100 vaduz${PAD}7001`, x: 1224140.875, y: 2757446.75 } },
    { id: 2, attrs: { origin: "parcel", label: `<b>Vaduz${PAD}</b> 1001 ()`, detail: `1001 vaduz${PAD}7001`, x: 1227088.875, y: 2758220 } },
    { id: 3, attrs: { origin: "address", label: "Städtle 1 <b>9490 Vaduz</b>", detail: "staedtle 1 9490 vaduz 7001 vaduz ch", x: 1223230.5, y: 2757965.75 } },
    { id: 4, attrs: { origin: "address", label: "Landstrasse 1 <b>9497 Triesenberg</b>", detail: "landstrasse 1 9497 triesenberg 7004 triesenberg ch", x: 1220713.625, y: 2759729 } },
    { id: 5, attrs: { origin: "address", label: "Bahnhofstrasse 10 <b>9470 Buchs SG</b>", detail: "bahnhofstrasse 10 9470 buchs sg 3271 buchs _sg_ ch sg", x: 1226011.625, y: 2754556.25 } },
    { id: 6, attrs: { origin: "gazetteer", label: "<i>Quartierteil</i> <b>Städtle</b> () - Vaduz", detail: "staedtle vaduz", x: 1223093.625, y: 2758122.25 } },
  ],
};

test("Suche live: FL-Parzelle mit Polsterung und «()» → Vaduz/100/7001 ohne EGRID", () => {
  const hits = parseSearchResponse(LIVE_SEARCH);
  assert.equal(hits.length, 5, "gazetteer bleibt draussen");
  assert.deepEqual(hits[0], {
    id: "1", kind: "parcel", label: "Vaduz 100 ()", e: 2757446.75, n: 1224140.875,
    egrid: null, number: "100", municipality: "Vaduz", bfs: 7001, canton: "FL",
  });
  assert.equal(hits[1].number, "1001");
});

test("Suche live: FL-Adressen ohne Kürzel → FL; Buchs SG mit «_sg_» bleibt SG", () => {
  const [, , vaduz, triesenberg, buchs] = parseSearchResponse(LIVE_SEARCH);
  assert.deepEqual([vaduz.kind, vaduz.canton, vaduz.bfs, vaduz.municipality], ["address", "FL", 7001, "Vaduz"]);
  assert.deepEqual([triesenberg.canton, triesenberg.bfs, triesenberg.municipality], ["FL", 7004, "Triesenberg"]);
  assert.deepEqual([buchs.canton, buchs.bfs, buchs.municipality], ["SG", 3271, "Buchs SG"]);
});

test("Suche negativ: Adresse mit 70xx-Nummer ausserhalb FL-Liste und Parzelle mit 7012 bleiben ohne FL", () => {
  const hits = parseSearchResponse({
    results: [
      { id: 1, attrs: { origin: "address", label: "X 1 9999 Y", detail: "x 1 9999 y 7012 y ch", x: 1224000, y: 2757000 } },
      { id: 2, attrs: { origin: "parcel", label: "Y 5", detail: "5 y 7012", x: 1224000, y: 2757000 } },
    ],
  });
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].canton, hits[0].bfs], [null, null]);
});

// ── identify, wörtlich gekürzt ──────────────────────────────────────────────

const FL_ATTR = {
  fid: "12574", gemeindename: "Vaduz", kanton: "Fürstentum Liechtenstein", bfs_nr: 7001,
  url_oereb: "http://oereb.llv.li/", oereb_webservice: null, egris_egrid: null, oereb_extract_pdf: null, realestate_type: null, label: "Vaduz",
};
const LIVE_IDENTIFY_FL = {
  results: [
    { layerBodId: "ch.swisstopo-vd.stand-oerebkataster", featureId: 4401726, attributes: { ...FL_ATTR, number: null } },
    { layerBodId: "ch.swisstopo-vd.stand-oerebkataster", featureId: 943, attributes: FL_ATTR },
  ],
};
const LIVE_IDENTIFY_BUCHS = {
  results: [
    {
      layerBodId: "ch.swisstopo-vd.stand-oerebkataster", featureId: 2152599,
      attributes: {
        fid: "3271", number: "3146", gemeindename: "Buchs (SG)", kanton: "St. Gallen", bfs_nr: 3271,
        oereb_webservice: "https://oereb.geo.sg.ch/ktsg/wsgi/oereb", egris_egrid: "CH350084773820", realestate_type: "Liegenschaft", label: "Buchs (SG)",
      },
    },
    { layerBodId: "ch.swisstopo-vd.stand-oerebkataster", featureId: 161, attributes: { fid: "3271", gemeindename: "Buchs (SG)", kanton: "St. Gallen", bfs_nr: 3271 } },
  ],
};

function stubFetch(byHost: (url: string) => { status: number; body?: unknown }) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    urls.push(u);
    const r = byHost(u);
    return r.body === undefined
      ? new Response(null, { status: r.status })
      : new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return urls;
}

const LIVE_GETEGRID_VADUZ = {
  GetEGRIDResponse: [{ egrid: "LI10440010050", number: "100", identDN: "FL0200000044", type: { Code: "RealEstate", Text: [{ Language: "de", Text: "Liegenschaft" }] } }],
};

test("Ende-zu-Ende Parzelle: FL-Koordinate → identify (Gemeindezeile) → GetEGRID FL → ein Kandidat", async () => {
  const urls = stubFetch((u) => {
    if (u.includes("geo.admin.ch")) return { status: 200, body: LIVE_IDENTIFY_FL };
    if (u.includes("/getegrid/json/?EN=2757446.75,1224140.875")) return { status: 200, body: LIVE_GETEGRID_VADUZ };
    return { status: 204 };
  });
  const r = await lookupParcel(
    { e: 2757446.75, n: 1224140.875 },
    { fallback: (e, n, place, signal) => lookupFlParcel(e, n, place, signal, new FlOerebAdapter("https://fl.example/oereb")) }
  );
  assert.equal(r.unavailable, false);
  assert.equal(r.candidates.length, 1);
  const c = r.candidates[0];
  assert.deepEqual([c.egrid, c.number, c.canton, c.bfs, c.municipality], ["LI10440010050", "100", "FL", 7001, "Vaduz"]);
  assert.ok(urls.some((u) => u.startsWith("https://fl.example/oereb/getegrid/json/?EN=")));
});

test("Grenzfall Buchs SG: CH-Zeile mit EGRID, Rückfall FL nie aufgerufen, kein Abruf beim FL-Dienst", async () => {
  const urls = stubFetch((u) => (u.includes("geo.admin.ch") ? { status: 200, body: LIVE_IDENTIFY_BUCHS } : { status: 500 }));
  let called = false;
  const r = await lookupParcel({ e: 2754370, n: 1225970 }, { fallback: async () => { called = true; return []; } });
  assert.equal(called, false);
  assert.deepEqual(r.candidates.map((c) => [c.egrid, c.canton, c.number]), [["CH350084773820", "SG", "3146"]]);
  assert.ok(urls.every((u) => u.includes("geo.admin.ch")));
});

test("lookupParcel negativ: LI-EGRID ohne Koordinate → leer, ohne jeden Abruf (kein langsames find)", async () => {
  const urls = stubFetch(() => ({ status: 500 }));
  let called = false;
  const r = await lookupParcel({ egrid: "LI10440010050" }, { fallback: async () => { called = true; return []; } });
  assert.deepEqual(r, { candidates: [], unavailable: false });
  assert.equal(called, false);
  assert.deepEqual(urls, []);
});

test(
  "lookupParcel: LI-EGRID mit CH-Koordinate liefert keine fremde CH-Parzelle",
  async () => {
    stubFetch((u) => (u.includes("geo.admin.ch") ? { status: 200, body: LIVE_IDENTIFY_BUCHS } : { status: 204 }));
    const r = await lookupParcel({ egrid: "LI10440010050", e: 2754370, n: 1225970 }, { fallback: async () => [] });
    assert.deepEqual(r.candidates, []);
  }
);

test("FlOerebAdapter mit Live-Suchformat: «Vaduz» + «100» → GetEGRID an der Trefferkoordinate, 1001 verworfen", async () => {
  const getegrid: string[] = [];
  stubFetch((u) => {
    if (u.includes("/getegrid/")) getegrid.push(u);
    if (u.includes("EN=2757446.75,1224140.875")) return { status: 200, body: LIVE_GETEGRID_VADUZ };
    return { status: 204 };
  });
  const adapter = new FlOerebAdapter("https://fl.example/oereb", async () => parseSearchResponse(LIVE_SEARCH));
  const r = await adapter.resolveEgrid({ municipality: "Vaduz", parcelNumber: "100" });
  assert.deepEqual(r.egrids, ["LI10440010050"]);
  assert.equal(getegrid.length, 1, "nur der Treffer mit gleicher Nummer");
  // Andere Gemeinde gleicher Nummer: kein Treffer.
  const schaan = await adapter.resolveEgrid({ municipality: "Schaan", parcelNumber: "100" });
  assert.deepEqual(schaan, { egrids: [], candidates: [] });
  // BFS gewinnt über den Namen: CH-BFS führt nie zu einem FL-Treffer.
  const chBfs = await adapter.resolveEgrid({ municipality: "Vaduz", parcelNumber: "100", bfsNumber: 3271 });
  assert.deepEqual(chBfs, { egrids: [], candidates: [] });
});

// ── Importfilter: weitere Negativfälle ─────────────────────────────────────────

test("isHostAllowed negativ: FL nur mit Listeneintrag; Punkt am Ende, leerer Kanton und Teilstring", () => {
  const fl = resolveFilterRules(
    [{ scope: "FL", rules: { doc_types: [], allowed_hosts_add: ["oereblex.llv.li"] } }],
    "FL"
  );
  assert.equal(isHostAllowed("oereblex.llv.li", fl, " fl "), true);
  assert.equal(isHostAllowed("oereblex.llv.li.", fl, "FL"), false);
  assert.equal(isHostAllowed("xoereblex.llv.li", fl, "FL"), false);
  assert.equal(isHostAllowed("llv.li", fl, "FL"), false);
  assert.equal(isHostAllowed("oereblex.llv.li", fl, ""), false);
  assert.equal(isHostAllowed("oereblex.llv.li", fl, "LI"), false, "LI ist kein Standortcode");
  // Ohne FL-Zeile auch über die Standardliste nichts aus .li, auch nicht mit *.li in der FL-Zeile für andere Kantone.
  assert.equal(isHostAllowed("oereblex.llv.li", DEFAULT_IMPORT_FILTER, "FL"), false);
  const star = resolveFilterRules([{ scope: "SG", rules: { allowed_hosts_add: ["*.li", "oereblex.llv.li"] } }], "SG");
  assert.equal(isHostAllowed("oereblex.llv.li", star, "SG"), false);
});

// ── Länderspalte: Ergänzungen ─────────────────────────────────────────────────

const vaduz = { canton: "FL", municipality: "Vaduz", bfs: 7001 };
const mels = { canton: "SG", municipality: "Mels", bfs: 3293 };

test("uploadCountry negativ: Wahl wirkt nur auf Bund; Kanton ohne Name → CH; Kanton klein/mit Leerzeichen", () => {
  assert.equal(uploadCountry("municipal", "Vaduz", "LI"), null);
  assert.equal(uploadCountry("org", null, "LI"), null);
  assert.equal(uploadCountry("cantonal", null, "LI"), "CH");
  assert.equal(uploadCountry("cantonal", " fl "), "LI");
  assert.equal(uploadCountry("national", null, " li "), "LI");
  assert.equal(uploadCountry("national", null, ""), "CH");
});

test("Länderspalte: automatisch importierte CH-Gemeindenorm (country NULL) gilt nicht für FL über BFS", () => {
  const auto: ApplicableNorm = {
    id: "a", layer: 4, jurisdiction_type: "municipal", jurisdiction_name: "Mels", jurisdiction_bfs: 3293,
    jurisdiction_canton: "SG", source_kind: "oereb_auto", auto_scope: "municipal", country: null,
  } as ApplicableNorm;
  assert.equal(applies(auto, mels), true);
  assert.equal(applies(auto, vaduz), false);
  assert.deepEqual(normsForThemeMapping([auto], vaduz), []);
});

test("Länderspalte: Kantonsnorm FL mit falschem Land CH gilt nirgends; CH-Kantonsnorm nie in FL", () => {
  const flCh: ApplicableNorm = { id: "k", layer: 3, jurisdiction_type: "cantonal", jurisdiction_name: "FL", country: "CH" };
  assert.equal(applies(flCh, vaduz), false);
  assert.equal(applies(flCh, mels), false);
  const sg: ApplicableNorm = { id: "s", layer: 3, jurisdiction_type: "cantonal", jurisdiction_name: "SG", country: "CH" };
  assert.equal(applies(sg, mels), true);
  assert.equal(applies(sg, vaduz), false);
});

// ── Prompt: CH unverändert, FL nie Schweizer Recht ─────────────────────────────

process.env.ANTHROPIC_API_KEY ??= "test-ohne-aufruf";

test("Systemprompt: CH ohne Liechtenstein-Text, leerer Kanton wie bisher, FL ohne «Schweizer» in der Rolle", async () => {
  const { buildSystemPrompt } = await import("../analysis-engine");
  const ch = buildSystemPrompt({ municipality: "Buchs SG", canton: "SG", bauzone: "W2" }, "G");
  assert.ok(!ch.includes("Liechtenstein"));
  const empty = buildSystemPrompt({ municipality: "", canton: "", bauzone: "" }, "G");
  assert.match(empty, /- Kanton: unbekannt\n/);
  assert.match(empty, /^Du bist ein Schweizer Baurechtsexperte/);
  const fl = buildSystemPrompt({ municipality: "Vaduz", canton: "fl", bauzone: "W2" }, "G");
  assert.match(fl, /^Du bist ein Baurechtsexperte für Liechtenstein/, "Kürzel klein geschrieben");
  // Nur die Rolle ist getauscht: Rest des Grundtexts gleich.
  assert.equal(fl.replace("Baurechtsexperte für Liechtenstein", "X").split("PROJEKTKONTEXT")[0],
    buildSystemPrompt({ municipality: "Vaduz", canton: "SG", bauzone: "W2" }, "G").replace("Schweizer Baurechtsexperte", "X").split("PROJEKTKONTEXT")[0]);
});

// ── Migration: Trigger 1:1, Backfill einmalig und FL ausgenommen ─────────────

function functionBody(sql: string): string {
  const m = /CREATE OR REPLACE FUNCTION public\.protect_project_identity\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(sql);
  assert.ok(m, "Funktion gefunden");
  return m[1].replace(/\s+/g, " ").trim();
}

test("Migration FL: Funktionsrumpf 1:1 wie 20261106 bis auf 'FL'", () => {
  const read = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), "utf8");
  const before = functionBody(read("20261106000001_geoportal.sql"));
  const after = functionBody(read("20261112000001_oereb_fl.sql"));
  assert.equal(after, before.replace("'ZG','ZH'", "'ZG','ZH','FL'"));
});

test("Migration FL: Backfill nur beim Anlegen der Spalte, FL ausgenommen, nur Bund/Kanton/Gemeinde", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261112000001_oereb_fl.sql", import.meta.url), "utf8")
    .replace(/^\s*--.*$/gm, "");
  const block = /IF NOT EXISTS \(\s*SELECT 1 FROM information_schema\.columns[\s\S]*?column_name = 'country'\s*\) THEN([\s\S]*?)END IF;/.exec(sql);
  assert.ok(block, "Backfill im IF-NOT-EXISTS-Block");
  assert.match(block[1], /ADD COLUMN IF NOT EXISTS country text/);
  assert.match(block[1], /UPDATE public\.norms SET country = 'CH'/);
  assert.match(block[1], /jurisdiction_type IN \('national', 'cantonal', 'municipal'\)/);
  assert.match(block[1], /jurisdiction_name = 'FL'/);
  assert.match(block[1], /jurisdiction_canton, ''\) <> 'FL'/);
  assert.equal((sql.match(/UPDATE public\.norms/g) ?? []).length, 1, "kein zweites UPDATE ausserhalb");
});
