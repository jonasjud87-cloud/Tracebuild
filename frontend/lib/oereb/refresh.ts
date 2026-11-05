import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { countPendingDocuments } from "./documents-pending";
import { fetchAndPersistExtract, invalidateExtract, type FetchExtractResult } from "./fetch";
import { isSupported } from "./registry";
import { recordFetchEvent } from "./fetch-events";
import { isExtractStale } from "./stale";

export interface RefreshProject {
  id: string;
  location?: { canton?: string; municipality?: string } | null;
  parcel_number?: string | null;
  egrid?: string | null;
  lv95_e?: number | string | null;
  lv95_n?: number | string | null;
  bfs_number?: number | null;
}

export interface RefreshOptions {
  /** Zeitbudget für alle Requests des Abrufs. */
  budgetMs?: number;
  /** Abruf entfällt, falls der letzte Versuch jünger ist. 0 = immer abrufen. */
  minAgeMs?: number;
  /** Abbruch von aussen, zusätzlich zum Budget. */
  signal?: AbortSignal;
}

export interface RefreshResult {
  /** null: kein Abruf (keine Parzelle, kein gültiger Kanton, letzter Versuch zu jung, Tabelle fehlt). */
  result: FetchExtractResult | null;
  /** Der Abruf schlug fehl, es gilt weiter der gespeicherte Auszug vom `staleFetchedAt`. */
  usedStale: boolean;
  staleFetchedAt: string | null;
  documents_pending: number;
}

interface StoredExtract {
  status?: string | null;
  egrid?: string | null;
  canton?: string | null;
  parcel_number?: string | null;
  fetched_at?: string | null;
  last_attempt_at?: string | null;
  last_error?: string | null;
}

function numberOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function pendingDocuments(admin: SupabaseClient, projectId: string): Promise<number> {
  try {
    return await countPendingDocuments(admin, projectId);
  } catch (e) {
    console.error(`Offene ÖREB-Dokumente für Projekt ${projectId} nicht ermittelbar:`, e);
    return 0;
  }
}

/**
 * ÖREB aktualisieren (Projekterstellung, Analysestart, «Neu laden»). Wirft nie: Scheitert der
 * Abruf, bleibt der gespeicherte Auszug als Rückfall stehen und `usedStale` meldet es.
 * Gehört der gespeicherte Auszug zu einem anderen Grundstück, wird er vorher verworfen.
 */
export async function refreshProjectOereb(
  admin: SupabaseClient,
  project: RefreshProject,
  { budgetMs = 25_000, minAgeMs = 0, signal }: RefreshOptions = {}
): Promise<RefreshResult> {
  const out: RefreshResult = { result: null, usedStale: false, staleFetchedAt: null, documents_pending: 0 };
  try {
    const canton = project.location?.canton ?? "";
    const parcel = project.parcel_number ? String(project.parcel_number) : "";
    const egrid = project.egrid ?? null;
    const e = numberOrNull(project.lv95_e);
    const n = numberOrNull(project.lv95_n);
    const hasPosition = !parcel && !egrid && e !== null && n !== null;

    if (isSupported(canton) && (parcel || egrid || hasPosition)) {
      const { data, error } = await admin
        .from("oereb_extracts")
        .select("*")
        .eq("project_id", project.id)
        .maybeSingle();
      if (error && !isMissingSchema(error.message)) throw new Error(error.message);

      if (!error) {
        let existing = (data as StoredExtract | null) ?? null;
        if (isExtractStale(existing, project)) {
          await invalidateExtract(project.id);
          existing = null;
        }

        const lastAttempt = existing?.last_attempt_at ?? existing?.fetched_at ?? null;
        const tooRecent =
          minAgeMs > 0 && !!existing && !!lastAttempt && Date.now() - Date.parse(lastAttempt) < minAgeMs;

        if (tooRecent) {
          out.usedStale = existing?.status === "ok" && !!existing.last_error;
        } else {
          const startedAt = Date.now();
          out.result = await fetchAndPersistExtract(
            project.id,
            canton,
            project.location?.municipality ?? "",
            parcel,
            {
              egrid,
              en: hasPosition ? [e as number, n as number] : null,
              bfs: project.bfs_number ?? null,
              signal: signal ? AbortSignal.any([AbortSignal.timeout(budgetMs), signal]) : AbortSignal.timeout(budgetMs),
            }
          );
          await recordFetchEvent(admin, {
            source: "oereb",
            canton,
            project_id: project.id,
            status: out.result.status,
            detail: out.result.statusDetail,
            duration_ms: Date.now() - startedAt,
          });
          out.usedStale = out.result.status !== "ok" && out.result.status !== "ambiguous" && existing?.status === "ok";
        }
        if (out.usedStale) out.staleFetchedAt = existing?.fetched_at ?? null;
      }
    }
  } catch (err) {
    console.error(`ÖREB-Aktualisierung für Projekt ${project.id} fehlgeschlagen:`, err);
  }
  out.documents_pending = await pendingDocuments(admin, project.id);
  return out;
}
