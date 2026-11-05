/**
 * Zusatzdaten des Bundes zu einer Parzelle: GWR, ISOS, ÖV-Güteklasse, Höhe. Requests nacheinander,
 * höchstens 5 je Abruf. Fällt ein Teil aus, bleibt sein alter Wert stehen und der Status wird
 * `partial`. Keine Adress- oder Wohnungsfelder aus dem GWR. Ohne Rechtswirkung, ÖREB geht vor.
 */
import { geoAdminGet } from "./client";
import type { GeodataResponse } from "./contract";
import { buildLinks } from "./links";
import { findByEgrid, identifyAt, type StandAttributes } from "./parcel";
import { searchLocations } from "./search";

export const GEODATA_SOURCES = ["swisstopo", "BFS GWR", "BAK ISOS", "ARE"];

const MAX_REQUESTS = 5;
const MAX_BUILDINGS = 20;
const GSTAT_EXISTING = 1004;

const GWR_LAYER = "ch.bfs.gebaeude_wohnungs_register";
const ISOS_LAYER = "ch.bak.bundesinventar-schuetzenswerte-ortsbilder";
const OEV_LAYER = "ch.are.gueteklassen_oev";

/** GBAUP-Codes des GWR. `gbauj` ist oft leer, die Periode meist nicht. */
const BUILDING_PERIODS: Readonly<Record<number, string>> = {
  8011: "vor 1919", 8012: "1919-1945", 8013: "1946-1960", 8014: "1961-1970", 8015: "1971-1980", 8016: "1981-1985",
  8017: "1986-1990", 8018: "1991-1995", 8019: "1996-2000", 8020: "2001-2005", 8021: "2006-2010", 8022: "2011-2015",
  8023: "ab 2016",
};

export type GeodataContent = GeodataResponse["data"];

export const EMPTY_GEODATA: GeodataContent = { height_m: null, oev_class: null, isos: [], buildings: [] };

// ── Antworten lesen (rein) ───────────────────────────────────────────────────

function attributesOf(json: unknown): Record<string, unknown>[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => (r as { attributes?: Record<string, unknown> } | null)?.attributes)
    .filter((a): a is Record<string, unknown> => !!a);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Nur bestehende Gebäude (gstat 1004), je EGID einmal, höchstens 20. */
export function parseGwr(json: unknown): GeodataContent["buildings"] {
  const out = new Map<string, GeodataContent["buildings"][number]>();
  for (const a of attributesOf(json)) {
    const egid = a.egid === null || a.egid === undefined ? "" : String(a.egid);
    if (!egid || num(a.gstat) !== GSTAT_EXISTING || out.has(egid)) continue;
    const period = num(a.gbaup);
    out.set(egid, {
      egid,
      year: num(a.gbauj),
      period: period !== null ? (BUILDING_PERIODS[period] ?? null) : null,
      floors: num(a.gastw),
      dwellings: num(a.ganzwhg),
      area_m2: num(a.garea),
      class_code: num(a.gklas),
    });
    if (out.size >= MAX_BUILDINGS) break;
  }
  return Array.from(out.values());
}

export function parseIsos(json: unknown): GeodataContent["isos"] {
  const out = new Map<number, GeodataContent["isos"][number]>();
  for (const a of attributesOf(json)) {
    const number = num(a.nummer);
    const name = text(a.name);
    if (number === null || !name || out.has(number)) continue;
    out.set(number, { number, name, category: text(a.siedlungskategorie), url: text(a.url) });
  }
  return Array.from(out.values());
}

export function parseOevClass(json: unknown): string | null {
  for (const a of attributesOf(json)) {
    const value = text(a.klasse_de) ?? text(a.klasse_fr);
    if (value) return value;
  }
  return null;
}

export function parseHeight(json: unknown): number | null {
  return num((json as { height?: unknown } | null)?.height);
}

// ── Abruf ────────────────────────────────────────────────────────────────────

export interface GeodataInput {
  canton: string | null;
  egrid: string | null;
  e: number | null;
  n: number | null;
  signal?: AbortSignal;
  previous?: {
    data: GeodataContent;
    links: GeodataResponse["links"];
  } | null;
}

export interface GeodataFetchResult {
  status: "ok" | "partial" | "unavailable" | "no_location";
  data: GeodataContent;
  links: GeodataResponse["links"];
  errors: GeodataResponse["errors"];
  /** Über die EGRID nachgeschlagene Koordinate. */
  e: number | null;
  n: number | null;
  /** Mindestens ein Teil kam frisch an. */
  anySuccess: boolean;
}

