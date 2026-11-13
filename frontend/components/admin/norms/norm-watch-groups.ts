import type { SourceView } from "@/lib/norm-watch/types";

export interface PlatformNorm {
  id: string;
  title: string | null;
  layer: number;
  jurisdiction_type?: string | null;
  jurisdiction_name?: string | null;
}

export interface Jurisdictional {
  jurisdictionType: string;
  jurisdictionName: string | null;
}

export interface Group<T> {
  key: string;
  label: string;
  items: T[];
}

export const CANTON_NAMES: Record<string, string> = {
  AG: "Aargau",
  AI: "Appenzell Innerrhoden",
  AR: "Appenzell Ausserrhoden",
  BE: "Bern",
  BL: "Basel-Landschaft",
  BS: "Basel-Stadt",
  FR: "Freiburg",
  GE: "Genf",
  GL: "Glarus",
  GR: "Graubünden",
  JU: "Jura",
  LU: "Luzern",
  NE: "Neuenburg",
  NW: "Nidwalden",
  OW: "Obwalden",
  SG: "St. Gallen",
  SH: "Schaffhausen",
  SO: "Solothurn",
  SZ: "Schwyz",
  TG: "Thurgau",
  TI: "Tessin",
  UR: "Uri",
  VD: "Waadt",
  VS: "Wallis",
  ZG: "Zug",
  ZH: "Zürich",
  FL: "Liechtenstein",
};

export function groupLabel(type: string, name: string | null): string {
  if (type === "national") return "Bund";
  if (type === "cantonal") {
    const code = (name ?? "").trim();
    if (!code) return "Kanton";
    return CANTON_NAMES[code] ? `Kanton ${CANTON_NAMES[code]} (${code})` : `Kanton ${code}`;
  }
  return name ?? "Weitere";
}

function rank(type: string): number {
  return type === "national" ? 0 : type === "cantonal" ? 1 : 2;
}

export function groupByJurisdiction<T extends Jurisdictional>(items: T[]): Group<T>[] {
  const groups = new Map<string, Group<T> & { type: string }>();
  for (const item of items) {
    const key = `${item.jurisdictionType}:${item.jurisdictionName ?? ""}`;
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, type: item.jurisdictionType, label: groupLabel(item.jurisdictionType, item.jurisdictionName), items: [item] });
  }
  return Array.from(groups.values())
    .sort((a, b) => rank(a.type) - rank(b.type) || a.label.localeCompare(b.label, "de"))
    .map(({ key, label, items: list }) => ({ key, label, items: list }));
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
