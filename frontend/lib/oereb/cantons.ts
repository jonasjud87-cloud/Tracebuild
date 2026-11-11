/**
 * Client-sichere Liste der Kantone mit ÖREB-Anbindung: alle 26 und das Fürstentum Liechtenstein (FL).
 *
 * Bewusst getrennt von registry.ts: die Registry zieht die Adapter (und damit
 * process.env) mit — das gehört nicht in ein Client-Bundle.
 */
export const OEREB_SUPPORTED_CANTONS: readonly string[] = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE",
  "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH", "FL",
];

export function isOerebSupportedCanton(canton: string | null | undefined): boolean {
  return OEREB_SUPPORTED_CANTONS.includes((canton ?? "").trim().toUpperCase());
}

/** Gemeindenummern Liechtensteins 7001–7011 (capabilities des FL-Dienstes, live 11.11.2026; Vaduz = 7001). */
export const FL_MUNICIPALITY_CODES: readonly number[] = [7001, 7002, 7003, 7004, 7005, 7006, 7007, 7008, 7009, 7010, 7011];

export function isFlMunicipalityCode(bfs: number | null | undefined): boolean {
  return typeof bfs === "number" && FL_MUNICIPALITY_CODES.includes(bfs);
}

export type ProjectCountry = "CH" | "LI";

/** Land eines Standorts: FL → LI, alles andere (auch leer) → CH. */
export function countryForCanton(canton: string | null | undefined): ProjectCountry {
  return (canton ?? "").trim().toUpperCase() === "FL" ? "LI" : "CH";
}

/** Ortsbezeichnung für Texte: «Kanton ZH» bzw. «Fürstentum Liechtenstein». Leer → "". */
export function cantonLabel(canton: string | null | undefined): string {
  const code = (canton ?? "").trim().toUpperCase();
  if (!code) return "";
  return code === "FL" ? "Fürstentum Liechtenstein" : `Kanton ${code}`;
}
