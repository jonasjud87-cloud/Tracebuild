/**
 * Parzellenauflösung über api3.geo.admin.ch. Layer ch.swisstopo-vd.stand-oerebkataster führt
 * je Grundstück Gemeinde, BFS, Kanton und die Links des kantonalen Dienstes.
 */
import { oerebPdfUrl } from "../oereb/service-quirks";
import { GeoAdminError, geoAdminGet } from "./client";
import type { GeoParcelResponse, GeoSearchHit, ParcelCandidate } from "./contract";
import { searchLocations } from "./search";

const LAYER = "ch.swisstopo-vd.stand-oerebkataster";
const MAX_FIND = 6;
// find ist ohne Index: live bis 15 s gemessen (identify am selben Ort: 80 bis 200 ms).
const FIND_TIMEOUT_MS = 20_000;
/** Gesamtbudget der Parzellenabfrage, sie wartet im Dialog. */
const LOOKUP_BUDGET_MS = 12_000;

// Der Layer schreibt Kantone ausgeschrieben und teils in der Landessprache.
const CANTON_BY_NAME: Readonly<Record<string, string>> = {
  "zuerich": "ZH", "zurich": "ZH", "bern": "BE", "berne": "BE", "luzern": "LU", "uri": "UR", "schwyz": "SZ",
  "obwalden": "OW", "nidwalden": "NW", "glarus": "GL", "zug": "ZG", "fribourg": "FR", "freiburg": "FR",
  "solothurn": "SO", "basel stadt": "BS", "basel landschaft": "BL", "schaffhausen": "SH",
  "appenzell ausserrhoden": "AR", "appenzell innerrhoden": "AI", "st gallen": "SG", "sankt gallen": "SG",
  "graubuenden": "GR", "grischun": "GR", "grigioni": "GR", "aargau": "AG", "thurgau": "TG", "ticino": "TI",
  "tessin": "TI", "vaud": "VD", "waadt": "VD", "valais": "VS", "wallis": "VS", "neuchatel": "NE",
  "neuenburg": "NE", "geneve": "GE", "genf": "GE", "jura": "JU",
};

