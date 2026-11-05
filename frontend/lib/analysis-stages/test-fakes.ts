/** Testhilfen: Store im Speicher, Modell mit Drehbuch, simulierte Uhr. Nur für *.test.ts. */
import type { CallOutcome, CheckItem } from "../analysis-engine";
import type { ModelErrorClass } from "./errors";
import type { StageUnit } from "./plan";
import type {
  Clock, ClaimResult, ItemRow, JobPatch, JobStore, PartCallRequest, PartPatch, PrepareResult, RunSnapshot, StageDeps, StageJob, StagePart,
} from "./ports";
import { claimStage, runStage, type StageResult } from "./run-stage";
import { STATE_VERSION } from "./budget";

export const ANALYSIS_ID = "00000000-0000-4000-8000-000000000001";
export const START_MS = Date.parse("2026-11-05T10:00:00Z");

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export class FakeClock implements Clock {
  t = START_MS;
  private timers: { at: number; fire: () => void }[] = [];
  now() {
    return this.t;
  }
  sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = { at: this.t + Math.max(0, ms), fire: () => { signal?.removeEventListener("abort", onAbort); resolve(); } };
      const onAbort = () => {
        this.timers = this.timers.filter((x) => x !== timer);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.timers.push(timer);
    });
  }
  advanceToNext(): boolean {
    if (this.timers.length === 0) return false;
    const next = Math.min(...this.timers.map((x) => x.at));
    this.t = Math.max(this.t, next);
    const due = this.timers.filter((x) => x.at <= this.t);
    this.timers = this.timers.filter((x) => x.at > this.t);
    due.forEach((x) => x.fire());
    return true;
  }
}

/** Führt ein Promise unter simulierter Zeit aus: Ist alles ruhig, springt die Uhr zum nächsten Timer. */
export async function drive<T>(clock: FakeClock, p: Promise<T>): Promise<T> {
  let done = false;
  const settled = p.finally(() => { done = true; });
  settled.catch(() => undefined);
  for (let i = 0; i < 200_000 && !done; i++) {
    await new Promise((r) => setImmediate(r));
    if (!done && !clock.advanceToNext()) await new Promise((r) => setImmediate(r));
  }
  return settled;
}

export class FakeStore implements JobStore {
  status: string | null = "running";
  cost = 0;
  result: Record<string, unknown> | null = { run_id: "run" };
  finishedAt: string | null = null;
  job: (StageJob & { lease_id: string | null; lease_until: number | null; token: string | null; waiting_until: number | null }) | null;
  parts: StagePart[] = [];
  items: ItemRow[] = [];
  existing: Set<string> | null = null;
  /** Ab dieser Zahl von savePart-Aufrufen wirft jeder Schreibvorgang (Absturz). */
  crashAfterSaves: number | null = null;
  /** Die nächsten n savePart-Aufrufe scheitern vorübergehend. */
  failNextSaves = 0;
  saves = 0;
  statusError = false;
  insertBulkFails = false;
  closes = 0;

  private clock: FakeClock;

