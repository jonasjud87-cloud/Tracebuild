/** Zeit- und Kostengrenzen der Etappen. Rein. Kostengrenze und Teile-Grenze sind Konfiguration. */

export const STAGE_DEADLINE_MS = 265_000; // Modellaufrufe enden spätestens hier
export const LEASE_SECONDS = 330; // 300 s Funktionsgrenze + 30 s
export const PER_CALL_BUDGET_MS = 240_000; // wie Engine
export const CALL_START_MIN_REMAINING_MS = 100_000;
/** Ab so viel Restzeit startet jeder Aufruf. Wird er vom Etappenende gekappt, geht er ohne Denktiefe-Abzug weiter. */
const CALL_START_ALWAYS_REMAINING_MS = 150_000;
/** Darunter hat das Modell nicht gedacht: Eine leere Antwort wird einmal wiederholt. Gemessen: 9 leer, 326 mit Prüfpunkt. */
export const EMPTY_ANSWER_MAX_OUTPUT_TOKENS = 100;
export const MAX_PART_ATTEMPTS = 3;
export const MAX_STAGES = 40;
export const MAX_NO_PROGRESS_STAGES = 3;
export const MAX_OVERLOAD_WAIT_MS = 15 * 60_000;
export const MAX_CONSOLIDATION_ATTEMPTS = 2;
export const MODEL_FILE_URL_TTL_S = 3 * 60 * 60;
export const URL_RESIGN_MIN_REMAINING_MS = 30 * 60_000;
export const STATE_VERSION = 1;
export const PREFILL_GATE_MAX_MS = 75_000;
export const CANCEL_POLL_MS = 2_500;
export const DEFAULT_OVERLOAD_WAIT_MS = 30_000;
export const MIN_OVERLOAD_CONCURRENCY = 2;
export const RUN_MAX_AGE_MS = 24 * 60 * 60_000;
export const MAX_CRASH_STAGES = 3;
/** Stürzt auch der Abschluss der gespeicherten Teile ab, endet die Analyse als Fehler. */
export const MAX_CRASH_STAGES_HARD = 5;
export const SAVE_ATTEMPTS = 3;
/** Reserve je laufendem Aufruf: Normtext, Cache-Lesen, Output. Schätzung, höchster Messwert geht vor. */
export const RESERVE_CALL_USD = 0.15;
/** Pauschale je Versuch ohne verlässliche Abrechnung (Absturz, abgebrochener Stream). */
export const LOST_ATTEMPT_USD = 0.2;

export const DEFAULT_MAX_RUN_COST_USD = 15;
export const DEFAULT_MAX_STAGED_AUTO_PARTS = 30;

type Env = Record<string, string | undefined>;

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** ANALYSIS_MAX_COST_USD, Standard USD 15. */
export function maxRunCostUsd(env: Env = process.env): number {
  return positive(env.ANALYSIS_MAX_COST_USD, DEFAULT_MAX_RUN_COST_USD);
}

/** ANALYSIS_MAX_AUTO_PARTS, Standard 30 importierte Teile. */
export function maxStagedAutoParts(env: Env = process.env): number {
  return Math.max(1, Math.floor(positive(env.ANALYSIS_MAX_AUTO_PARTS, DEFAULT_MAX_STAGED_AUTO_PARTS)));
}

export function mayStartCall(remainingMs: number, longestCallMs: number): boolean {
  return remainingMs >= Math.min(CALL_START_ALWAYS_REMAINING_MS, Math.max(CALL_START_MIN_REMAINING_MS, longestCallMs * 1.3));
}

/** Wartezeit nach dem n-ten Absturz in Folge: 1, 2, 4 ... höchstens 10 Minuten. */
export function crashBackoffMs(crashes: number): number {
  return Math.min(10 * 60_000, 60_000 * 2 ** Math.max(0, crashes - 1));
}

/** Konsolidierung: Zeit und Output wachsen mit der Zahl der Prüfpunkte. */
export function consolidationBudget(items: number): { callMs: number; maxTokens: number } {
  return {
    callMs: Math.min(200_000, 35_000 + items * 500),
    maxTokens: Math.min(16_000, 4_000 + items * 40),
  };
}