/** geo.admin.ch und amtliche Namen sind uneinheitlich: Umlaute umschreiben, Akzente entfernen. */
export function transliterate(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Vergleichsform: "Teufen (AR)", "Teufen AR" → "teufen ar". */
export function normalizeName(s: string): string {
  return transliterate(s).replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeParcel(s: string): string {
  return s.trim().toUpperCase().replace(/^0+(?=\d)/, "");
}

/** Kantonsname des Layers → Kürzel. Unbekannt = null. */
export function cantonFromName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  return CANTON_BY_NAME[normalizeName(name)] ?? null;
}

/** Rohattribute des Layers, wie sie auch die Dienst-Ermittlung braucht. */
export interface StandAttributes {
  egris_egrid?: string | null;
  number?: string | number | null;
  gemeindename?: string | null;
  bfs_nr?: number | string | null;
  kanton?: string | null;
  realestate_type?: string | null;
  oereb_extract_pdf?: string | null;
  oereb_extract_url?: string | null;
  url_oereb?: string | null;
  oereb_webservice?: string | null;
}

/** Zeilen ohne EGRID (Gemeindezeile) verwerfen, nach EGRID deduplizieren. */
export function parseStandResults(json: unknown): StandAttributes[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const byEgrid = new Map<string, StandAttributes>();
  for (const r of results) {
    const attrs = (r as { attributes?: StandAttributes } | null)?.attributes;
    const egrid = attrs?.egris_egrid?.trim().toUpperCase();
    if (attrs && egrid && !byEgrid.has(egrid)) byEgrid.set(egrid, { ...attrs, egris_egrid: egrid });
  }
  return Array.from(byEgrid.values());
}

export function candidateFromAttributes(
  attrs: StandAttributes,
  position?: { e: number | null; n: number | null }
): ParcelCandidate {
  const canton = cantonFromName(attrs.kanton);
  const egrid = (attrs.egris_egrid ?? "").toUpperCase();
  const bfs = Number(attrs.bfs_nr);
  return {
    egrid,
    number: attrs.number === null || attrs.number === undefined ? null : String(attrs.number),
    municipality: attrs.gemeindename ?? null,
    bfs: attrs.bfs_nr !== null && attrs.bfs_nr !== undefined && Number.isFinite(bfs) ? bfs : null,
    canton,
    e: position?.e ?? null,
    n: position?.n ?? null,
    type: attrs.realestate_type ?? null,
    oereb_pdf_url: oerebPdfUrl(canton, egrid) ?? attrs.oereb_extract_pdf ?? null,
  };
}

export async function findByEgrid(egrid: string, opts: { signal?: AbortSignal } = {}): Promise<StandAttributes[]> {
  const json = await geoAdminGet(
    "api/MapServer/find",
    { layer: LAYER, searchField: "egris_egrid", searchText: egrid, returnGeometry: "false", contains: "false" },
    { ...opts, timeoutMs: FIND_TIMEOUT_MS }
  );
  return parseStandResults(json).filter((a) => a.egris_egrid === egrid.toUpperCase());
}

export async function identifyAt(e: number, n: number, opts: { signal?: AbortSignal } = {}): Promise<StandAttributes[]> {
  const json = await geoAdminGet(
    "all/MapServer/identify",
    {
      geometry: `${e},${n}`,
      geometryType: "esriGeometryPoint",
      returnGeometry: "false",
      sr: "2056",
      tolerance: "0",
      layers: `all:${LAYER}`,
    },
    opts
  );
  return parseStandResults(json);
}

/**
 * Layer-Zeile eines Grundstücks. Mit Koordinate zuerst identify, das ist um Grössenordnungen
 * schneller als find; liegt der Punkt ausserhalb des Grundstücks, bleibt find als Rückfall.
 */
export async function standOfEgrid(
  egrid: string,
  position: { e: number; n: number } | null,
  opts: { signal?: AbortSignal } = {}
): Promise<StandAttributes[]> {
  if (position) {
    const rows = await identifyAt(position.e, position.n, opts);
    const match = rows.filter((a) => a.egris_egrid === egrid.toUpperCase());
    if (match.length) return match;
  }
  return findByEgrid(egrid, opts);
}

function preferRealEstate(items: ParcelCandidate[]): ParcelCandidate[] {
  const realEstates = items.filter((c) => c.type === "Liegenschaft");
  return realEstates.length ? realEstates : items;
}

export type ResolveParcelResult =
  | { status: "ok"; candidates: ParcelCandidate[] }
  | { status: "no_egrid"; candidates: ParcelCandidate[] }
  | { status: "ambiguous"; candidates: ParcelCandidate[] }
  | { status: "unavailable"; candidates: ParcelCandidate[]; message: string };

export interface ResolveParcelInput {
  canton: string;
  municipality: string;
  number: string;
  bfs?: number;
  signal?: AbortSignal;
}

/** Treffer mit exakt gleicher Nummer und gültiger EGRID, je EGRID einmal. */
function collectHits(hits: GeoSearchHit[], number: string, into: Map<string, GeoSearchHit>, bfs?: number): void {
  const wanted = normalizeParcel(number);
  for (const hit of hits) {
    if (!hit.egrid || !hit.number || normalizeParcel(hit.number) !== wanted) continue;
    if (bfs !== undefined && hit.bfs !== bfs) continue;
    if (!into.has(hit.egrid)) into.set(hit.egrid, hit);
  }
}

function outcome(candidates: ParcelCandidate[]): ResolveParcelResult {
  const list = preferRealEstate(candidates);
  if (list.length === 0) return { status: "no_egrid", candidates: [] };
  return { status: list.length === 1 ? "ok" : "ambiguous", candidates: list };
}

/**
 * Grundstück aus Gemeinde und Nummer. Der Name wird nie aus `detail` verglichen (dort stehen
 * Sprachformen), sondern aus dem Layer nachgeschlagen. Dieselbe Nummer kann in einer Gemeinde
 * mehrfach vorkommen: Dann `ambiguous` mit Kandidaten, nie still einen wählen.
 */
export async function resolveParcel(input: ResolveParcelInput): Promise<ResolveParcelResult> {
  const canton = input.canton.trim().toUpperCase();
  const number = input.number.trim();
  const name = input.municipality.trim();
  const { signal, bfs } = input;
  const search = (text: string) => searchLocations(text, { origins: "parcel", limit: 20, signal });

  const lookup = async (hits: Map<string, GeoSearchHit>, filterByName: boolean): Promise<ParcelCandidate[]> => {
    const wantedName = normalizeName(name);
    const wantedNames = [wantedName, `${wantedName} ${canton.toLowerCase()}`];
    const out: ParcelCandidate[] = [];
    for (const hit of Array.from(hits.values()).slice(0, MAX_FIND)) {
      for (const attrs of await standOfEgrid(hit.egrid as string, { e: hit.e, n: hit.n }, { signal })) {
        if (filterByName) {
          if (cantonFromName(attrs.kanton) !== canton) continue;
          if (!wantedNames.includes(normalizeName(attrs.gemeindename ?? ""))) continue;
        }
        out.push(candidateFromAttributes(attrs, { e: hit.e, n: hit.n }));
      }
    }
    return out;
  };

  try {
    if (bfs !== undefined) {
      const hits = new Map<string, GeoSearchHit>();
      if (name) collectHits(await search(`${transliterate(name)} ${number}`), number, hits, bfs);
      collectHits(await search(`${bfs} ${number}`), number, hits, bfs);
      if (hits.size === 1) {
        const hit = Array.from(hits.values())[0];
        return {
          status: "ok",
          candidates: [{
            egrid: hit.egrid as string, number: hit.number, municipality: name || null, bfs,
            canton, e: hit.e, n: hit.n, type: null, oereb_pdf_url: oerebPdfUrl(canton, hit.egrid),
          }],
        };
      }
      return outcome(await lookup(hits, false));
    }

    if (!name) return { status: "no_egrid", candidates: [] };
    const hits = new Map<string, GeoSearchHit>();
    collectHits(await search(`${transliterate(name)} ${number}`), number, hits);
    let found = await lookup(hits, true);
    // Gleichnamige Gemeinden anderer Kantone können den Treffer aus der Liste verdrängen.
    if (!found.length && !normalizeName(name).endsWith(` ${canton.toLowerCase()}`)) {
      const second = new Map<string, GeoSearchHit>();
      collectHits(await search(`${transliterate(name)} ${canton.toLowerCase()} ${number}`), number, second);
      for (const egrid of Array.from(hits.keys())) second.delete(egrid);
      found = await lookup(second, true);
    }
    return outcome(found);
  } catch (e) {
    if (e instanceof GeoAdminError) return { status: "unavailable", candidates: [], message: e.message };
    throw e;
  }
}

/** Für die Route: EGRID und/oder Koordinate → Kandidaten; Ausfall → unavailable. */
export async function lookupParcel(
  query: { egrid?: string; e?: number; n?: number },
  { budgetMs = LOOKUP_BUDGET_MS }: { budgetMs?: number } = {}
): Promise<GeoParcelResponse> {
  const signal = AbortSignal.timeout(budgetMs);
  try {
    const position = query.e !== undefined && query.n !== undefined ? { e: query.e, n: query.n } : null;
    let rows: StandAttributes[] = [];
    if (query.egrid) rows = await standOfEgrid(query.egrid, position, { signal });
    else if (position) rows = await identifyAt(position.e, position.n, { signal });
    const candidates = rows.map((attrs) => candidateFromAttributes(attrs, position ?? undefined));
    return { candidates: preferRealEstate(candidates), unavailable: false };
  } catch (e) {
    if (e instanceof GeoAdminError) return { candidates: [], unavailable: true };
    throw e;
  }
}
