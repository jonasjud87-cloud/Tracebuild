/** Geodaten: Antwortformen aus einer Live-Stichprobe vom 5.11.2026 (gekürzt). fetch ist eine Attrappe. */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { resetGeoAdminBucket } from "./client";
import { fetchGeodata, parseGwr, parseHeight, parseIsos, parseOevClass, EMPTY_GEODATA } from "./geodata";
import { buildLinks } from "./links";
import { lookupParcel } from "./parcel";
import { parseProjectLocation, parseParcelIdentity } from "./validate";

const GWR_ROW = {
  egid: "3169567", strname_deinr: "Limmatquai 55", plz_plz6: "8001/800100", egrid: "CH479177919943", gstat: 1004,
  gklas: 1220, gbauj: 1698, gbaup: 8011, garea: 596, gastw: 4, ganzwhg: 1, gebf: 1628, whgnr: ["301"], wbez: [null],
};

test("GWR: bestehende Gebäude, keine Adress- oder Wohnungsfelder", () => {
  const out = parseGwr({
    results: [
      { attributes: GWR_ROW },
      { attributes: { ...GWR_ROW } },
      { attributes: { ...GWR_ROW, egid: "2", gstat: 1007 } },
      { attributes: { ...GWR_ROW, egid: "3", gbauj: null, gbaup: 8014, gastw: null } },
    ],
  });
  assert.deepEqual(out, [
    { egid: "3169567", year: 1698, period: "vor 1919", floors: 4, dwellings: 1, area_m2: 596, class_code: 1220 },
    { egid: "3", year: null, period: "1961-1970", floors: null, dwellings: 1, area_m2: 596, class_code: 1220 },
  ]);
  assert.doesNotMatch(JSON.stringify(out), /Limmatquai|whgnr|8001/);
});

test("GWR: höchstens 20 Gebäude, Unsinn ergibt leer", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ attributes: { egid: i + 1, gstat: 1004 } }));
  assert.equal(parseGwr({ results: many }).length, 20);
  assert.deepEqual(parseGwr(null), []);
  assert.deepEqual(parseGwr({ results: "x" }), []);
});

test("ISOS: nach Nummer dedupliziert", () => {
  const row = { attributes: { nummer: 4562, name: "Zürich", siedlungskategorie: "Stadt", url: "https://example.ch" } };
  assert.deepEqual(parseIsos({ results: [row, row] }), [{ number: 4562, name: "Zürich", category: "Stadt", url: "https://example.ch" }]);
  assert.deepEqual(parseIsos({ results: [] }), []);
});

test("ÖV-Güteklasse und Höhe", () => {
  assert.equal(parseOevClass({ results: [{ attributes: { klasse_de: "A - sehr gute Erschliessung", klasse_fr: "A" } }] }), "A - sehr gute Erschliessung");
  assert.equal(parseOevClass({ results: [{ attributes: { klasse_fr: "B - bonne desserte" } }] }), "B - bonne desserte");
  assert.equal(parseOevClass({ results: [] }), null);
  assert.equal(parseHeight({ height: "409.2" }), 409.2);
  assert.equal(parseHeight({}), null);
});

