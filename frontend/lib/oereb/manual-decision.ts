/**
 * Entscheide eines Admins zu einem ÖREB-Dokument. Sie bleiben bei späteren Abrufen bestehen: Der
 * Regelabgleich, der Fassungsvergleich und die Ablösung überspringen Dokumente mit `manual_decision`.
 * Die Rechteprüfung und das Audit-Protokoll macht die aufrufende Route. Geschrieben wird über
 * `oereb_apply_version_actions`, nie direkt: Sonst könnte ein gleichzeitiger Abgleich dazwischenfahren.
 *
 * - `exclude`: Dokument abgelehnt, seine Norm gilt nicht mehr (sie bleibt für den Nachvollzug bestehen).
 * - `force_import`: importieren trotz Titel-, Inhalts- und Deckelregel. Host-Prüfung, Duplikate,
 *   manuell gepflegte Normen und Schrumpfschutz gelten weiter. Ein Scan wird nur gelesen, wenn
 *   `ocr_enabled` an ist.
 * - `recheck`: früheren Entscheid aufheben und nach den normalen Regeln neu beurteilen. Hebt auch die
 *   Sperre gegen einen zweiten Leseversuch auf, ausser der Text ist bereits gelesen und steht als Norm.
 *
 * Die Wirkung tritt beim nächsten Dokument-Lauf eines Projekts der Gemeinde ein, `exclude` sofort.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "../supabase/schema-errors";
import { checkDocumentUrl } from "./document-fetch";
import { loadImportFilter, type OerebDocumentRow } from "./documents";
import { MANUAL_EXCLUDE_REASON } from "./import-filter";

export type ManualDecision = "force_import" | "exclude" | "recheck";

export const MANUAL_DECISIONS: readonly ManualDecision[] = ["force_import", "exclude", "recheck"];

export type ManualDecisionResult =
  | { ok: true; docId: string; decision: ManualDecision; status: string; normId: string | null }
  | { ok: false; error: "not_found" | "migration_missing" | "locked"; detail: string };

const MISSING: ManualDecisionResult = {
  ok: false,
  error: "migration_missing",
  detail: "Migration 20261109000001 ist noch nicht eingespielt",
};

/**
 * `force_import` hebt nur Filter-Ablehnungen auf. Sicherheitsgründe bleiben: Fehlercode `force_blocked`.
 * Geworfen statt als Ergebnis, damit kein Aufrufer die Abweisung als Erfolg übersehen kann.
 */
export class ForceBlockedError extends Error {
  readonly code = "force_blocked" as const;
  readonly reason: string;
  constructor(reason: string, detail: string) {
    super(detail);
    this.name = "ForceBlockedError";
    this.reason = reason;
  }
}

/** Gründe aus dem Abruf (document-fetch.ts). Host und Protokoll prüft zusätzlich `checkDocumentUrl` neu. */
export const FORCE_BLOCKING_REASONS: ReadonlySet<string> = new Set([
  "private_address", "host_not_allowed", "too_many_redirects", "too_large", "not_pdf",
]);

async function assertForceAllowed(admin: SupabaseClient, doc: OerebDocumentRow): Promise<void> {
  if (doc.reject_reason && FORCE_BLOCKING_REASONS.has(doc.reject_reason)) {
    throw new ForceBlockedError(doc.reject_reason, `Sicherheitsablehnung ${doc.reject_reason} lässt sich nicht übersteuern`);
  }
  // Gesetzt nur aus einem Auszug mit server_fetched_at. Ohne ihn stammt die URL nicht nachweislich vom Kanton.
  if (!doc.last_seen_at) {
    throw new ForceBlockedError("no_provenance", "Dokument stand noch in keinem vom Server abgerufenen Auszug");
  }
  // Die Ablehnung kann aus einem anderen Grund stammen, die Host-Prüfung kommt dort erst zuletzt.
  const rules = await loadImportFilter(admin, doc.canton);
  // Der Stopp (active=false, Filter nicht lesbar) gilt auch für Admins.
  if (rules.doc_types.length === 0) throw new ForceBlockedError("import_stopped", "Der Import ist für diesen Kanton gestoppt");
  let bad: { reason: string; detail: string } | null;
  try {
    bad = checkDocumentUrl(new URL(doc.url_normalized), rules, doc.canton);
  } catch {
    bad = { reason: "host_not_allowed", detail: "Ungültige URL" };
  }
  if (bad) throw new ForceBlockedError(bad.reason, bad.detail);
}

/** Uploads, die auf die ausgeschlossene Norm zeigen, gelten wieder: Sonst gälte für die Org gar kein Text mehr. */
async function releaseUploads(admin: SupabaseClient, normId: string): Promise<void> {
  const { error } = await admin
    .from("norms")
    .update({ superseded_by_norm_id: null, superseded_similarity: null, superseded_at: null })
    .eq("superseded_by_norm_id", normId);
  if (error && !isMissingSchema(error.message)) console.error(`Uploads zur Norm ${normId} nicht freigegeben:`, error.message);
}

