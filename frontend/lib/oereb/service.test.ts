/** Dienst-Auflösung, HTTP-Verhalten und GetEGRID-Formen. Nur Mocks, keine Live-Dienste. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { OerebParseError, OerebUnreachableError, GenericOerebAdapter, parseEgridResponse } from "./adapters/generic";
import { OerebAccessRestrictedError, OerebBaseGoneError, OerebNoCadastreError } from "./errors";
import { oerebRequest } from "./http";
import { isSupported } from "./registry";
import {
  deriveBaseCandidates,
  parseAuthHeader,
  pickLanguage,
  resetOerebServiceCache,
  resolveOerebService,
  type OerebServiceStore,
} from "./service";
import { oerebPdfUrl } from "./service-quirks";
import { isExtractStale } from "./stale";

const original = globalThis.fetch;
let calls: { url: string; headers: Record<string, string> }[] = [];

function mockFetch(handler: (url: string, call: number) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return handler(String(url), calls.length);
  }) as typeof fetch;
}

const noStore: OerebServiceStore = { load: async () => null, save: async () => undefined };

beforeEach(() => resetOerebServiceCache());
afterEach(() => {
  globalThis.fetch = original;
  delete process.env.OEREB_BASE_URL_ZH;
  delete process.env.OEREB_NE_AUTH_HEADER;
});

// ── Basis-URL ────────────────────────────────────────────────────────────────

test("Basis-URL ableiten: ZG, JU, GL, SH, Slash", () => {
  assert.deepEqual(
    deriveBaseCandidates({
      oereb_extract_pdf: "https://oereb.zg.ch/ors/extract/pdf/?EGRID=CH727473066563",
      oereb_webservice: "https://oereb.zg.ch/oereb/extract/xml?EGRID=CH790674706564&GEOMETRY=true",
    }),
    ["https://oereb.zg.ch/ors", "https://oereb.zg.ch/oereb"]
  );
  assert.deepEqual(
    deriveBaseCandidates({
      oereb_extract_pdf: "https://geo.jura.ch/crdppf_server/extract/pdf?EGRID=CH834477063375",
      oereb_webservice: "https://geo.jura.ch/crdppf",
    }),
    ["https://geo.jura.ch/crdppf_server", "https://geo.jura.ch/crdppf"]
  );
  assert.deepEqual(
    deriveBaseCandidates({
      oereb_extract_pdf: "https://map.geo.gl.ch/oereb/extract/pdf/?EGRID=CH532277695971",
      oereb_webservice: "https://map.geo.gl.ch/oereb/wsgi/oereb",
    }),
    ["https://map.geo.gl.ch/oereb", "https://map.geo.gl.ch/oereb/wsgi/oereb"]
  );
  assert.deepEqual(
    deriveBaseCandidates({
      oereb_extract_pdf: "https://oereb.geo.sh.ch/extract/pdf/?EGRID=CH445408781787",
      oereb_webservice: "https://oereb.geo.sh.ch/oereb",
    }),
    ["https://oereb.geo.sh.ch", "https://oereb.geo.sh.ch/oereb"]
  );
  assert.deepEqual(deriveBaseCandidates({ oereb_webservice: "https://map.geo.tg.ch/services/oereb/" }), [
    "https://map.geo.tg.ch/services/oereb",
  ]);
});

test("Reihenfolge: Env vor Override vor bekannter Basis; XML nur für SO, SH", async () => {
  mockFetch(() => new Response(JSON.stringify({ language: ["de"] }), { status: 200 }));
  const store: OerebServiceStore = {
    load: async (canton) =>
      canton === "BE"
        ? { base_url_override: "https://override.example/oereb/", base_url: null, language: null, format: null, verified_at: null }
        : null,
    save: async () => undefined,
  };
  process.env.OEREB_BASE_URL_ZH = "https://env.example/oereb/";
  assert.deepEqual(
    { ...(await resolveOerebService("ZH", { store })), authHeader: undefined },
    { baseUrl: "https://env.example/oereb", language: "de", format: "json", authHeader: undefined, source: "env" }
  );
  assert.equal((await resolveOerebService("BE", { store })).source, "override");
  const lu = await resolveOerebService("LU", { store });
  assert.equal(lu.baseUrl, "https://svc.geo.lu.ch/oereb");
  assert.equal(lu.source, "known");
  assert.equal((await resolveOerebService("SO", { store })).format, "xml");
});

test("Cache: geprüfte Basis nur bis 7 Tage, sonst bekannte Basis", async () => {
  mockFetch(() => new Response("{}", { status: 200 }));
  const row = (days: number) => ({
    base_url_override: null, base_url: "https://verified.example", language: "de", format: "json",
    verified_at: new Date(Date.now() - days * 86_400_000).toISOString(),
  });
  const fresh = await resolveOerebService("AG", { store: { load: async () => row(1), save: async () => undefined } });
  assert.equal(fresh.baseUrl, "https://verified.example");
  resetOerebServiceCache();
  const old = await resolveOerebService("AG", { store: { load: async () => row(8), save: async () => undefined } });
  assert.equal(old.baseUrl, "https://api.geo.ag.ch/v2/oereb");
});

test("Kein Dienst auffindbar: no_cadastre", async () => {
  await assert.rejects(resolveOerebService("XX", { store: noStore }), OerebNoCadastreError);
});

test("Bekannte Basis fällt mit 404 aus: Neuermittlung über den Layer, Ergebnis geprüft", async () => {
  const stand = {
    results: [{ attributes: {
      egris_egrid: "CH000000000001",
      oereb_extract_pdf: "https://neu.example/oereb/extract/pdf/?EGRID=CH000000000001",
    } }],
  };
  mockFetch((url) => {
    if (url.includes("api3.geo.admin.ch")) return new Response(JSON.stringify(stand), { status: 200 });
    if (url.includes("neu.example/oereb/versions/json")) {
      return new Response(JSON.stringify({ GetVersionsResponse: { supportedVersion: [{ version: "extract-2.0" }] } }), { status: 200 });
    }
    if (url.includes("neu.example/oereb/extract/json")) {
      return new Response(JSON.stringify({ RealEstate: { EGRID: "CH000000000001", Canton: "BL" }, NotConcernedTheme: [{ Code: "ch.Waldgrenzen" }] }), { status: 200 });
    }
    return new Response("nicht da", { status: 404 });
  });
  const adapter = new GenericOerebAdapter("BL", async () => ({
    baseUrl: "https://alt.example/oereb", language: "de", format: "json", source: "known",
  }));
  const ex = await adapter.getExtract("CH000000000001");
  assert.equal(ex.egrid, "CH000000000001");
  assert.ok(calls.some((c) => c.url.startsWith("https://neu.example/oereb/extract/json/")));
});

// ── Sprache ──────────────────────────────────────────────────────────────────

test("Sprachwahl: de falls angeboten, sonst die erste; UR-Form mit Präfixen", () => {
  assert.equal(pickLanguage({ language: ["fr", "de"] }), "de");
  assert.equal(pickLanguage({ GetCapabilitiesResponse: { language: ["it"] } }), "it");
  assert.equal(pickLanguage({ "extract:GetCapabilitiesResponse": { "extract:language": "de" } }), "de");
  assert.equal(pickLanguage({ GetCapabilitiesResponse: { language: ["rm", "it"] } }), "rm");
  assert.equal(pickLanguage({ topic: [] }), null);
});

test("Sprache: GE, VD, JU, NE, TI ohne Abruf; sonst Capabilities; Ausfall ergibt de ohne Cache", async () => {
  mockFetch(() => new Response("kaputt", { status: 500 }));
  assert.equal((await resolveOerebService("GE", { store: noStore })).language, "fr");
  assert.equal((await resolveOerebService("TI", { store: noStore })).language, "it");
  assert.equal(calls.length, 0);

  assert.equal((await resolveOerebService("AG", { store: noStore })).language, "de");
  const failed = calls.length;
  assert.ok(failed > 0);

  mockFetch(() => new Response(JSON.stringify({ language: ["fr"] }), { status: 200 }));
  assert.equal((await resolveOerebService("AG", { store: noStore })).language, "fr");
  assert.equal(calls.length, 1, "Ausfall wurde nicht gecacht");
  await resolveOerebService("AG", { store: noStore });
  assert.equal(calls.length, 1, "Erfolg ist gecacht");
});

// ── HTTP ─────────────────────────────────────────────────────────────────────

const req = { what: "Test", canton: "ZH" };
const URL_ = "https://dienst.example/x";

test("Retry: 500, dann Erfolg", async () => {
  mockFetch((_, n) => (n === 1 ? new Response("", { status: 500 }) : new Response("{}", { status: 200 })));
  const r = await oerebRequest(URL_, req);
  assert.equal(r.kind, "ok");
  assert.equal(calls.length, 2);
});

test("Retry: 429 mit Retry-After 0, dann Erfolg", async () => {
  mockFetch((_, n) =>
    n === 1 ? new Response("", { status: 429, headers: { "retry-after": "0" } }) : new Response("{}", { status: 200 })
  );
  assert.equal((await oerebRequest(URL_, req)).kind, "ok");
});

test("Retry: 429 mit zu langem Retry-After wird nicht abgewartet", async () => {
  mockFetch(() => new Response("", { status: 429, headers: { "retry-after": "60" } }));
  await assert.rejects(oerebRequest(URL_, req), OerebUnreachableError);
  assert.equal(calls.length, 1);
});

test("Retry: ECONNRESET wird wiederholt, höchstens zweimal", async () => {
  mockFetch(() => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  });
  await assert.rejects(oerebRequest(URL_, req), (e: Error) => {
    assert.ok(e instanceof OerebUnreachableError);
    assert.ok(!(e instanceof OerebBaseGoneError), "kein Grund, die Basis zu ersetzen");
    return true;
  });
  assert.equal(calls.length, 3);
});

test("Retry: 204 zweimal ergibt «kein Treffer», 204 dann 200 ergibt Daten", async () => {
  mockFetch(() => new Response(null, { status: 204 }));
  assert.equal((await oerebRequest(URL_, req)).kind, "empty");
  assert.equal(calls.length, 2);

  mockFetch((_, n) => (n === 1 ? new Response(null, { status: 204 }) : new Response("{}", { status: 200 })));
  assert.equal((await oerebRequest(URL_, req)).kind, "ok");
});

test("BS: nach Ausschöpfung die verständliche Meldung", async () => {
  mockFetch(() => new Response("", { status: 500 }));
  await assert.rejects(
    oerebRequest(URL_, { what: "Test", canton: "BS" }),
    /ÖREB-Dienst Basel-Stadt antwortet zurzeit instabil/
  );
  assert.equal(calls.length, 3);
});

test("Redirect: 303 und 307 folgen, Auth nur an den gleichen Host", async () => {
  mockFetch((url) => {
    if (url === URL_) return new Response(null, { status: 303, headers: { location: "/y" } });
    if (url === "https://dienst.example/y") return new Response(null, { status: 307, headers: { location: "https://anders.example/z" } });
    return new Response("{}", { status: 200 });
  });
  const r = await oerebRequest(URL_, { ...req, authHeader: { name: "X-Key", value: "geheim" } });
  assert.equal(r.kind, "ok");
  assert.equal(calls[0].headers["X-Key"], "geheim");
  assert.equal(calls[1].headers["X-Key"], "geheim");
  assert.equal(calls[2].headers["X-Key"], undefined);
});

test("403 ohne Auth: access_restricted mit NE-Text; mit Auth: unreachable ohne Wert", async () => {
  mockFetch(() => new Response("<html>JSON Extract permissions</html>", { status: 403 }));
  await assert.rejects(
    oerebRequest(URL_, { what: "Test", canton: "NE" }),
    (e: Error) => e instanceof OerebAccessRestrictedError && e.message === "ÖREB-Daten von NE nur für registrierte Nutzer, siehe PDF-Auszug"
  );
  await assert.rejects(
    oerebRequest(URL_, { what: "Test", canton: "NE", authHeader: { name: "X-Key", value: "geheim" } }),
    (e: Error) => e instanceof OerebUnreachableError && !e.message.includes("geheim")
  );
});

test("HTML und WAF-Seite: parse_error; 406/415: Formatwechsel; 404: Basis weg", async () => {
  mockFetch(() => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
  await assert.rejects(oerebRequest(URL_, req), OerebParseError);

  mockFetch(() => new Response("<html>Request Rejected. Support ID: 1</html>", { status: 500, headers: { "content-type": "text/html" } }));
  await assert.rejects(oerebRequest(URL_, req), OerebParseError);

  mockFetch(() => new Response("", { status: 415 }));
  assert.deepEqual(await oerebRequest(URL_, req), { kind: "format_rejected", status: 415 });

  mockFetch(() => new Response("", { status: 404 }));
  await assert.rejects(oerebRequest(URL_, req), OerebBaseGoneError);
});

test("Budget: Abbruch von aussen ergibt unreachable", async () => {
  const controller = new AbortController();
  controller.abort();
  mockFetch(() => {
    throw new DOMException("aborted", "AbortError");
  });
  await assert.rejects(oerebRequest(URL_, { ...req, signal: controller.signal }), /Zeitbudget/);
});

test("Auth-Header: Format und Ablehnung", () => {
  assert.deepEqual(parseAuthHeader("Authorization: Bearer abc:def"), { name: "Authorization", value: "Bearer abc:def" });
  assert.equal(parseAuthHeader("ohne Doppelpunkt"), undefined);
  assert.equal(parseAuthHeader(undefined), undefined);
});

// ── GetEGRID-Formen ──────────────────────────────────────────────────────────

test("GetEGRID: Item (FR, GE, VD)", () => {
  const fr = parseEgridResponse({ Item: [{ egrid: "CH468810949824", number: "17460", identDN: "FR219611", type: { Code: "RealEstate" } }] });
  assert.deepEqual(fr, [{ egrid: "CH468810949824", number: "17460", identDn: "FR219611", typeCode: "RealEstate" }]);
  const ge = parseEgridResponse({ Item: [
    { egrid: "CH716335658801", number: "7304", identDN: "21", type: { Code: 0 } },
    { egrid: "CH468965636120", number: "6882", identDN: "21", type: { Code: 0 } },
  ] });
  assert.equal(ge.length, 2);
  assert.equal(ge[0].typeCode, "RealEstate");
});

test("GetEGRID: OrderedItems (LU)", () => {
  const lu = parseEgridResponse({
    OrderedItems: [{ Value: "CH468850358944" }, { Value: "7" }, { Value: "LU04GBPER111" }, { Code: "RealEstate", Text: [] }],
  });
  assert.deepEqual(lu, [{ egrid: "CH468850358944", number: "7", identDn: "LU04GBPER111", typeCode: "RealEstate" }]);
});

test("GetEGRID: XML-Form flach, auch mit parallelen Listen (SO, SH)", () => {
  const one = parseEgridResponse({ GetEGRIDResponse: { egrid: "CH886532067944", number: "1618", identDN: "SO0200002601", type: { Code: "RealEstate" } } });
  assert.deepEqual(one, [{ egrid: "CH886532067944", number: "1618", identDn: "SO0200002601", typeCode: "RealEstate" }]);
  const two = parseEgridResponse({ GetEGRIDResponse: {
    egrid: ["CH000000000001", "CH000000000002"], number: ["1", "2"], identDN: ["A", "B"], type: [{ Code: "RealEstate" }, { Code: "RealEstate" }],
  } });
  assert.deepEqual(two.map((c) => c.number), ["1", "2"]);
});

// ── Registry, PDF-Link, Stale ────────────────────────────────────────────────

test("Registry: alle Kantone, ungültige nicht", () => {
  for (const c of ["ZH", "ne", " ti "]) assert.equal(isSupported(c), true, c);
  for (const c of ["XX", "", null, undefined]) assert.equal(isSupported(c), false, String(c));
});

test("PDF-Link: ZG aus bekannter Basis, NE mit LANG=fr", () => {
  assert.equal(oerebPdfUrl("ZG", "CH727473066563"), "https://oereb.zg.ch/oereb/extract/pdf/?EGRID=CH727473066563&LANG=de");
  assert.equal(oerebPdfUrl("NE", "CH767849875205"), "https://sitn.ne.ch/crdppf/extract/pdf/?EGRID=CH767849875205&LANG=fr");
  assert.equal(oerebPdfUrl("ZG", null), null);
});

test("Stale: EGRID entscheidet, sonst Kanton und normalisierte Nummer", () => {
  const loc = { canton: "BS" };
  assert.equal(isExtractStale(null, { location: loc }), false);
  assert.equal(isExtractStale({ egrid: "CH1", canton: "BS", parcel_number: "1" }, { egrid: "CH1", parcel_number: "9", location: loc }), false);
  assert.equal(isExtractStale({ egrid: "CH1", canton: "BS" }, { egrid: "CH2", location: loc }), true);
  assert.equal(isExtractStale({ canton: "BS", parcel_number: "0121" }, { parcel_number: "121", location: loc }), false);
  assert.equal(isExtractStale({ canton: "BS", parcel_number: "121" }, { parcel_number: "122", location: loc }), true);
  assert.equal(isExtractStale({ canton: "ZH", parcel_number: "121" }, { parcel_number: "121", location: loc }), true);
});