  constructor(clock: FakeClock, jobOver: Partial<StageJob> = {}) {
    this.clock = clock;
    this.job = {
      analysis_id: ANALYSIS_ID, project_id: "p", org_id: "o", actor_id: "u", actor_email: "u@x.ch", run_id: "run",
      state_version: STATE_VERSION, phase: "prepare", stage_no: 0, no_progress_stages: 0, resumes: 0, crash_count: 0, cold_stages: 0, dispatch_total: 0, active_ms: 0,
      dispatch_url: "https://www.tracebuild.ch/x", snapshot: null,
      files: [{ path: "p/a.pdf", name: "a.pdf", type: "application/pdf", size: 1 }],
      signed_urls: null, urls_expire_at: null, preflight: null, parts_total: 0, parts_done: 0, consolidation: null,
      consolidation_attempts: 0, consolidation_usage: null, final_items: null, overload_wait_ms: 0,
      created_at: new Date(START_MS).toISOString(),
      lease_id: null, lease_until: null, token: null, waiting_until: null,
      ...jobOver,
    };
  }
  private guard() {
    if (this.crashAfterSaves !== null && this.saves >= this.crashAfterSaves) throw new Error("DB weg");
  }
  async claim(_id: string, tokenHash: string | null, leaseId: string, leaseSeconds: number): Promise<ClaimResult | null> {
    this.guard();
    const j = this.job;
    if (!j || this.status !== "running") return null;
    if (j.lease_until !== null && j.lease_until >= this.clock.now()) return null;
    if (tokenHash !== null && j.token !== tokenHash) return null;
    if (tokenHash === null && j.waiting_until !== null && j.waiting_until > this.clock.now()) return null;
    if (j.lease_id !== null) j.crash_count++;
    j.waiting_until = null;
    j.lease_id = leaseId;
    j.lease_until = this.clock.now() + leaseSeconds * 1000;
    j.stage_no++;
    j.token = null;
    return { stage_no: j.stage_no, phase: j.phase, state_version: j.state_version };
  }
  async loadJob(_id: string, leaseId: string) {
    this.guard();
    if (!this.job || this.job.lease_id !== leaseId) return null;
    return clone(this.job) as StageJob;
  }
  async updateJob(_id: string, leaseId: string, patch: JobPatch) {
    this.guard();
    if (!this.job || this.job.lease_id !== leaseId) return false;
    Object.assign(this.job, clone(patch));
    return true;
  }
  async releaseLease(_id: string, leaseId: string, delayMs: number) {
    this.guard();
    if (!this.job || this.job.lease_id !== leaseId) return false;
    this.job.lease_id = null;
    this.job.lease_until = null;
    this.job.waiting_until = this.clock.now() + delayMs;
    return true;
  }
  async clearDispatchUrl() {
    if (this.job) this.job.dispatch_url = null;
  }
  async deleteJob() {
    this.guard();
    this.job = null;
    this.parts = [];
  }
  async analysisStatus() {
    if (this.statusError) throw new Error("Netzwackler");
    return this.status;
  }
  async replaceParts(_id: string, units: StageUnit[]) {
    this.guard();
    this.parts = units.map((unit, position) => ({
      position, unit: clone(unit), status: "pending", attempts: 0, unmetered_attempts: 0, next_effort: null, lease_id: null, items: null,
      call: null, input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0,
    }));
  }
  async listParts() {
    this.guard();
    return clone(this.parts);
  }
  async savePart(_id: string, position: number, expectedLease: string | null, patch: PartPatch) {
    this.guard();
    if (this.failNextSaves > 0) {
      this.failNextSaves--;
      throw new Error("Netzwackler");
    }
    this.saves++;
    const part = this.parts.find((p) => p.position === position);
    if (!part || part.lease_id !== expectedLease) return false;
    Object.assign(part, clone(patch));
    return true;
  }
  async writeProgress(_id: string, costUsd: number, resultJson: Record<string, unknown>) {
    this.guard();
    if (this.status !== "running") return;
    this.cost = costUsd;
    this.result = clone(resultJson);
  }
  async existingNormIds(ids: string[]) {
    return new Set(this.existing ? ids.filter((id) => this.existing!.has(id)) : ids);
  }
  async deleteItems() {
    this.guard();
    this.items = [];
  }
  async insertItems(rows: ItemRow[]) {
    if (this.insertBulkFails && rows.length > 1) return "bulk kaputt";
    this.items.push(...clone(rows));
    return null;
  }
  async closeAnalysis(_id: string, f: { status: "done" | "error"; cost_usd: number; result_json: Record<string, unknown>; finished_at: string }) {
    this.guard();
    this.closes++;
    if (this.status !== "running") return false;
    this.status = f.status;
    this.cost = f.cost_usd;
    this.result = clone(f.result_json);
    this.finishedAt = f.finished_at;
    return true;
  }
  async recordCancelled(_id: string, f: { cost_usd: number; result_json: Record<string, unknown>; finished_at: string }) {
    if (this.status === "cancelled") {
      this.result = clone(f.result_json);
      this.finishedAt = f.finished_at;
    }
    if (this.status === "cancelled" || this.status === "error") this.cost = f.cost_usd;
  }
}