function identifyLayer(layer: string, e: number, n: number, signal?: AbortSignal): Promise<unknown> {
  return geoAdminGet(
    "all/MapServer/identify",
    {
      geometry: `${e},${n}`,
      geometryType: "esriGeometryPoint",
      returnGeometry: "false",
      sr: "2056",
      tolerance: "0",
      layers: `all:${layer}`,
    },
    { signal }
  );
}

export async function fetchGeodata(input: GeodataInput): Promise<GeodataFetchResult> {
  const { canton, egrid, signal } = input;
  let { e, n } = input;
  const previousData = input.previous?.data ?? EMPTY_GEODATA;

  if ((e === null || n === null) && !egrid) {
    return {
      status: "no_location",
      data: previousData,
      links: buildLinks({ canton, egrid, e: null, n: null }),
      errors: [],
      e: null,
      n: null,
      anySuccess: false,
    };
  }

  const data: GeodataContent = { ...previousData };
  const errors: GeodataResponse["errors"] = [];
  let requests = 0;
  let successes = 0;

  /** Ein Teil scheitert allein. Über dem Budget oder der Obergrenze: nicht mehr anfragen. */
  const part = async (source: string, run: () => Promise<void>): Promise<void> => {
    if (requests >= MAX_REQUESTS) return;
    if (signal?.aborted) {
      errors.push({ source, message: "Zeitbudget ausgeschöpft" });
      return;
    }
    requests++;
    try {
      await run();
      successes++;
    } catch (err) {
      errors.push({ source, message: err instanceof Error ? err.message : String(err) });
    }
  };

  let lookedUp = false;
  if ((e === null || n === null) && egrid) {
    lookedUp = true;
    await part("swisstopo", async () => {
      const hits = await searchLocations(egrid, { origins: "parcel", limit: 5, signal });
      const hit = hits.find((h) => h.egrid === egrid);
      if (hit) {
        e = hit.e;
        n = hit.n;
      }
    });
  }

  const hasPosition = e !== null && n !== null;
  let stand: StandAttributes | null = null;

  if (hasPosition) {
    await part("swisstopo", async () => {
      const json = await geoAdminGet("height", { easting: String(e), northing: String(n), sr: "2056" }, { signal });
      data.height_m = parseHeight(json);
    });
    // Der Layer dient nur noch dem Kantonsportal-Link: Mit nachgeschlagener Koordinate entfällt
    // er (Obergrenze 5). Kein find als Rückfall, das dauert live bis 15 s.
    if (!lookedUp) {
      await part("swisstopo", async () => {
        const rows = await identifyAt(e as number, n as number, { signal });
        stand = rows.find((r) => r.egris_egrid === egrid) ?? rows[0] ?? null;
      });
    }
    await part("ARE", async () => {
      data.oev_class = parseOevClass(await identifyLayer(OEV_LAYER, e as number, n as number, signal));
    });
    await part("BAK ISOS", async () => {
      data.isos = parseIsos(await identifyLayer(ISOS_LAYER, e as number, n as number, signal));
    });
  } else if (egrid) {
    await part("swisstopo", async () => {
      stand = (await findByEgrid(egrid, { signal }))[0] ?? null;
    });
  }

  if (egrid) {
    await part("BFS GWR", async () => {
      data.buildings = parseGwr(
        await geoAdminGet(
          "api/MapServer/find",
          { layer: GWR_LAYER, searchField: "egrid", searchText: egrid, returnGeometry: "false", contains: "false" },
          { signal }
        )
      );
    });
  }

  const standRow = stand as StandAttributes | null;
  const built = buildLinks({
    canton,
    egrid,
    e,
    n,
    urlOereb: standRow?.url_oereb ?? input.previous?.links.canton_portal ?? null,
    extractPdf: standRow?.oereb_extract_pdf ?? null,
  });

  // Ohne Koordinate fehlen Höhe, ÖV und ISOS: höchstens teilweise.
  const status = successes === 0 ? "unavailable" : errors.length === 0 && hasPosition ? "ok" : "partial";

  return { status, data, links: built, errors, e, n, anySuccess: successes > 0 };
}

// ── Für den Prüfer ───────────────────────────────────────────────────────────

/** Kurzform für den Referenzrahmen der Analyse. */
export interface GeodataFacts {
  status: string;
  fetchedAt: string | null;
  data: GeodataContent;
  failedSources: string[];
}
