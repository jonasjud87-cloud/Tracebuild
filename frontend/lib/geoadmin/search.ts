/**
 * Adress- und Parzellensuche über den SearchServer von swisstopo. Achtung: attrs.x ist
 * Nord, attrs.y ist Ost. `detail` führt je Datensatz andere Sprachformen («saint-gall»,
 * «zurigo»): Gemeindenamen daraus nie vergleichen.
 */
import { isFlMunicipalityCode } from "../oereb/cantons";
import { GeoAdminError, geoAdminGet } from "./client";
import type { GeoSearchHit, GeoSearchResponse } from "./contract";
import { isValidEgrid } from "./validate";

function cleanLabel(label: string): string {
  return label.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Liechtenstein: detail = "<nummer> <name> <bfs>" ohne EGRID (live 11.11.2026). Nur mit FL-Gemeindenummer;
 * die EGRID liefert erst der ÖREB-Dienst FL.
 */
function parseFlParcelHit(id: string, label: string, tokens: string[], e: number, n: number): GeoSearchHit | null {
  const last = tokens[tokens.length - 1];
  const bfs = Number(last);
  if (tokens.length < 3 || !/^\d{4}$/.test(last) || !isFlMunicipalityCode(bfs)) return null;
  // label = "<Gemeinde> <Nummer>", evtl. mit Klammerzusatz: nur zur Anzeige.
  const nameMatch = /^(.*?)\s+\S+$/.exec(label.replace(/\s*\([^)]*\)\s*$/, ""));
  return {
    id,
    kind: "parcel",
    label,
    e,
    n,
    egrid: null,
    number: tokens[0].toUpperCase(),
    municipality: nameMatch ? nameMatch[1] : null,
    bfs,
    canton: "FL",
  };
}

/** Parzelle: detail = "<nummer> <name> <bfs> <egrid>". */
function parseParcelHit(id: string, label: string, detail: string, e: number, n: number): GeoSearchHit | null {
  const tokens = detail.trim().split(/\s+/);
  const fl = parseFlParcelHit(id, label, tokens, e, n);
  if (fl) return fl;
  if (tokens.length < 4) return null;
  const egrid = tokens[tokens.length - 1].toUpperCase();
  const bfs = Number(tokens[tokens.length - 2]);
  // label = "<Gemeinde> <Nummer> (CH 1234 …)": Sprachform der Suche, nur zur Anzeige.
  const nameMatch = /^(.*?)\s+\S+\s+\(CH[\s\d]+\)$/.exec(label);
  return {
    id,
    kind: "parcel",
    label,
    e,
    n,
    egrid: isValidEgrid(egrid) ? egrid : null,
    number: tokens[0].toUpperCase(),
    municipality: nameMatch ? nameMatch[1] : null,
    bfs: Number.isInteger(bfs) ? bfs : null,
    canton: null,
  };
}

/**
 * Adresse: detail endet auf "<bfs> <gemeinde> ch <kt>", keine EGRID. Liechtenstein ohne Kürzel
 * ("… 7002 triesen ch"): FL nur mit FL-Gemeindenummer.
 */
function addressTail(detail: string): { bfs: number; canton: string } | null {
  const ch = /\s(\d{1,4})\s+[^\d]+?\s+ch\s+([a-z]{2})\s*$/.exec(detail);
  if (ch) return { bfs: Number(ch[1]), canton: ch[2].toUpperCase() };
  const fl = /\s(\d{4})\s+[^\d]+?\s+ch\s*$/.exec(detail);
  return fl && isFlMunicipalityCode(Number(fl[1])) ? { bfs: Number(fl[1]), canton: "FL" } : null;
}

function parseAddressHit(id: string, label: string, detail: string, e: number, n: number): GeoSearchHit {
  const tail = addressTail(detail.trim());
  // label = "Limmatquai 55 8001 Zürich": Ort nach der Postleitzahl.
  const place = /\b\d{4}\s+(.+)$/.exec(label);
  return {
    id,
    kind: "address",
    label,
    e,
    n,
    egrid: null,
    number: null,
    municipality: place ? place[1] : null,
    bfs: tail ? tail.bfs : null,
    canton: tail ? tail.canton : null,
  };
}

export function parseSearchResponse(json: unknown): GeoSearchHit[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const hits: GeoSearchHit[] = [];
  for (const r of results) {
    const attrs = (r as { attrs?: Record<string, unknown> } | null)?.attrs;
    if (!attrs) continue;
    const n = num(attrs.x);
    const e = num(attrs.y);
    if (e === null || n === null) continue;
    const detail = typeof attrs.detail === "string" ? attrs.detail : "";
    const label = cleanLabel(typeof attrs.label === "string" ? attrs.label : "");
    const id = String((r as { id?: unknown }).id ?? `${e},${n}`);
    if (attrs.origin === "parcel") {
      const hit = parseParcelHit(id, label, detail, e, n);
      if (hit) hits.push(hit);
    } else if (attrs.origin === "address") {
      hits.push(parseAddressHit(id, label, detail, e, n));
    }
  }
  return hits;
}

export async function searchLocations(
  text: string,
  opts: { origins?: string; limit?: number; lang?: string; signal?: AbortSignal } = {}
): Promise<GeoSearchHit[]> {
  const json = await geoAdminGet(
    "api/SearchServer",
    {
      searchText: text,
      origins: opts.origins ?? "address,parcel",
      type: "locations",
      limit: String(opts.limit ?? 10),
      sr: "2056",
      lang: opts.lang ?? "de",
    },
    { signal: opts.signal }
  );
  return parseSearchResponse(json);
}

/** Für die Route: fängt Ausfälle ab, die UI fällt dann auf Freitext zurück. */
export async function searchGeo(q: string, lang?: string): Promise<GeoSearchResponse> {
  try {
    return { results: await searchLocations(q, { lang }), unavailable: false };
  } catch (e) {
    if (e instanceof GeoAdminError) return { results: [], unavailable: true };
    throw e;
  }
}
