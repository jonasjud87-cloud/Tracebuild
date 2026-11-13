/**
 * Schnittstellen der Etappen. Nur Typen. Damit ist die Fehlermatrix ohne Vercel, Supabase und
 * Anthropic testbar. Die Adapter stehen in store-supabase.ts, model-anthropic.ts, dispatcher-pgnet.ts.
 */
import type {
  CallOutcome,
  CheckItem,
  ConsolidationResult,
  NormCallResult,
  NormInput,
  PlanFile,
  UsageTotals,
} from "../analysis-engine";
import type { AutoPartsSummary } from "../analysis-plan";
import type { AnalysisSnapshots } from "../geoadmin/contract";
import type { PlanMimeType } from "../plan-files";
import type { AnalysisPreflight } from "./contract";
import type { StageNorm, StageUnit } from "./plan";

export type JobPhase = "prepare" | "parts" | "consolidate" | "finalize";
export type PartStatus = "pending" | "running" | "done" | "failed";
export type StageSource = "start" | "dispatch" | "resume";

export interface JobFile {
  path: string;
  name: string;
  type: PlanMimeType;
  size: number;
}

/** Eingefroren in der Vorbereitung: fertige Strings, byte-identisch über alle Etappen. */
export interface RunSnapshot extends AnalysisSnapshots {
  boundary: string;
  system: string;
  reference_text: string;
  reference_complete_ids: string[];
  norms: StageNorm[];
  assigned_ids: string[];
  norm_order: string[];
  norms_source: "project_norms" | "fallback";
  norms_error: string | null;
  reference_norms: string[];
  oereb_context: boolean;
  auto_parts: AutoPartsSummary;
  digests?: { norm_id: string; sha256: string }[];
  input_fingerprint?: string;
  delta?: { baseline_id: string; version_no: number | null; baseline_count: number };
  delta_fallback?: string;
}

export interface StageJob {
  analysis_id: string;
  project_id: string;
  org_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  run_id: string | null;
  state_version: number;
  phase: JobPhase;
  stage_no: number;
  no_progress_stages: number;
  resumes: number;
  crash_count: number;
  cold_stages: number;
  dispatch_total: number;
  active_ms: number;
  dispatch_url: string | null;
  snapshot: RunSnapshot | null;
  files: JobFile[];
  signed_urls: string[] | null;
  urls_expire_at: string | null;
  preflight: AnalysisPreflight | null;
  parts_total: number;
  parts_done: number;
  consolidation: ConsolidationResult | null;
  consolidation_attempts: number;
  consolidation_usage: UsageTotals | null;
  final_items: CheckItem[] | null;
  overload_wait_ms: number;
  created_at: string;
}

export interface StagePart {
  position: number;
  unit: StageUnit;
  status: PartStatus;
  attempts: number;
  unmetered_attempts: number;
  next_effort: "low" | "medium" | "high" | null;
  lease_id: string | null;
  items: CheckItem[] | null;
  call: NormCallResult | null;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
}

export type JobPatch = Partial<Omit<StageJob, "analysis_id" | "project_id" | "created_at">> & {
  last_progress_at?: string;
};
export type PartPatch = Partial<Omit<StagePart, "position" | "unit">>;

export interface ItemRow {
  analysis_id: string;
  norm_id: string | null;
  norm_title: string;
  category: string;
  status: string;
  note: string;
  suggestion: string | null;
  confidence: string;
  page_reference: number | null;
  source_file: string | null;
  change_status?: string | null;
}

export interface ClaimResult {
  stage_no: number;
  phase: string;
  state_version: number;
}