export async function setDocumentDecision(
  admin: SupabaseClient,
  docId: string,
  decision: ManualDecision
): Promise<ManualDecisionResult> {
  const { data, error } = await admin.from("oereb_documents").select("*").eq("id", docId).maybeSingle();
  if (error) {
    if (isMissingSchema(error.message)) return MISSING;
    throw new Error(`ÖREB-Dokument konnte nicht gelesen werden: ${error.message}`);
  }
  const doc = data as OerebDocumentRow | null;
  if (!doc) return { ok: false, error: "not_found", detail: `Dokument ${docId} gibt es nicht` };
  if (!("manual_decision" in doc)) return MISSING;

  // Ein laufender Import schriebe seinen Stand über den Entscheid.
  const now = Date.now();
  if (doc.lock_until && Date.parse(doc.lock_until) > now) {
    return { ok: false, error: "locked", detail: "Das Dokument wird gerade importiert, bitte später erneut versuchen" };
  }

  if (decision === "force_import") await assertForceAllowed(admin, doc);
  // Der Stopp lässt keine zurückgenommene Norm wieder gelten. Ohne Norm bleibt «neu prüfen» erlaubt.
  if (decision === "recheck" && doc.norm_id && doc.status !== "imported") {
    const rules = await loadImportFilter(admin, doc.canton);
    if (rules.doc_types.length === 0) throw new ForceBlockedError("import_stopped", "Der Import ist für diesen Kanton gestoppt");
  }

  const nowIso = new Date(now).toISOString();
  const wasExcluded = doc.manual_decision === "exclude" || doc.reject_reason === MANUAL_EXCLUDE_REASON;
  const base = { doc_id: doc.id, expect_status: doc.status, expect_reason: doc.reject_reason ?? null };

  let norm: "withdraw" | "reinstate" | undefined;
  let patch: Record<string, unknown>;
  if (decision === "exclude") {
    norm = doc.norm_id && doc.status === "imported" ? "withdraw" : undefined;
    patch = {
      manual_decision: "exclude",
      manual_decision_at: nowIso,
      status: "rejected",
      reject_reason: MANUAL_EXCLUDE_REASON,
      reject_detail: "Von einem Admin ausgeschlossen",
      last_checked_at: nowIso,
    };
  } else {
    // Text gelesen und als Norm vorhanden: Derselbe PDF-Stand wird nicht nochmals bezahlt.
    const keepRead = doc.ocr_status === "read" && !!doc.norm_id;
    norm = doc.norm_id && doc.status !== "imported" ? "reinstate" : undefined;
    patch = {
      manual_decision: decision === "force_import" ? "force_import" : null,
      manual_decision_at: nowIso,
      status: doc.norm_id ? "imported" : "pending",
      reject_reason: null,
      reject_detail: null,
      version_winner_id: null,
      attempts: 0,
      etag: null,
      last_modified: null,
      next_check_at: nowIso,
      ...(keepRead ? {} : { pdf_sha256: null, ocr_status: null, ocr_pdf_sha256: null, ocr_detail: null }),
      ...(doc.norm_id && (wasExcluded || doc.status !== "imported") ? { last_update_status: "manual_restored", last_update_detail: null } : {}),
    };
  }

  // Dieselbe RPC wie der Fassungsvergleich: Sperre je Gemeinde, prüft lock_until und den gelesenen Stand.
  const apply = (action: Record<string, unknown>) =>
    admin.rpc("oereb_apply_version_actions", { p_canton: doc.canton, p_bfs: doc.bfs_number, p_actions: [action] });
  let { data: result, error: rpcError } = await apply({ ...base, ...(norm ? { norm } : {}), patch });
  const applied = () => (result ?? {}) as { applied?: boolean; doc_ids?: string[] };
  // Inzwischen manuell gepflegte Norm: Sie bleibt unberührt, der Entscheid zum Dokument gilt trotzdem.
  const normUntouched = !rpcError && applied().applied && norm === "withdraw" && !(applied().doc_ids ?? []).includes(doc.id);
  if (normUntouched) ({ data: result, error: rpcError } = await apply({ ...base, patch }));
  if (rpcError) {
    if (isMissingSchema(rpcError.message)) return MISSING;
    throw new Error(`Entscheid konnte nicht gespeichert werden: ${rpcError.message}`);
  }
  if (!applied().applied) {
    return { ok: false, error: "locked", detail: "Das Dokument wurde gerade verarbeitet, bitte später erneut versuchen" };
  }
  if (norm === "withdraw" && !normUntouched) await releaseUploads(admin, doc.norm_id as string);
  return { ok: true, docId, decision, status: patch.status as string, normId: doc.norm_id };
}
