/**
 * Client-sichere Liste der Kantone mit ÖREB-Anbindung.
 *
 * Bewusst getrennt von registry.ts: die Registry zieht die Adapter (und damit
 * process.env) mit — das gehört nicht in ein Client-Bundle. Wird ein Adapter
 * ergänzt, muss der Kanton hier ebenfalls eingetragen werden.
 */
export const OEREB_SUPPORTED_CANTONS: readonly string[] = ["SG"];

export function isOerebSupportedCanton(canton: string | null | undefined): boolean {
  return OEREB_SUPPORTED_CANTONS.includes((canton ?? "").trim().toUpperCase());
}
