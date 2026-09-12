/**
 * Typ-Vertrag der ÖREB-Integration. Alle Module unter lib/oereb halten sich exakt
 * an diese Typen — Änderungen hier sind Schnittstellenänderungen.
 */

export type Concern = "affects" | "not_affects" | "no_data";
export type LegalStatus = "inForce" | "changeWithPreEffect" | "changeWithoutPreEffect" | "unknown";
export type ExtractStatus = "ok" | "no_egrid" | "ambiguous" | "unreachable" | "parse_error";

export interface OerebLawLink { title: string; url: string | null }
export interface OerebTheme {
  themeCode: string;            // z.B. "ch.Grundwasserschutzzonen"
  themeName: string;            // deutscher Anzeigename
  subTheme: string | null;
  concern: Concern;
  legalStatus: LegalStatus;
  areaPct: number | null;
  areaM2: number | null;
  typeCode: string | null;      // z.B. Zonencode "1402" bei Nutzungsplanung
  legendText: string | null;    // z.B. "Wohnzone W2"
  lawLinks: OerebLawLink[];
  authority: { name: string | null; url: string | null } | null;
  raw: unknown;
}
export interface OerebExtract {
  canton: string; egrid: string; identDn: string | null; parcelNumber: string | null;
  municipality: string | null;
  themes: OerebTheme[];
  raw: unknown;
}
export interface ZoneResult { zone: string | null; confidence: "exact" | "coarse" | "none"; source: string }
export interface OerebAdapter {
  canton: string;
  getEgrid(input: { municipality: string; parcelNumber: string; bfsNumber?: number; en?: [number, number] }): Promise<string[]>;
  getExtract(egrid: string): Promise<OerebExtract>;
  extractZone(extract: OerebExtract): ZoneResult;
}