export function item(norm_id: string | null, finding = "Befund"): CheckItem {
  return {
    check_id: "c", norm_id, norm_title: "Art. 1", category: "andere", status: "warn", finding, suggestion: null,
    confidence: "medium", page_reference: null, source_file: null,
  };
}

export function unit(i: number, total: number, normId = `n${i}`): StageUnit {
  return {
    norm: { id: normId, title: `Norm ${i}`, category: null, layer: 3, jurisdiction_type: null, source_kind: null, auto_scope: null },
    part: 1, parts: 1, text: `Text ${i}`, range: null, index: i, total, label: `Norm ${i}`,
  };
}

export interface Script {
  durationMs?: number;
  items?: CheckItem[];
  error?: { cls: ModelErrorClass; message?: string; retryAfterMs?: number };
  tokens?: Partial<{ input_tokens: number; cache_write_tokens: number; cache_read_tokens: number; output_tokens: number }>;
  onCall?: () => void;
}

export interface Harness {
  clock: FakeClock;
  store: FakeStore;
  deps: StageDeps;
  calls: PartCallRequest[];
  dispatched: number;
  consolidations: number;
  signs: number;
  warnings: string[];
  stage(source?: "start" | "dispatch" | "resume"): Promise<StageResult | null>;
  run(maxStages?: number): Promise<StageResult[]>;
}

