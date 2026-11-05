/**
 * Client-sichere Liste der Kantone mit ÖREB-Anbindung: alle 26.
 *
 * Bewusst getrennt von registry.ts: die Registry zieht die Adapter (und damit
 * process.env) mit — das gehört nicht in ein Client-Bundle.
 */
export const OEREB_SUPPORTED_CANTONS: readonly string[] = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE",
  "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
];

export function isOerebSupportedCanton(canton: string | null | undefined): boolean {
  return OEREB_SUPPORTED_CANTONS.includes((canton ?? "").trim().toUpperCase());
}
