/**
 * API-Vertrag der Geoportal-Anbindung (Spezifikation Abschnitt 7). Client-sicher: reine
 * Typen, kein process.env. Änderungen nur über den Koordinator.
 *
 * Alle Routen unter /api/v1, Envelope {data, error}. Standard: 401 ohne Login, 404 fremdes
 * oder fehlendes Projekt. Ausfall externer Dienste ist HTTP 200 mit Statusfeld, nie 5xx.
 */

export type ZoneConfidence = "exact" | "coarse" | "low" | null;
export type ExtractStatus =
  | "ok"
  | "no_egrid"
  | "ambiguous"
  | "unreachable"
  | "parse_error"
  | "no_cadastre"
  | "access_restricted";

// GET /geo/search?q=<min 3>&lang=de
export interface GeoSearchResponse {
  results: GeoSearchHit[];
  unavailable: boolean;
}
export interface GeoSearchHit {
  id: string;
  kind: "address" | "parcel";
  /** Anzeigetext ohne HTML. */
  label: string;
  e: number;
  n: number;
  egrid: string | null;
  number: string | null;
  /** Nur Anzeige (Sprachform der Suche, z. B. «Saint-Gall»). Verbindlich ist GET /geo/parcel. */
  municipality: string | null;
  bfs: number | null;
  /** Kantonskürzel; bei Parzellentreffern null, verbindlich ist GET /geo/parcel. */
  canton: string | null;
}

// GET /geo/parcel?egrid=CH… | ?e=&n= | ?egrid=CH…&e=&n=
// Parzellentreffer der Suche mit egrid UND e, n abfragen: Das dauert unter 1 s, egrid allein
// geht über den langsamen find-Dienst (live bis 15 s).
export interface GeoParcelResponse {
  candidates: ParcelCandidate[];
  unavailable: boolean;
}
export interface ParcelCandidate {
  egrid: string;
  number: string | null;
  municipality: string | null;
  bfs: number | null;
  canton: string | null;
  e: number | null;
  n: number | null;
  type: string | null;
  oereb_pdf_url: string | null;
}

// POST /projects  zusätzlich: egrid?, lv95_e?, lv95_n?, bfs_number?
// PATCH /projects/{id}  dieselben Felder. Antwort bisher plus:
export interface ProjectRefreshInfo {
  documents_pending: number;
  oereb: {
    status: ExtractStatus;
    status_detail: string | null;
    egrid: string | null;
    zone: { zone: string | null; confidence: "exact" | "coarse" | "low" | "none" } | null;
    candidates?: ParcelCandidate[];
  } | null;
}

// POST /projects/{id}/oereb {force?: boolean}  (Standard: true)
// Antwort: wie heutiges GET/POST plus die folgenden Felder.
export interface OerebRefreshExtras {
  documents_pending: number;
  used_stale: boolean;
  stale_fetched_at: string | null;
  oereb_pdf_url: string | null;
  candidates?: ParcelCandidate[];
}
/** Zusatzfelder von `extract` in GET und POST /projects/{id}/oereb. */
export interface OerebExtractExtras {
  last_attempt_at: string | null;
  last_error: string | null;
}

// GET|POST /projects/{id}/geodata  POST {force?: boolean}
export interface GeodataResponse {
  status: "ok" | "partial" | "unavailable" | "no_location";
  data: {
    height_m: number | null;
    oev_class: string | null;
    isos: { number: number; name: string; category: string | null; url: string | null }[];
    buildings: {
      egid: string;
      year: number | null;
      period: string | null;
      floors: number | null;
      dwellings: number | null;
      area_m2: number | null;
      class_code: number | null;
    }[];
  };
  errors: { source: string; message: string }[];
  links: { geoportal: string | null; canton_portal: string | null; oereb_pdf: string | null };
  sources: string[];
  fetched_at: string | null;
}

// In result_json jeder Analyse (POST /projects/{id}/analyses) und als ReportMeta.snapshots im Bericht.
export interface AnalysisSnapshots {
  oereb_snapshot: {
    fetched_at: string | null;
    stale: boolean;
    stale_reason: string | null;
    status: string | null;
    egrid: string | null;
  };
  geodata_snapshot: { fetched_at: string | null; status: string; sources: string[] };
  norm_versions: {
    norm_id: string;
    title: string;
    text_sha256: string;
    /** 'oereb_auto' oder null (manuell gepflegt). */
    source_kind: string | null;
    source_checked_at: string | null;
  }[];
}

// result_json.auto_parts: Teile automatisch importierter Normen; der Deckel schützt die Zeit für Bund und Kanton.
export interface AnalysisAutoParts {
  total: number;
  run: number;
  skipped: number;
  skipped_titles: string[];
}

// GET /projects/{id}/oereb/documents
export interface DocumentsResponse {
  available: boolean;
  items: OerebDocumentItem[];
  pending: number;
}
export interface OerebDocumentItem {
  id: string;
  title: string;
  url: string;
  kind: string | null;
  scope: "municipal" | "parcel" | null;
  status: "pending" | "imported" | "rejected" | "failed" | "duplicate_manual" | "removed" | "review";
  reject_reason: string | null;
  reject_detail: string | null;
  norm_id: string | null;
  last_checked_at: string | null;
  last_update_status: string | null;
  /** Im Zweifel beide Fassungen übernommen: Hinweis zum Anzeigen, sonst null. */
  version_note?: string | null;
  /** `ai_read`: Der Text wurde von Claude gelesen, die Anzeige sagt das. */
  text_source?: string | null;
  manual_decision?: string | null;
}

/**
 * Stand eines eigenen Uploads gegenüber dem amtlichen Text. Felder in GET /standards (eigene Normen)
 * und Antwort von PUT /standards/{id}/authoritative.
 * - `official_used`: «Neuere amtliche Fassung verwendet». Upload ist für die Zuweisung inaktiv.
 * - `org_authoritative`: Die Org hat ihre Fassung als massgebend festgelegt.
 * - `null`: Kein ähnlicher amtlicher Text bekannt, der Upload gilt normal.
 */
export type NormVersionHint = "official_used" | "org_authoritative" | null;
export interface NormSupersession {
  version_hint: NormVersionHint;
  org_authoritative: boolean;
  /** Anteil des Uploads im amtlichen Text, 0 bis 1. */
  superseded_similarity: number | null;
  superseded_at: string | null;
  official: { id: string; title: string; source_url: string | null; source_checked_at: string | null } | null;
}
// PUT /standards/{id}/authoritative  Body { authoritative: boolean }. Antwort NormSupersession & { id }.
// 404 fremde oder unbekannte Norm, 400 Body falsch, 409 keine eigene Gemeinde-Norm.

// POST /projects/{id}/oereb/documents/sync  (leerer Body, ein Dokument pro Request)
export interface DocumentSyncResponse {
  available: boolean;
  processed: {
    id: string;
    title: string;
    outcome: "imported" | "updated" | "unchanged" | "rejected" | "failed" | "duplicate_manual" | "kept_old";
  } | null;
  in_progress: boolean;
  remaining: number;
}
