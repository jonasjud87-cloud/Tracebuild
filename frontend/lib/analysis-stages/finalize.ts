/**
 * Abschluss einer Analyse: idempotent und ohne Modellkosten. Bricht er ab, wiederholt ihn die nächste
 * Etappe: Items werden gelöscht und neu geschrieben, der Status hat einen Guard.
 */
import type { CheckItem, NormCallResult, UsageTotals } from "../analysis-engine";
import type { ItemRow, StageDeps, StageJob, StagePart } from "./ports";

export function totalUsage(parts: StagePart[], consolidation: UsageTotals | null): UsageTotals {
  const u: UsageTotals = { input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
  for (const p of parts) {
    u.input_tokens += p.input_tokens;
    u.cache_write_tokens += p.cache_write_tokens;
    u.cache_read_tokens += p.cache_read_tokens;
    u.output_tokens += p.output_tokens;
  }
  if (consolidation) {
    u.input_tokens += consolidation.input_tokens;
    u.cache_write_tokens += consolidation.cache_write_tokens;
    u.cache_read_tokens += consolidation.cache_read_tokens;
    u.output_tokens += consolidation.output_tokens;
  }
  return u;
}

export function byPosition(parts: StagePart[]): StagePart[] {
  return parts.slice().sort((a, b) => a.position - b.position);
}

export function rawItems(parts: StagePart[]): CheckItem[] {
  return byPosition(parts).flatMap((p) => p.items ?? []);
}

export function callsOf(parts: StagePart[]): NormCallResult[] {
  return byPosition(parts).flatMap((p) => (p.call ? [p.call] : []));
}

export function failedNormsOf(parts: StagePart[]): { norm_id: string; norm_title: string; error: string }[] {
  return byPosition(parts)
    .filter((p) => p.status === "failed")
    .map((p) => ({ norm_id: p.unit.norm.id, norm_title: p.unit.label, error: p.call?.error ?? "unbekannt" }));
}

/** Normteile ohne Prüfpunkte. Kann korrekt sein, darf aber nicht wie geprüft und in Ordnung aussehen. */
export function emptyPartsOf(parts: StagePart[]): string[] {
  return byPosition(parts)
    .filter((p) => p.status === "done" && (p.items?.length ?? 0) === 0)
    .map((p) => p.unit.label);
}

export function stagesInfo(job: StageJob, parts: StagePart[]) {
  return {
    count: job.stage_no,
    resumes: job.resumes,
    unmetered_attempts: parts.reduce((sum, p) => sum + p.unmetered_attempts, 0),
    // Der Job wird gelöscht, die Abnahme braucht diese Werte danach noch.
    dispatch_attempts: job.dispatch_total,
    overload_wait_ms: job.overload_wait_ms,
    cold_stages: job.cold_stages,
    cache_write_parts: parts.filter((p) => p.cache_write_tokens > 0).length,
  };
}

export type FinalizeResult = "done" | "error" | "gone";

export async function finalizeRun(
  deps: StageDeps,
  job: StageJob,
  parts: StagePart[],
  activeMs: number,
): Promise<FinalizeResult> {
  const { store, model, clock } = deps;
  const snapshot = job.snapshot;
  const items = job.final_items ?? rawItems(parts);
  const assigned = new Set(snapshot?.assigned_ids ?? []);

  // Eine Norm kann während des Laufs verschwunden sein, sonst verletzt der Eintrag den FK.
  const candidates = Array.from(new Set(items.map((i) => i.norm_id).filter((id): id is string => !!id && assigned.has(id))));
  const existing = candidates.length ? await store.existingNormIds(candidates) : new Set<string>();

  const rows: ItemRow[] = items.map((item) => ({
    analysis_id: job.analysis_id,
    norm_id: item.norm_id && existing.has(item.norm_id) ? item.norm_id : null,
    norm_title: item.norm_title,
    category: item.category,
    status: item.status,
    note: item.finding,
    suggestion: item.suggestion,
    confidence: item.confidence,
    page_reference: item.page_reference,
    source_file: item.source_file,
  }));

  await store.deleteItems(job.analysis_id);
  const insertErrors: string[] = [];
  let savedCount = 0;
  if (rows.length > 0) {
    const bulkError = await store.insertItems(rows);
    if (bulkError === null) {
      savedCount = rows.length;
    } else {
      deps.log.error(`analysis_items: Sammel-Insert von ${job.analysis_id} gescheitert, einzeln weiter: ${bulkError}`);
      for (const row of rows) {
        const rowError = await store.insertItems([row]);
        if (rowError) insertErrors.push(`${row.norm_title}: ${rowError}`);
        else savedCount++;
      }
    }
  }

  const usage = totalUsage(parts, job.consolidation_usage);
  const failedNorms = failedNormsOf(parts);
  const status = savedCount > 0 ? "done" : "error";
  const now = clock.now();
  const reason = failedNorms[0]?.error ?? insertErrors[0] ?? "Keine Prüfpunkte erzeugt";

  const resultJson: Record<string, unknown> = {
    run_id: job.run_id,
    model: model.model,
    norms_source: snapshot?.norms_source ?? null,
    norms_error: snapshot?.norms_error ?? null,
    norm_count: snapshot?.norms.length ?? 0,
    reference_norms: snapshot?.reference_norms ?? [],
    oereb_context: snapshot?.oereb_context ?? false,
    oereb_snapshot: snapshot?.oereb_snapshot,
    geodata_snapshot: snapshot?.geodata_snapshot,
    norm_versions: snapshot?.norm_versions,
    auto_parts: snapshot?.auto_parts,
    item_count: items.length,
    raw_item_count: job.consolidation?.raw_count ?? items.length,
    consolidation: job.consolidation,
    saved_count: savedCount,
    duration_ms: now - Date.parse(job.created_at),
    active_ms: activeMs,
    usage,
    calls: callsOf(parts),
    failed_norms: failedNorms,
    empty_parts: emptyPartsOf(parts),
    insert_errors: insertErrors,
    stages: stagesInfo(job, parts),
    preflight: job.preflight,
    ...(status === "error" ? { error: `Analyse ohne Ergebnis: ${reason}` } : {}),
  };

  const closed = await store.closeAnalysis(job.analysis_id, {
    status,
    cost_usd: model.cost(usage),
    result_json: resultJson,
    finished_at: new Date(now).toISOString(),
  });

  if (!closed) {
    // Abbruch, der während des Speicherns eintraf: Prüfpunkte wieder wegräumen.
    await store.deleteItems(job.analysis_id);
    return "gone";
  }

  await deps.audit({ job, status, itemCount: savedCount });
  await store.deleteJob(job.analysis_id);
  return status;
}

/** Fehler mit Grund schliessen. Bisherige Kosten bleiben. */
export async function closeWithError(deps: StageDeps, job: StageJob, parts: StagePart[], message: string): Promise<void> {
  const { store, model, clock } = deps;
  const usage = totalUsage(parts, job.consolidation_usage);
  const closed = await store.closeAnalysis(job.analysis_id, {
    status: "error",
    cost_usd: model.cost(usage),
    finished_at: new Date(clock.now()).toISOString(),
    result_json: {
      run_id: job.run_id,
      error: message,
      model: model.model,
      usage,
      calls: callsOf(parts),
      failed_norms: failedNormsOf(parts),
      stages: stagesInfo(job, parts),
      preflight: job.preflight,
    },
  });
  if (closed) await deps.audit({ job, status: "error", error: message });
  await store.deleteJob(job.analysis_id);
}

/** Abgebrochen: Kosten festhalten, keine Prüfpunkte. Der Status bleibt, wie ihn der Abbruch gesetzt hat. */
export async function closeCancelled(deps: StageDeps, job: StageJob, parts: StagePart[]): Promise<void> {
  const { store, model, clock } = deps;
  const usage = totalUsage(parts, job.consolidation_usage);
  const status = await store.analysisStatus(job.analysis_id);
  // Fertig oder wieder laufend (fremde Etappe): Nichts anfassen, schon gar nicht die Prüfpunkte.
  if (status === "done" || status === "running") return;
  if (status === "cancelled") await store.deleteItems(job.analysis_id);
  await store.recordCancelled(job.analysis_id, {
    cost_usd: model.cost(usage),
    finished_at: new Date(clock.now()).toISOString(),
    result_json: {
      run_id: job.run_id,
      cancelled: true,
      model: model.model,
      usage,
      calls: callsOf(parts),
      stages: stagesInfo(job, parts),
    },
  });
  await store.deleteJob(job.analysis_id);
}
