export type LevelFilter = "all" | "national" | "cantonal" | "municipal";
export type CareFilter = "all" | "watched" | "manual";
export type DigestFilter = "all" | "active" | "todo" | "none";

export interface LibraryNorm {
  id: string;
  title?: string;
  category: string;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
}

export interface LibraryFilter {
  level: LevelFilter;
  canton: string;
  care: CareFilter;
  digest: DigestFilter;
  needle: string;
}

export const EMPTY_LIBRARY_FILTER: LibraryFilter = { level: "all", canton: "", care: "all", digest: "all", needle: "" };

export type DigestState = "ok" | "failed" | "missing" | "outdated";

export function digestMatches(filter: DigestFilter, state: DigestState | undefined): boolean {
  if (filter === "all") return true;
  if (filter === "none") return state === undefined;
  if (filter === "active") return state === "ok";
  return state !== undefined && state !== "ok";
}

export function filterLibrary<T extends LibraryNorm>(
  norms: T[],
  filter: LibraryFilter,
  watchedIds: Set<string>,
  digestStates: Map<string, DigestState>,
): T[] {
  const needle = filter.needle.trim().toLowerCase();
  return norms.filter((n) => {
    if (filter.level !== "all" && n.jurisdiction_type !== filter.level) return false;
    if (filter.level === "cantonal" && filter.canton && n.jurisdiction_name !== filter.canton) return false;
    if (filter.care !== "all" && (filter.care === "watched") !== watchedIds.has(n.id)) return false;
    if (!digestMatches(filter.digest, digestStates.get(n.id))) return false;
    if (!needle) return true;
    return [n.title, n.category, n.jurisdiction_name].some((v) => v?.toLowerCase().includes(needle));
  });
}

export function levelCounts(norms: LibraryNorm[]): Record<LevelFilter, number> {
  const counts: Record<LevelFilter, number> = { all: norms.length, national: 0, cantonal: 0, municipal: 0 };
  norms.forEach((n) => {
    if (n.jurisdiction_type === "national" || n.jurisdiction_type === "cantonal" || n.jurisdiction_type === "municipal") {
      counts[n.jurisdiction_type] += 1;
    }
  });
  return counts;
}

export function cantonsOf(norms: LibraryNorm[]): string[] {
  const set = new Set<string>();
  norms.forEach((n) => {
    if (n.jurisdiction_type === "cantonal" && n.jurisdiction_name) set.add(n.jurisdiction_name);
  });
  return Array.from(set).sort();
}

export interface DigestSummary {
  active: number;
  todo: number;
  total: number;
}

export function summarizeDigests(states: DigestState[]): DigestSummary {
  const active = states.filter((s) => s === "ok").length;
  return { active, todo: states.length - active, total: states.length };
}

export interface GroupTone {
  bar: string;
  sub: string;
  edge: string;
}

export function groupTone(label: string): GroupTone {
  if (label === "Bund") return { bar: "bg-[#151414] text-white", sub: "text-white/80", edge: "border-[#151414]" };
  if (label.startsWith("Kanton")) return { bar: "bg-[#CBBFAE] text-[#151414]", sub: "text-[#3b352c]", edge: "border-[#CBBFAE]" };
  return { bar: "bg-[rgba(21,20,20,.1)] text-[#151414]", sub: "text-[#46464a]", edge: "border-[rgba(21,20,20,.25)]" };
}
