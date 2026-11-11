/**
 * Rückfall der Parzellenabfrage für Liechtenstein: geo.admin.ch führt dort nur die Gemeinde,
 * die EGRID liefert der ÖREB-Dienst FL über GetEGRID (EN). Wird in GET /geo/parcel eingereicht.
 */
import type { ParcelCandidate } from "../geoadmin/contract";
import type { StandTerritory } from "../geoadmin/parcel";
import { FlOerebAdapter } from "./adapters/fl";
import type { OerebAdapter } from "./types";

export async function lookupFlParcel(
  e: number,
  n: number,
  place: StandTerritory,
  signal: AbortSignal,
  adapter: Pick<OerebAdapter, "resolveEgrid"> = new FlOerebAdapter()
): Promise<ParcelCandidate[]> {
  const resolved = await adapter.resolveEgrid({
    municipality: place.municipality ?? "",
    parcelNumber: "",
    bfsNumber: place.bfs ?? undefined,
    en: [e, n],
    signal,
  });
  return resolved.candidates.map((c) => ({
    ...c,
    canton: "FL",
    municipality: c.municipality ?? place.municipality,
    bfs: c.bfs ?? place.bfs,
    e,
    n,
  }));
}