test("Links: PDF aus bekannter Basis, ZG nicht aus dem Layer, NE auf Französisch", () => {
  const zg = buildLinks({ canton: "ZG", egrid: "CH1", e: 1, n: 2, extractPdf: "https://oereb.zg.ch/ors" });
  assert.equal(zg.oereb_pdf, "https://oereb.zg.ch/oereb/extract/pdf/?EGRID=CH1&LANG=de");
  assert.match(buildLinks({ canton: "NE", egrid: "CH1", e: 1, n: 2 }).oereb_pdf as string, /LANG=fr$/);
  assert.match(zg.geoportal as string, /#\/map\?.*center=1,2.*crosshair=marker,1,2/);
  assert.equal(buildLinks({ canton: "ZH", egrid: null, e: null, n: null }).geoportal, null);
});

// ── Abruf ────────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
let urls: string[] = [];
let failing: RegExp | null = null;

beforeEach(() => {
  urls = [];
  failing = null;
  resetGeoAdminBucket();
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    if (failing?.test(url)) return new Response("x", { status: 404 });
    if (url.includes("/height")) return Response.json({ height: "409.2" });
    if (url.includes("SearchServer")) {
      return Response.json({ results: [{ attrs: { origin: "parcel", x: 1247329, y: 2683392, label: "Zürich AA1 (CH 1)", detail: "aa1 zurich 261 ch479177919943" } }] });
    }
    if (url.includes("gueteklassen")) return Response.json({ results: [{ attributes: { klasse_de: "A" } }] });
    if (url.includes("schuetzenswerte")) return Response.json({ results: [] });
    if (url.includes("gebaeude_wohnungs")) return Response.json({ results: [{ attributes: GWR_ROW }] });
    if (url.includes("stand-oerebkataster")) {
      return Response.json({ results: [{ attributes: { egris_egrid: "CH479177919943", url_oereb: "https://maps.zh.ch", oereb_extract_pdf: "https://x" } }] });
    }
    throw new Error(`unerwartet: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const input = { canton: "ZH", egrid: "CH479177919943", e: 2683393, n: 1247329 };

test("Normalfall: ok, höchstens 5 Requests, nacheinander, Links", async () => {
  const r = await fetchGeodata(input);
  assert.equal(r.status, "ok");
  assert.equal(urls.length, 5);
  assert.equal(r.data.height_m, 409.2);
  assert.equal(r.data.oev_class, "A");
  assert.equal(r.data.buildings.length, 1);
  assert.equal(r.links.canton_portal, "https://maps.zh.ch");
  assert.equal(r.links.oereb_pdf, "https://maps.zh.ch/oereb/v2/extract/pdf/?EGRID=CH479177919943&LANG=de");
});

test("Geodaten nie über den Parzellen-find, wenn Koordinaten da sind", async () => {
  await fetchGeodata(input);
  assert.equal(urls.some((u) => u.includes("find") && u.includes("stand-oerebkataster")), false);
});

test("Teilausfall: partial, alter Wert des Teils bleibt", async () => {
  failing = /gueteklassen/;
  const previous = { data: { ...EMPTY_GEODATA, oev_class: "B alt", height_m: 1 }, links: { geoportal: null, canton_portal: "alt", oereb_pdf: null } };
  const r = await fetchGeodata({ ...input, previous });
  assert.equal(r.status, "partial");
  assert.equal(r.data.oev_class, "B alt");
  assert.equal(r.data.height_m, 409.2);
  assert.deepEqual(r.errors.map((e) => e.source), ["ARE"]);
});

test("Alles fällt aus: unavailable, wirft nicht, alter Stand bleibt", async () => {
  failing = /./;
  const previous = { data: { ...EMPTY_GEODATA, height_m: 5 }, links: { geoportal: null, canton_portal: "alt", oereb_pdf: null } };
  const r = await fetchGeodata({ ...input, previous });
  assert.equal(r.status, "unavailable");
  assert.equal(r.anySuccess, false);
  assert.equal(r.data.height_m, 5);
  assert.equal(r.links.canton_portal, "alt");
});

test("Ohne Koordinaten und ohne EGRID: no_location, kein Request", async () => {
  const r = await fetchGeodata({ canton: "ZH", egrid: null, e: null, n: null });
  assert.equal(r.status, "no_location");
  assert.equal(urls.length, 0);
});

test("Ohne Koordinaten mit EGRID: über die Suche, weiter höchstens 5 Requests", async () => {
  const r = await fetchGeodata({ ...input, e: null, n: null });
  assert.equal(r.status, "ok");
  assert.equal(r.e, 2683392);
  assert.equal(r.n, 1247329);
  assert.equal(urls.length, 5);
});

test("Budget erschöpft: Teile werden gemeldet, keine weiteren Requests", async () => {
  const c = new AbortController();
  c.abort();
  const r = await fetchGeodata({ ...input, signal: c.signal });
  assert.equal(urls.length, 0);
  assert.equal(r.status, "unavailable");
  assert.ok(r.errors.length > 0);
});

test("Parzellenabfrage: Gesamtbudget, danach unavailable statt Warten", async () => {
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Timeout", "TimeoutError")));
    })) as unknown as typeof fetch;
  const started = Date.now();
  const r = await lookupParcel({ egrid: "CH479177919943" }, { budgetMs: 20 });
  assert.deepEqual(r, { candidates: [], unavailable: true });
  assert.ok(Date.now() - started < 2000);
});

// ── Sicherheit: Eingaben aus dem Request (B1) ────────────────────────────────

test("Kanton aus dem Request muss ein echtes Kürzel sein", () => {
  assert.deepEqual(parseProjectLocation({ canton: "zh ", municipality: "Zürich", country: "CH" }), {
    location: { canton: "ZH", municipality: "Zürich", country: "CH" },
  });
  for (const bad of ["EVIL", "X", "evil.ch", 5, {}, []]) assert.ok("error" in parseProjectLocation({ canton: bad }), String(bad));
  for (const bad of [null, "ZH", 5, []]) assert.ok("error" in parseProjectLocation(bad), String(bad));
  assert.ok("location" in parseProjectLocation({ municipality: "Freitext" }));
  assert.ok("location" in parseProjectLocation({ canton: "" }));
});

test("BFS-Nummer vom Client wird nie übernommen, EGRID und Koordinaten geprüft", () => {
  const out = parseParcelIdentity({ egrid: "ch479177919943", lv95_e: 2683393, lv95_n: 1247329, bfs_number: 261 } as never);
  assert.deepEqual(out, { egrid: "CH479177919943", lv95_e: 2683393, lv95_n: 1247329 });
  assert.equal("bfs_number" in out, false);
  assert.deepEqual(parseParcelIdentity({ egrid: "'; drop", lv95_e: 1, lv95_n: 1 }), {});
});
