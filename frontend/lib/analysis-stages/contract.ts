// API-Vertrag «Analyse in Etappen» zwischen Backend und Frontend. Eingefroren:
// Das Frontend importiert aus lib/analysis-stages/ nur diese Datei und nur mit `import type`.
// Antworten enthalten nie Etappennummer, Lease, Token oder URLs.

export type AnalysisPhase = "preparing" | "checking" | "consolidating" | "finalizing";

export interface AnalysisRunProgress {
  phase: AnalysisPhase;
  /** 0–100. Der Server berechnet, der Client hält ihn steigend. */
  percent: number;
  parts_done: number;
  parts_total: number;
  /** Seit 6 Minuten kein Fortschritt. */
  stalled: boolean;
  /** true = läuft auch bei geschlossenem Tab. false auf Preview oder lokal. */
  background: boolean;
  /** Niemand rechnet und der Server wartet auf einen Anstoss. */
  needs_resume: boolean;
}

export interface AnalysisStatusResponse {
  id: string;
  status: "running" | "done" | "error" | "cancelled";
  /** null: kein Job (fertig, oder Altlauf ohne Etappen). */
  progress: AnalysisRunProgress | null;
  error_message: string | null;
}

export type PreflightOereb = "ok" | "stale" | "failed" | "timeout" | "skipped";
export type PreflightDocuments =
  | "not_needed"
  | "done"
  | "aborted"
  | "error"
  | "unavailable"
  | "busy"
  | "stalled"
  | "timeout"
  | "skipped";

export interface AnalysisPreflight {
  oereb: PreflightOereb;
  documents: PreflightDocuments;
  /** Für die Anzeige, Datum des verwendeten Auszugs, wenn stale. */
  stale_fetched_at: string | null;
}