export function harness(opts: {
  parts: number;
  script?: (req: PartCallRequest, nth: number) => Script;
  consolidate?: (n: number, items: CheckItem[]) => { items?: CheckItem[]; applied?: boolean; error?: string };
  job?: Partial<StageJob>;
  maxRunCostUsd?: number;
  urlsExpireInMs?: number;
  prepareFails?: string;
  dispatcher?: () => "sent" | "unavailable" | "failed";
}): Harness {
  const clock = new FakeClock();
  const store = new FakeStore(clock, opts.job);
  const h = { clock, store, calls: [], dispatched: 0, consolidations: 0, signs: 0, warnings: [] } as unknown as Harness;
  const perPart = new Map<number, number>();

  const snapshot: RunSnapshot = {
    boundary: "DATEN-feste-grenze", system: "SYSTEM", reference_text: "REFERENZ", reference_complete_ids: [],
    norms: [], assigned_ids: Array.from({ length: opts.parts }, (_, i) => `n${i}`), norm_order: [], norms_source: "project_norms",
    norms_error: null, reference_norms: [], oereb_context: false,
    auto_parts: { total: 0, run: 0, skipped: 0, skipped_titles: [], limit: 30 },
    oereb_snapshot: { fetched_at: null, stale: false, stale_reason: null, status: null, egrid: null },
    geodata_snapshot: { fetched_at: null, status: "ok", sources: [] } as unknown as RunSnapshot["geodata_snapshot"],
    norm_versions: [],
  };

  const deps: StageDeps = {
    store,
    clock,
    log: { warn: (m) => h.warnings.push(m), error: (m) => h.warnings.push(m) },
    config: { maxConcurrency: 8, maxRunCostUsd: opts.maxRunCostUsd ?? 15 },
    audit: async () => undefined,
    dispatcher: {
      available: async () => true,
      dispatch: async () => { h.dispatched++; return opts.dispatcher ? opts.dispatcher() : "sent"; },
    },
    prepare: async (): Promise<PrepareResult> => {
      if (opts.prepareFails) throw new Error(opts.prepareFails);
      await clock.sleep(5_000);
      return {
        snapshot,
        signed_urls: ["https://s/signed-1"],
        urls_expire_at: new Date(clock.now() + (opts.urlsExpireInMs ?? 3 * 3_600_000)).toISOString(),
        units: Array.from({ length: opts.parts }, (_, i) => unit(i, opts.parts)),
      };
    },
    signUrls: async () => {
      h.signs++;
      return { signed_urls: [`https://s/signed-new-${h.signs}`], urls_expire_at: new Date(clock.now() + 3 * 3_600_000).toISOString() };
    },
    model: {
      model: "fake",
      cost: (u) => (u.input_tokens * 2 + u.cache_write_tokens * 2.5 + u.cache_read_tokens * 0.2 + u.output_tokens * 10) / 1_000_000,
      async consolidate(req) {
        h.consolidations++;
        const r = opts.consolidate?.(h.consolidations, req.items) ?? {};
        await clock.sleep(10_000, req.signal);
        const applied = r.applied ?? true;
        return {
          items: r.items ?? req.items,
          usage: { input_tokens: 100, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 100 },
          result: { applied, raw_count: req.items.length, merged: 0, downgraded: 0, error: r.error ?? (applied ? null : "kaputt"), duration_ms: 10_000 },
        };
      },
      async callPart(req): Promise<CallOutcome> {
        const nth = (perPart.get(req.unit.index) ?? 0) + 1;
        perPart.set(req.unit.index, nth);
        h.calls.push(req);
        const s = opts.script?.(req, nth) ?? {};
        s.onCall?.();
        const started = clock.now();
        const total = s.durationMs ?? 72_000;
        await clock.sleep(Math.min(5_000, total), req.signal);
        req.onPrefillDone?.();
        const budget = Math.min(req.deadlineAt, started + 150_000);
        const end = Math.min(started + total, budget);
        if (clock.now() < end) await clock.sleep(end - clock.now(), req.signal);
        const tokens = { input_tokens: 1000, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 5000, ...s.tokens };
        const cancelled = req.signal.aborted;
        const timedOut = !cancelled && started + total > budget;
        const cls = cancelled ? "cancelled" : timedOut ? "timeout" : s.error?.cls ?? null;
        const ok = cls === null;
        return {
          items: ok ? (s.items ?? [item(req.unit.norm.id)]) : (s.items ?? []),
          error_class: cls,
          retry_after_ms: s.error?.retryAfterMs ?? null,
          result: {
            norm_id: req.unit.norm.id, norm_title: req.unit.label, part: 1, parts: 1, ok,
            error: ok ? null : s.error?.message ?? (cancelled ? "Analyse abgebrochen" : timedOut ? "Zeitbudget der Analyse überschritten" : String(cls)),
            stop_reason: ok ? "end_turn" : null, retried: false, item_count: 0, ...tokens, duration_ms: clock.now() - started,
          },
        };
      },
    },
  };
  h.deps = deps;

  h.stage = async (source = "dispatch") => {
    // Wächter und Browser halten sich an die Wartezeit: Die Uhr springt dorthin.
    if (store.job?.waiting_until && store.job.waiting_until > clock.t) clock.t = store.job.waiting_until;
    const leaseId = crypto.randomUUID();
    const claim = await claimStage(store, ANALYSIS_ID, null, leaseId);
    if (!claim) return null;
    return drive(clock, runStage(deps, { analysisId: ANALYSIS_ID, leaseId, source, startedAtMs: clock.now() }));
  };
  h.run = async (maxStages = 60) => {
    const out: StageResult[] = [];
    for (let i = 0; i < maxStages; i++) {
      const r = await h.stage(i === 0 ? "start" : "dispatch");
      if (r === null) break;
      out.push(r);
      if (r !== "handed_off" && r !== "crashed") break;
    }
    return out;
  };
  return h;
}
