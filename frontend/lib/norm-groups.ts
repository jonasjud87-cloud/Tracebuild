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
  if (type === "municipal") return name ? `Gemeinde ${name}` : "Gemeinde";
  if (type === "org") return "Unternehmen";
  return name ?? "Weitere";
}

function rank(type: string): number {
  if (type === "national") return 0;
  if (type === "cantonal") return 1;
  if (type === "municipal") return 2;
  if (type === "org") return 3;
  return 4;
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
