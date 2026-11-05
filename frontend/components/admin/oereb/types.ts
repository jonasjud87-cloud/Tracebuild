/** Vertrag der Admin-Routen unter /api/v1/admin/oereb-imports. Client-sicher: reine Typen. */
import type { ImportFilterRules } from "@/lib/oereb/import-filter";

export type DocumentDecision = "force_import" | "exclude" | "recheck";

/** Freigabe je Kanton: `doc_types` leer ist der produktive Stopp in `oereb_import_filters`. */
export interface CantonRelease {
  released: boolean;
  /** Woher der Wert stammt: Kantonszeile, Zeile `default` oder Standard im Code. */
  source: "canton" | "default" | "code";
}

export interface CantonOverview {
  canton: string;
  release: CantonRelease;
  own_rules: "none" | "active" | "inactive";
  total: number;
  imported: number;
  rejected: number;
  scans: number;
  failed: number;
  pending: number;
}

export interface FilterRow {
  scope: string;
  rules: unknown;
  active: boolean;
  note: string | null;
  updated_at: string | null;
}

export interface OverviewResponse {
  available: boolean;
  /** Mehr Dokumente, als gezählt wurden: Die Zahlen sind dann Untergrenzen. */
  truncated: boolean;
  cantons: CantonOverview[];
  filters: FilterRow[];
}

export interface AdminDocument {
  id: string;
  canton: string;
  bfs_number: number;
  municipality: string;
  title: string;
  url: string;
  doc_type: string | null;
  scope: "municipal" | "parcel" | null;
  status: string;
  reject_reason: string | null;
  reject_detail: string | null;
  norm_id: string | null;
  last_checked_at: string | null;
  last_update_status: string | null;
  version_note: string | null;
  manual_decision: DocumentDecision | null;
  /** `ai_read`: Text von Claude gelesen. */
  text_source: string | null;
  ocr_cost_usd: number | null;
}

export interface DocumentsResponse {
  available: boolean;
  truncated: boolean;
  total: number;
  documents: AdminDocument[];
  municipalities: { bfs_number: number; municipality: string; count: number }[];
  reasons: { reason: string; count: number }[];
  /** Wirksame Regeln dieses Kantons: Code, dann `default`, dann die Kantonszeile. */
  rules: ImportFilterRules;
}

export interface DecisionResponse {
  id: string;
  decision: DocumentDecision;
  status: string;
  norm_id: string | null;
}
