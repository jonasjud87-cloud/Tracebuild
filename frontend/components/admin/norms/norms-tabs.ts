import { hashForTab as hashFor, nextTab as nextOf, tabFromHash as fromHash, type TabDef } from "@/lib/admin-tabs";

export type NormsTab = "quellen" | "bibliothek" | "organisationen";

export type NormsTabDef = TabDef<NormsTab>;

export const NORMS_TABS: NormsTabDef[] = [
  { id: "bibliothek", label: "Bibliothek", hint: "Plattformweite Normen für alle Organisationen", hash: "#bibliothek" },
  { id: "quellen", label: "Rechtsquellen", hint: "Aktualität von Bundes- und Kantonsnormen", hash: "#norm-watch" },
  { id: "organisationen", label: "Organisationen", hint: "Von Organisationen hochgeladene Normen", hash: "#organisationen" },
];

const ALIASES: Record<string, NormsTab> = { "#quellen": "quellen" };

export const DEFAULT_TAB: NormsTab = "bibliothek";

export const OEREB_ZUORDNUNG_PATH = "/admin/oereb-imports#zuordnung";

export function isLegacyOerebHash(hash: string): boolean {
  return hash.trim().toLowerCase() === "#oereb";
}

export function tabFromHash(hash: string): NormsTab {
  return fromHash(NORMS_TABS, hash, DEFAULT_TAB, ALIASES);
}

export function hashForTab(tab: NormsTab): string {
  return hashFor(NORMS_TABS, tab);
}

export function nextTab(current: NormsTab, direction: 1 | -1): NormsTab {
  return nextOf(NORMS_TABS, current, direction);
}
