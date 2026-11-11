/** LI-EGRIDs: keine langsamen Leerabfragen (find, Suche, GWR) bei geo.admin.ch. Netz gestubbt. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { resetGeoAdminBucket } from "../geoadmin/client";
import { fetchGeodata } from "../geoadmin/geodata";
import { rediscoverOerebService, resetOerebServiceCache, type OerebServiceStore } from "./service";

const original = globalThis.fetch;
let urls: string[] = [];
const noStore: OerebServiceStore = { load: async () => null, save: async () => undefined };

beforeEach(() => {
  resetGeoAdminBucket();
  resetOerebServiceCache();
  urls = [];
  globalThis.fetch = (async (url: string | URL) => {
    urls.push(String(url));
    return Response.json({ results: [] });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

const failed = { baseUrl: "https://oereb.llv.li/oereb_service", language: "de", format: "json" as const, source: "known" as const };

test("Neuermittlung des Dienstes: LI-EGRID ohne find beim Layer", async () => {
  assert.equal(await rediscoverOerebService("FL", failed, { egrid: "LI10440010050", store: noStore }), null);
  assert.deepEqual(urls, []);
});

test("Neuermittlung des Dienstes: CH-EGRID fragt den Layer weiterhin", async () => {
  await rediscoverOerebService("ZH", failed, { egrid: "CH479177919943", store: noStore });
  assert.ok(urls.some((u) => u.includes("MapServer/find") && u.includes("CH479177919943")));
});

test("Geodaten FL mit Koordinate: Höhe, ÖV, ISOS, identify, aber kein find und kein GWR", async () => {
  await fetchGeodata({ canton: "FL", egrid: "LI10440010050", e: 2757446, n: 1224141 });
  assert.ok(urls.length > 0);
  assert.ok(!urls.some((u) => u.includes("MapServer/find")), urls.join("\n"));
  assert.ok(!urls.some((u) => u.includes("gebaeude_wohnungs")));
});

test("Geodaten FL ohne Koordinate: keine Suche nach der LI-EGRID, kein find", async () => {
  await fetchGeodata({ canton: "FL", egrid: "LI10440010050", e: null, n: null });
  assert.deepEqual(urls, []);
});

test("Geodaten CH ohne Koordinate: Suche und GWR wie bisher", async () => {
  await fetchGeodata({ canton: "ZH", egrid: "CH479177919943", e: null, n: null });
  assert.ok(urls.some((u) => u.includes("SearchServer")));
  assert.ok(urls.some((u) => u.includes("gebaeude_wohnungs")));
});
