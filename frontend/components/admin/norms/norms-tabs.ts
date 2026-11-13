export type NormsTab = "quellen" | "bibliothek" | "organisationen" | "oereb";

export interface NormsTabDef {
  id: NormsTab;
  label: string;
  hint: string;
  hash: string;
}

export const NORMS_TABS: NormsTabDef[] = [
  { id: "bibliothek", label: "Bibliothek", hint: "Plattformweite Normen für alle Organisationen", hash: "#bibliothek" },
  { id: "quellen", label: "Rechtsquellen", hint: "Aktualität von Bundes- und Kantonsnormen", hash: "#norm-watch" },
  { id: "organisationen", label: "Organisationen", hint: "Von Organisationen hochgeladene Normen", hash: "#organisationen" },
  { id: "oereb", label: "ÖREB-Zuordnung", hint: "Kataster-Themen mit Normen verknüpfen", hash: "#oereb" },
];

const HASH_TO_TAB: Record<string, NormsTab> = {
  "#norm-watch": "quellen",
  "#quellen": "quellen",
  "#bibliothek": "bibliothek",
  "#organisationen": "organisationen",
  "#oereb": "oereb",
};

export const DEFAULT_TAB: NormsTab = "bibliothek";

export function tabFromHash(hash: string): NormsTab {
  return HASH_TO_TAB[hash.trim().toLowerCase()] ?? DEFAULT_TAB;
}

export function hashForTab(tab: NormsTab): string {
  return NORMS_TABS.find((t) => t.id === tab)?.hash ?? "";
}

export function nextTab(current: NormsTab, direction: 1 | -1): NormsTab {
  const index = NORMS_TABS.findIndex((t) => t.id === current);
  const next = (index + direction + NORMS_TABS.length) % NORMS_TABS.length;
  return NORMS_TABS[next].id;
}
