/**
 * Typ-Vertrag der ÖREB-Integration. Alle Module unter lib/oereb halten sich exakt
 * an diese Typen — Änderungen hier sind Schnittstellenänderungen.
 */
import type { ExtractStatus, ParcelCandidate } from "../geoadmin/contract";

export type { ExtractStatus };

export type Concern = "affects" | "not_affects" | "no_data";
export type LegalStatus = "inForce" | "changeWithPreEffect" | "changeWithoutPreEffect" | "unknown";

export interface OerebLawLink {
  title: string;
  url: string | null;
  /** 'LegalProvision' | 'Law' | 'Hint'; fehlt bei alten Themen und wenn der Dienst nichts liefert. */
  kind?: string;
  /** Zuständige Stelle des Dokuments. */
  authority?: string;
  /** Amtliche Nummer des Erlasses. Verbindet Fassungen desselben Erlasses mit abweichendem Titel. */
  officialNumber?: string;
}
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
  bfsNumber?: number | null;
  themes: OerebTheme[];
  raw: unknown;
}
export interface ZoneResult { zone: string | null; confidence: "exact" | "coarse" | "low" | "none"; source: string }

export interface GetEgridRequest {
  municipality: string;
  parcelNumber: string;
  bfsNumber?: number;
  en?: [number, number];
  signal?: AbortSignal;
}
export interface EgridResolution {
  egrids: string[];
  /** Details zu den EGRIDs, soweit bekannt (Anzeige bei 'ambiguous', Koordinaten). */
  candidates: ParcelCandidate[];
}
export interface OerebAdapter {
  canton: string;
  getEgrid(input: GetEgridRequest): Promise<string[]>;
  resolveEgrid(input: GetEgridRequest): Promise<EgridResolution>;
  getExtract(egrid: string, opts?: { signal?: AbortSignal }): Promise<OerebExtract>;
  extractZone(extract: OerebExtract): ZoneResult;
}
