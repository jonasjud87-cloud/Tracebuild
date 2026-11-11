/**
 * ÖREB-Adapter Fürstentum Liechtenstein (FL).
 *
 * Webservice (pyramid_oereb, extract-2.0), live geprüft 11.11.2026:
 *   https://oereb.llv.li/oereb_service, nur «de», Gemeinden 7001–7011, EGRID «LI» + 11 Ziffern.
 *   Kein Treffer → HTTP 204 (auch für CH-Koordinaten und CH-EGRIDs).
 *
 * geo.admin.ch kennt FL-Parzellen (Suche mit Koordinate), aber ohne EGRID. Deshalb nie
 * resolveParcel: Ohne Koordinate wird die Parzelle gesucht und die EGRID über GetEGRID (EN) geholt.
 */
import type { GeoSearchHit, ParcelCandidate } from "../../geoadmin/contract";
import { GeoAdminError } from "../../geoadmin/client";
import { normalizeName, normalizeParcel, transliterate } from "../../geoadmin/parcel";
import { searchLocations } from "../../geoadmin/search";
import { isFlMunicipalityCode } from "../cantons";
import { OerebUnreachableError } from "../errors";
import type { EgridResolution } from "../types";
import type { GetEgridInput, ServiceSource } from "./generic";
import { RuleBasedOerebAdapter } from "./rule-based";

/** Höchstens so viele Suchtreffer über GetEGRID nachschlagen (je ein Request an den FL-Dienst). */
const MAX_HITS = 5;

export type FlParcelSearch = (text: string, opts: { origins?: string; limit?: number; signal?: AbortSignal }) => Promise<GeoSearchHit[]>;

/** Treffer derselben Nummer in FL; mit BFS genau diese Gemeinde, sonst über den angezeigten Namen. */
export function flParcelHits(hits: GeoSearchHit[], input: { parcelNumber: string; municipality?: string; bfsNumber?: number }): GeoSearchHit[] {
  const wanted = normalizeParcel(input.parcelNumber);
  const name = normalizeName(input.municipality ?? "");
  const out = new Map<string, GeoSearchHit>();
  for (const hit of hits) {
    if (hit.kind !== "parcel" || !hit.number || normalizeParcel(hit.number) !== wanted) continue;
    if (!isFlMunicipalityCode(hit.bfs)) continue;
    if (input.bfsNumber !== undefined) {
      if (hit.bfs !== input.bfsNumber) continue;
    } else if (name && normalizeName(hit.municipality ?? "") !== name) {
      continue;
    }
    const key = `${hit.bfs}|${normalizeParcel(hit.number)}|${hit.e}|${hit.n}`;
    if (!out.has(key)) out.set(key, hit);
  }
  return Array.from(out.values());
}

export class FlOerebAdapter extends RuleBasedOerebAdapter {
  private readonly search: FlParcelSearch;

  constructor(service?: ServiceSource, search?: FlParcelSearch) {
    super("FL", service);
    this.search = search ?? searchLocations;
  }

  async resolveEgrid(input: GetEgridInput): Promise<EgridResolution> {
    if (input.en) return super.resolveEgrid(input);

    const number = input.parcelNumber.trim();
    const place = input.municipality.trim();
    const bfs = input.bfsNumber;
    if (!number || (!place && bfs === undefined)) return { egrids: [], candidates: [] };

    let hits: GeoSearchHit[];
    try {
      const text = place ? `${transliterate(place)} ${number}` : `${bfs} ${number}`;
      hits = flParcelHits(await this.search(text, { origins: "parcel", limit: 20, signal: input.signal }), {
        parcelNumber: number,
        municipality: place,
        bfsNumber: bfs,
      });
    } catch (e) {
      if (e instanceof GeoAdminError) throw new OerebUnreachableError(`Parzellensuche geo.admin.ch nicht verfügbar: ${e.message}`);
      throw e;
    }

    const wanted = normalizeParcel(number);
    const byEgrid = new Map<string, ParcelCandidate>();
    for (const hit of hits.slice(0, MAX_HITS)) {
      const found = await super.resolveEgrid({ ...input, bfsNumber: hit.bfs ?? bfs, en: [hit.e, hit.n] });
      for (const c of found.candidates) {
        // Der Punkt der Suche kann auf dem Nachbargrundstück liegen: Nummer muss passen.
        if (!c.number || normalizeParcel(c.number) !== wanted || byEgrid.has(c.egrid)) continue;
        byEgrid.set(c.egrid, { ...c, municipality: place || hit.municipality, bfs: hit.bfs ?? bfs ?? null });
      }
    }
    const candidates = Array.from(byEgrid.values());
    return { egrids: candidates.map((c) => c.egrid), candidates };
  }
}
