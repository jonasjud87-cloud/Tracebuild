/**
 * «Erneut versuchen»: Eingaben einer fehlgeschlagenen Analyse für einen neuen Start bestimmen.
 * Der Start selbst läuft über POST …/analyses (gleiche Budgets, Kostengrenzen und Sperre je Projekt).
 * Datenzugriff über übergebene Abhängigkeiten, damit die Regeln ohne Netz testbar sind.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORPHAN_AFTER_MS } from "./admin-analyses/constants";
import { isMissingSchema } from "./supabase/schema-errors";
import { analysisFailure } from "../components/analysis-error-logic";

/** Wer eine Analyse starten darf, darf sie auch wiederholen. Heute alle Rollen der Organisation. */
export const ANALYSIS_START_ROLES: readonly string[] = ["super_admin", "org_admin", "project_manager", "member"];

export interface RetryFileRow {
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  position: number;
}

export interface RetrySource {
  id: string;
  status: string;
  document_id: string;
  created_at: string;
  doc_type: string | null;
  result_json: Record<string, unknown> | null;
  files: RetryFileRow[];
}

export interface RetryDeps {
  /** Nur Analysen dieses Projekts in dieser Organisation, sonst null. */
  loadAnalysis(projectId: string, orgId: string, analysisId: string): Promise<RetrySource | null>;
  loadJob(analysisId: string): Promise<{ lease_until: string | null } | null>;
  /** Alle Analysen am selben Plansatz (Dokument). */
  siblings(documentId: string): Promise<{ id: string; status: string }[]>;
}

export interface RetryFile { path: string; name: string; type: string; size: number }

export type RetryPlan =
  | {
      ok: true;
      documentId: string;
      docType: string | null;
      files: RetryFile[];
      /** Verwaister Lauf (status running, niemand rechnet): vor dem Neustart als Zeitüberschreitung schliessen. */
      closeOld: boolean;
      resultJson: Record<string, unknown> | null;
    }
  | { ok: false; status: number; error: string };

export const STILL_RUNNING = "Diese Analyse läuft noch. Bitte versuchen Sie es in einigen Minuten erneut.";
export const NOT_RETRYABLE_ERROR = "Diese Analyse kann nicht erneut gestartet werden. Bitte wenden Sie sich an den Support.";
export const STATUS_CHANGED = "Der Status hat sich inzwischen geändert. Bitte neu laden.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** retry_of vorab prüfen: Eine ungültige ID ist «nicht gefunden», kein Datenbankfehler. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ── Verwaisten Lauf schliessen ───────────────────────────────────────────────

export interface OrphanCloseDeps {
  /**
   * Nimmt den Job atomar an sich (Lease wie eine Etappe). "none": kein Job vorhanden (Altlauf).
   * "busy": Lease aktiv, Wartezeit läuft oder Status nicht mehr running. Danach kann kein anderer claimen.
   */
  claimJob(analysisId: string, leaseId: string): Promise<"claimed" | "busy" | "none">;
  /** Mit gehaltenem Lease schliessen: Kosten aus den Teilen, Job weg. true = Analyse läuft nicht mehr. */
  closeClaimed(analysisId: string, leaseId: string, reason: string): Promise<boolean>;
  /** Ohne Job: nur schliessen, wenn die Analyse noch läuft und noch verwaist ist. */
  closeWithoutJob(analysisId: string, cutoffIso: string, reason: string): Promise<boolean>;
}

export type OrphanCloseResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Erst den Job wegnehmen, dann schliessen: Zwischen Prüfung und Abschluss kann sonst der Wächter oder ein
 * anderer Tab die alte Kette weiterrechnen lassen, und beide Läufe kosten.
 */
export async function closeOrphan(
  deps: OrphanCloseDeps,
  analysisId: string,
  leaseId: string,
  reason: string,
  nowMs: number,
): Promise<OrphanCloseResult> {
  const claim = await deps.claimJob(analysisId, leaseId);
  if (claim === "busy") return { ok: false, status: 409, error: STILL_RUNNING };
  const closed = claim === "claimed"
    ? await deps.closeClaimed(analysisId, leaseId, reason)
    : await deps.closeWithoutJob(analysisId, new Date(nowMs - ORPHAN_AFTER_MS).toISOString(), reason);
  return closed ? { ok: true } : { ok: false, status: 409, error: STATUS_CHANGED };
}

