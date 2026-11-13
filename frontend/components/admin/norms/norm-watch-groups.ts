import { CANTON_NAMES, groupByJurisdiction, groupLabel, type Group, type Jurisdictional } from "@/lib/norm-groups";
import type { SourceView } from "@/lib/norm-watch/types";

export { CANTON_NAMES, groupByJurisdiction, groupLabel };
export type { Group, Jurisdictional };

export interface PlatformNorm {
  id: string;
  title: string | null;
  layer: number;
  jurisdiction_type?: string | null;
  jurisdiction_name?: string | null;
}

export interface UnwatchedNorm extends Jurisdictional {
  id: string;
  title: string;
}

export function findUnwatched(norms: PlatformNorm[], sources: SourceView[]): UnwatchedNorm[] {
  const linked = new Set(sources.map((s) => s.normId).filter((id): id is string => !!id));
  return norms
    .filter((n) => (n.layer === 1 || n.layer === 3) && !linked.has(n.id))
    .map((n) => ({
      id: n.id,
      title: n.title ?? n.id,
      jurisdictionType: n.layer === 1 ? "national" : "cantonal",
      jurisdictionName: n.layer === 1 ? null : n.jurisdiction_name ?? null,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "de"));
}

export function supportedProvider(type: string, name: string | null): "fedlex" | "sg" | null {
  if (type === "national") return "fedlex";
  if (type === "cantonal" && name === "SG") return "sg";
  return null;
}

export interface GroupCounts {
  update: number;
  error: number;
  missing: number;
}

export function groupCounts(items: SourceView[]): GroupCounts {
  return {
    update: items.filter((s) => s.status === "update_available").length,
    error: items.filter((s) => s.status === "error").length,
    missing: items.filter((s) => s.status === "missing").length,
  };
}
