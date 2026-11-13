import { hashForTab as hashFor, tabFromHash as fromHash, type TabDef } from "@/lib/admin-tabs";

export type OerebTab = "uebersicht" | "dokumente" | "regeln" | "zuordnung";

export const OEREB_TABS: TabDef<OerebTab>[] = [
  { id: "uebersicht", label: "Übersicht", hint: "Ablauf und Stand je Kanton", hash: "#uebersicht" },
  { id: "dokumente", label: "Dokumente", hint: "Importierte und abgelehnte Reglemente je Gemeinde", hash: "#dokumente" },
  { id: "regeln", label: "Filterregeln", hint: "Welche Dokumente als Reglement gelten", hash: "#filterregeln" },
  { id: "zuordnung", label: "Themen-Zuordnung", hint: "ÖREB-Themen mit Normen verknüpfen", hash: "#zuordnung" },
];

export const DEFAULT_OEREB_TAB: OerebTab = "uebersicht";

export function oerebTabFromHash(hash: string): OerebTab {
  return fromHash(OEREB_TABS, hash, DEFAULT_OEREB_TAB, { "#regeln": "regeln" });
}

export function oerebHashForTab(tab: OerebTab): string {
  return hashFor(OEREB_TABS, tab);
}