/** Schreibvorgänge liefern false, wenn keine Zeile getroffen wurde (Lease verloren, Analyse gelöscht). */
export interface JobStore {
  claim(analysisId: string, tokenHash: string | null, leaseId: string, leaseSeconds: number): Promise<ClaimResult | null>;
  loadJob(analysisId: string, leaseId: string): Promise<StageJob | null>;
  updateJob(analysisId: string, leaseId: string, patch: JobPatch): Promise<boolean>;
  /** Wartezeit in ms, gerechnet mit der Uhr der Datenbank. */
  releaseLease(analysisId: string, leaseId: string, delayMs: number): Promise<boolean>;
  clearDispatchUrl(analysisId: string): Promise<void>;
  deleteJob(analysisId: string): Promise<void>;
  /** null = Zeile gibt es nicht mehr. Wirft bei DB-Fehler: Das ist kein Abbruch. */
  analysisStatus(analysisId: string): Promise<string | null>;
  replaceParts(analysisId: string, units: StageUnit[]): Promise<void>;
  listParts(analysisId: string): Promise<StagePart[]>;
  /** Nur wenn der Teil noch der erwarteten Lease gehört (null = frei). */
  savePart(analysisId: string, position: number, expectedLease: string | null, patch: PartPatch): Promise<boolean>;
  /** Kosten und Lebenszeichen, nur solange die Analyse läuft. */
  writeProgress(analysisId: string, costUsd: number, resultJson: Record<string, unknown>): Promise<void>;
  existingNormIds(ids: string[]): Promise<Set<string>>;
  deleteItems(analysisId: string): Promise<void>;
  insertItems(rows: ItemRow[]): Promise<string | null>;
  /** Abschluss mit Status-Guard: false = Analyse läuft nicht mehr oder ist weg. */
  closeAnalysis(analysisId: string, fields: { status: "done" | "error"; cost_usd: number; result_json: Record<string, unknown>; finished_at: string }): Promise<boolean>;
  /** Kosten eines abgebrochenen Laufs festhalten. Ändert den Status nie. */
  recordCancelled(analysisId: string, fields: { cost_usd: number; result_json: Record<string, unknown>; finished_at: string }): Promise<void>;
}

export interface PartCallRequest {
  unit: StageUnit;
  boundary: string;
  system: string;
  referenceText: string;
  files: PlanFile[];
  inReference: boolean;
  deadlineAt: number;
  onPrefillDone: (() => void) | null;
  effort: "low" | "medium" | "high" | null;
  signal: AbortSignal;
}

export interface ConsolidateRequest {
  items: CheckItem[];
  norms: StageNorm[];
  deadlineAt: number;
  signal: AbortSignal;
  callMs: number;
  maxTokens: number;
}

export interface ModelCaller {
  readonly model: string;
  callPart(req: PartCallRequest): Promise<CallOutcome>;
  consolidate(req: ConsolidateRequest): Promise<{ items: CheckItem[]; result: ConsolidationResult; usage: UsageTotals }>;
  cost(usage: UsageTotals): number;
}

/**
 * Etappen-Auslöser, bewusst schmal. Ein anderer Auslöser (Plan B) ersetzt nur diese Schnittstelle.
 * `unavailable`: Der Auslöser fehlt dauerhaft, der Browser übernimmt. `failed`: vorübergehend, der
 * Wächter holt nach.
 */
export interface Dispatcher {
  available(): Promise<boolean>;
  dispatch(analysisId: string): Promise<"sent" | "unavailable" | "failed">;
}

export interface Clock {
  now(): number;
  /** Löst nach ms auf, oder sofort, wenn das Signal abbricht. Wirft nie. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface PrepareResult {
  snapshot: RunSnapshot;
  signed_urls: string[];
  urls_expire_at: string;
  units: StageUnit[];
}

export interface AuditEntry {
  job: StageJob;
  status: string;
  itemCount?: number;
  error?: string;
}

export interface StageLog {
  warn(message: string): void;
  error(message: string, e?: unknown): void;
}

export interface StageConfig {
  maxConcurrency: number;
  maxRunCostUsd: number;
}

export interface StageDeps {
  store: JobStore;
  model: ModelCaller;
  dispatcher: Dispatcher;
  clock: Clock;
  prepare(job: StageJob, signal: AbortSignal): Promise<PrepareResult>;
  signUrls(files: JobFile[]): Promise<{ signed_urls: string[]; urls_expire_at: string }>;
  audit(entry: AuditEntry): Promise<void>;
  log: StageLog;
  config: StageConfig;
}

export type { NormInput };