function ms(iso: unknown): number {
  const t = typeof iso === "string" && iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export async function planRetry(
  deps: RetryDeps,
  input: { projectId: string; analysisId: string; user: { org_id: string; role: string } },
  nowMs: number,
): Promise<RetryPlan> {
  if (!ANALYSIS_START_ROLES.includes(input.user.role)) return { ok: false, status: 403, error: "Zugriff verweigert" };

  const source = await deps.loadAnalysis(input.projectId, input.user.org_id, input.analysisId);
  if (!source) return { ok: false, status: 404, error: "Analyse nicht gefunden" };

  let closeOld = false;
  if (source.status === "running") {
    // Nur ein Lauf ohne Lebenszeichen und ohne aktive Etappe gilt als gescheitert (wie die Admin-Ansicht).
    const activity = ms(source.result_json?.last_activity_at) || ms(source.created_at);
    if (nowMs - activity < ORPHAN_AFTER_MS) return { ok: false, status: 409, error: STILL_RUNNING };
    const job = await deps.loadJob(source.id);
    if (job && ms(job.lease_until) > nowMs) return { ok: false, status: 409, error: STILL_RUNNING };
    closeOld = true;
  } else if (source.status !== "error") {
    return { ok: false, status: 409, error: "Nur fehlgeschlagene Analysen können erneut gestartet werden." };
  } else if (!analysisFailure(source.result_json?.error, source.result_json?.timed_out === true).retryable) {
    // Kostengrenze, gesperrtes Konto, abgelehnte Prüfung: Ein neuer Lauf kostet nur erneut.
    return { ok: false, status: 409, error: NOT_RETRYABLE_ERROR };
  }

  const others = await deps.siblings(source.document_id);
  if (others.some((a) => a.id !== source.id && a.status === "running")) {
    return { ok: false, status: 409, error: "Für diese Pläne läuft bereits eine neue Analyse." };
  }

  const files = source.files
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((f) => ({ path: f.storage_path, name: f.file_name, type: f.mime_type ?? "", size: f.size_bytes ?? 0 }));
  if (files.length === 0) {
    return { ok: false, status: 409, error: "Die Pläne dieser Analyse sind nicht mehr vorhanden. Bitte laden Sie sie neu hoch." };
  }

  return { ok: true, documentId: source.document_id, docType: source.doc_type, files, closeOld, resultJson: source.result_json };
}

// ── Supabase ─────────────────────────────────────────────────────────────────

interface SourceRow {
  id: string;
  status: string;
  document_id: string;
  created_at: string;
  result_json: Record<string, unknown> | null;
  documents: { doc_type: string | null; document_files: RetryFileRow[] | null } | null;
}

export function supabaseRetryDeps(admin: SupabaseClient): RetryDeps {
  return {
    async loadAnalysis(projectId, orgId, analysisId) {
      const { data, error } = await admin
        .from("analyses")
        .select(
          "id, status, document_id, created_at, result_json, " +
            "documents!inner(doc_type, project_id, projects!inner(org_id), document_files(storage_path, file_name, mime_type, size_bytes, position))",
        )
        .eq("id", analysisId)
        .eq("documents.project_id", projectId)
        .eq("documents.projects.org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const row = data as unknown as SourceRow;
      return {
        id: row.id,
        status: row.status,
        document_id: row.document_id,
        created_at: row.created_at,
        doc_type: row.documents?.doc_type ?? null,
        result_json: row.result_json,
        files: row.documents?.document_files ?? [],
      };
    },
    async loadJob(analysisId) {
      const { data, error } = await admin.from("analysis_jobs").select("lease_until").eq("analysis_id", analysisId).maybeSingle();
      if (error && !isMissingSchema(error.message)) throw new Error(error.message);
      return (data as { lease_until: string | null } | null) ?? null;
    },
    async siblings(documentId) {
      const { data, error } = await admin.from("analyses").select("id, status").eq("document_id", documentId);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; status: string }[];
    },
  };
}
