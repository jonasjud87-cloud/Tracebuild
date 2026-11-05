/** Fortschritt für die Statusroute. Rein. Baut die Antwort Feld für Feld, ohne interne Daten. */
import type { AnalysisPhase, AnalysisRunProgress } from "./contract";
import { RUN_MAX_AGE_MS } from "./budget";

export const STALLED_AFTER_MS = 6 * 60_000;
export const RESUME_AFTER_MS = 2 * 60_000;

export interface JobProgressRow {
  phase: string;
  parts_total: number;
  parts_done: number;
  lease_until: string | null;
  waiting_since: string | null;
  dispatch_url: string | null;
  last_progress_at: string;
  created_at: string;
}

const PHASES: Record<string, AnalysisPhase> = {
  prepare: "preparing",
  parts: "checking",
  consolidate: "consolidating",
  finalize: "finalizing",
};

function percentOf(phase: AnalysisPhase, done: number, total: number): number {
  if (phase === "preparing") return 3;
  if (phase === "consolidating") return 92;
  if (phase === "finalizing") return 98;
  return Math.round(5 + 85 * (total > 0 ? Math.min(1, done / total) : 0));
}

function ms(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function progressFromJob(job: JobProgressRow, nowMs: number): AnalysisRunProgress {
  const phase = PHASES[job.phase] ?? "preparing";
  const leaseActive = ms(job.lease_until) > nowMs;
  // Der Wächter schiebt next_dispatch_at laufend vor, die Wartezeit zählt deshalb ab der Freigabe.
  // waiting_since in der Zukunft: Backoff oder Überlast-Pause, niemand soll vorher anstossen.
  const waitingFrom = Math.max(ms(job.waiting_since), ms(job.lease_until)) || ms(job.created_at);
  const overdue = !leaseActive && nowMs - waitingFrom > RESUME_AFTER_MS;
  return {
    phase,
    percent: percentOf(phase, job.parts_done, job.parts_total),
    parts_done: job.parts_done,
    parts_total: job.parts_total,
    stalled: nowMs - ms(job.last_progress_at) > STALLED_AFTER_MS,
    // Steht die Kette, gilt die Zusage «läuft auch bei geschlossenem Tab» gerade nicht.
    background: !!job.dispatch_url && !overdue,
    needs_resume: !leaseActive && nowMs >= waitingFrom && (!job.dispatch_url || overdue),
  };
}

/** Betriebsdaten bleiben auf dem Server: Der Nutzer sieht keine Etappen. */
export function publicResultJson<T extends Record<string, unknown> | null | undefined>(result: T): T {
  if (!result) return result;
  const { stages: _stages, last_activity_at: _activity, active_ms: _active, ...rest } = result;
  return rest as T;
}

/** Ohne Wächter schliesst die Statusroute nach 24 h, wenn niemand mehr rechnet. */
export function isExpiredRun(job: Pick<JobProgressRow, "created_at" | "lease_until">, nowMs: number): boolean {
  return nowMs - ms(job.created_at) > RUN_MAX_AGE_MS && ms(job.lease_until) <= nowMs;
}
