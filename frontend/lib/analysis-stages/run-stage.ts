/**
 * Eine Etappe: reine Orchestrierung über Ports, ohne Vercel, Supabase und Anthropic.
 *
 * Jede Etappe arbeitet bis zu einer festen Zeitgrenze, speichert jeden Teil sofort und gibt den Lease
 * frei. Alle Schreibvorgänge sind an die eigene lease_id gebunden. Ein Teil mit `done` wird nie erneut
 * gerufen. Prompts und URLs kommen aus dem Snapshot, damit der Cache-Prefix byte-identisch bleibt.
 */
import type { CallOutcome, CheckItem, ConsolidationResult, NormCallResult, PlanFile, UsageTotals } from "../analysis-engine";
import {
  CANCEL_POLL_MS,
  DEFAULT_OVERLOAD_WAIT_MS,
  LEASE_SECONDS,
  LOST_ATTEMPT_USD,
  MAX_CONSOLIDATION_ATTEMPTS,
  MAX_CRASH_STAGES,
  MAX_CRASH_STAGES_HARD,
  MAX_NO_PROGRESS_STAGES,
  MAX_OVERLOAD_WAIT_MS,
  MAX_PART_ATTEMPTS,
  MAX_STAGES,
  MIN_OVERLOAD_CONCURRENCY,
  PER_CALL_BUDGET_MS,
  PREFILL_GATE_MAX_MS,
  RESERVE_CALL_USD,
  SAVE_ATTEMPTS,
  STAGE_DEADLINE_MS,
  STATE_VERSION,
  URL_RESIGN_MIN_REMAINING_MS,
  consolidationBudget,
  crashBackoffMs,
  mayStartCall,
} from "./budget";
import { decideOnFailure } from "./errors";
import { closeCancelled, closeWithError, finalizeRun, rawItems, stagesInfo, totalUsage } from "./finalize";
import { toPlanFile } from "./plan";
import type { ClaimResult, JobPatch, JobStore, PartPatch, StageDeps, StageJob, StagePart, StageSource } from "./ports";

export type StageResult = "finished" | "handed_off" | "cancelled" | "gone" | "lease_lost" | "crashed";

export const REASON_COST = "Kostengrenze erreicht";
export const REASON_OVERLOAD = "Anthropic dauerhaft überlastet, Teil nicht geprüft";
export const REASON_ACCOUNT = "Anthropic-Konto verweigert weitere Aufrufe, Teil nicht geprüft";
export const REASON_STAGES = "Analyse kam nicht weiter, Teil nicht geprüft";
export const REASON_CRASHES = "Die Analyse brach wiederholt ab und wurde beendet. Bitte erneut starten.";

class LeaseLost extends Error {}

export interface StageInput {
  analysisId: string;
  leaseId: string;
  source: StageSource;
  /** Beginn der Anfrage: waitUntil teilt sich die 300 s mit ihr. */
  startedAtMs: number;
}

export async function claimStage(
  store: JobStore,
  analysisId: string,
  tokenHash: string | null,
  leaseId: string,
): Promise<ClaimResult | null> {
  return store.claim(analysisId, tokenHash, leaseId, LEASE_SECONDS);
}

function syntheticCall(part: StagePart, error: string): NormCallResult {
  return {
    norm_id: part.unit.norm.id,
    norm_title: part.unit.label,
    part: part.unit.part,
    parts: part.unit.parts,
    ok: false,
    error,
    stop_reason: null,
    retried: part.attempts > 1,
    item_count: part.items?.length ?? 0,
    input_tokens: part.input_tokens,
    cache_write_tokens: part.cache_write_tokens,
    cache_read_tokens: part.cache_read_tokens,
    output_tokens: part.output_tokens,
    duration_ms: part.call?.duration_ms ?? 0,
  };
}

/** Mehrere Versuche: Ein sauberer Versuch oder der mit mehr Prüfpunkten gewinnt, Tokens zählen alle. */
export function mergeAttempt(part: StagePart, outcome: CallOutcome): { items: CheckItem[]; call: NormCallResult; tokens: Pick<StagePart, "input_tokens" | "cache_write_tokens" | "cache_read_tokens" | "output_tokens"> } {
  const r = outcome.result;
  const tokens = {
    input_tokens: part.input_tokens + r.input_tokens,
    cache_write_tokens: part.cache_write_tokens + r.cache_write_tokens,
    cache_read_tokens: part.cache_read_tokens + r.cache_read_tokens,
    output_tokens: part.output_tokens + r.output_tokens,
  };
  const prev = part.call;
  const prevItems = part.items ?? [];
  const retried = !!prev;
  const retryWins = r.ok || !prev || outcome.items.length > prevItems.length;
  const base = retryWins ? r : prev;
  let error = base.error;
  if (retryWins && !r.ok && prev?.error) error = `${r.error} (1. Versuch: ${prev.error})`;
  return {
    items: retryWins ? outcome.items : prevItems,
    tokens,
    call: {
      ...base,
      error,
      retried,
      item_count: (retryWins ? outcome.items : prevItems).length,
      ...tokens,
      duration_ms: (prev?.duration_ms ?? 0) + r.duration_ms,
    },
  };
}

function longestCall(parts: StagePart[]): number {
  return parts.reduce((max, p) => Math.max(max, p.call?.duration_ms ?? 0), 0);
}

export async function runStage(deps: StageDeps, input: StageInput): Promise<StageResult> {
  const { store, clock, log } = deps;
  const { analysisId, leaseId } = input;
  const startedAt = input.startedAtMs;
  const deadlineAt = startedAt + STAGE_DEADLINE_MS;

  const cancel = new AbortController();
  const stopped = new AbortController();
  let gone = false;

  // Ein DB-Fehler beim Nachschauen ist KEIN Abbruch: Ein Netzwackler würde einen bezahlten Lauf verwerfen.
  const checkCancelled = async () => {
    try {
      const status = await store.analysisStatus(analysisId);
      if (status === null) gone = true;
      if (status !== "running") cancel.abort();
    } catch (e) {
      log.warn(`Cancel-Poll für ${analysisId} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const poll = (async () => {
    while (!stopped.signal.aborted) {
      await clock.sleep(CANCEL_POLL_MS, stopped.signal);
      if (!stopped.signal.aborted) await checkCancelled();
    }
  })();

  let job: StageJob | null = null;
  let parts: StagePart[] = [];
  let finishedAtStart = 0;
  /** Überlast: Die Etappe stand nicht still, sie musste warten. Die Pause überlebt die Übergabe. */
  let pauseUntil = 0;
  let overloaded = false;

  const finishedCount = () => parts.filter((p) => p.status === "done" || p.status === "failed").length;
  const hasSavedItems = () => parts.some((p) => (p.items?.length ?? 0) > 0);

  const update = async (patch: JobPatch) => {
    const ok = await store.updateJob(analysisId, leaseId, patch);
    if (!ok) throw new LeaseLost();
    if (job) job = { ...job, ...patch } as StageJob;
  };

  const costNow = () => deps.model.cost(totalUsage(parts, job?.consolidation_usage ?? null));
  /** Für die Kostengrenze: Gemessenes plus Pauschale für Versuche ohne verlässliche Abrechnung. */
  const spendNow = () => costNow() + parts.reduce((sum, p) => sum + p.unmetered_attempts, 0) * LOST_ATTEMPT_USD;

  /** Bezahlte Ergebnisse gehen nicht wegen eines Netzwacklers verloren. Lease-Verlust ist endgültig. */
  const withRetries = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof LeaseLost || attempt >= SAVE_ATTEMPTS) throw e;
        log.warn(`Speichern für ${analysisId}, Versuch ${attempt}: ${e instanceof Error ? e.message : String(e)}`);
        await clock.sleep(500 * 3 ** (attempt - 1));
      }
    }
  };
  const savePart = async (position: number, expectedLease: string | null, patch: PartPatch) => {
    const saved = await withRetries(() => store.savePart(analysisId, position, expectedLease, patch));
    if (!saved) throw new LeaseLost();
  };

  /** Kosten und Lebenszeichen auf der Analyse. JSON-Pfad, damit der Admin ohne Migration lesen kann. */
  const heartbeat = async () => {
    if (!job) return;
    await store.writeProgress(analysisId, costNow(), {
      run_id: job.run_id,
      last_activity_at: new Date(clock.now()).toISOString(),
      stages: stagesInfo(job, parts),
    });
  };

  const activeMs = () => (job?.active_ms ?? 0) + (clock.now() - startedAt);

  const stopCancelled = async (): Promise<StageResult> => {
    if (gone || !job) return "gone";
    await closeCancelled(deps, job, parts);
    return "cancelled";
  };

  const handOff = async (madeProgress: boolean): Promise<StageResult> => {
    if (!job) return "gone";
    await update({
      // Warten auf Überlast ist kein Stillstand. Die Grenze dafür ist overload_wait_ms.
      no_progress_stages: madeProgress || overloaded ? 0 : job.no_progress_stages + 1,
      crash_count: 0,
      active_ms: activeMs(),
    });
    await checkCancelled();
    if (cancel.signal.aborted) return stopCancelled();
    const delayMs = Math.max(0, pauseUntil - clock.now());
    const released = await store.releaseLease(analysisId, leaseId, delayMs);
    if (!released) return "lease_lost";
    // Mit Pause stösst der Wächter zur fälligen Zeit an, der Browser ebenso.
    if (job.dispatch_url && delayMs === 0) {
      const sent = await deps.dispatcher.dispatch(analysisId);
      // Auslöser dauerhaft weg: ehrlich auf den Browser wechseln statt «läuft im Hintergrund» zu melden.
      if (sent === "unavailable") await store.clearDispatchUrl(analysisId);
    }
    return "handed_off";
  };

  /** Offene Teile endgültig als gescheitert markieren. Ihr Grund steht im Bericht. */
  const failOpen = async (reason: string) => {
    for (const part of parts) {
      if (part.status !== "pending" && part.status !== "running") continue;
      const call = part.call ? { ...part.call, ok: false, error: part.call.error ?? reason } : syntheticCall(part, reason);
      const patch: PartPatch = { status: "failed", lease_id: null, call };
      const ok = await store.savePart(analysisId, part.position, part.lease_id, patch);
      if (ok) Object.assign(part, patch);
    }
    await update({ parts_done: finishedCount(), last_progress_at: new Date(clock.now()).toISOString() });
  };

  try {
    await checkCancelled();
    job = await store.loadJob(analysisId, leaseId);
    if (!job) {
      await checkCancelled();
      return gone ? "gone" : "lease_lost";
    }
    parts = job.phase === "prepare" ? [] : await store.listParts(analysisId);
    finishedAtStart = finishedCount();
    if (input.source === "resume") await update({ resumes: job.resumes + 1 });
    if (cancel.signal.aborted) return await stopCancelled();
    await heartbeat();

    if (job.state_version > STATE_VERSION) {
      await closeWithError(deps, job, parts, "Analyse wurde mit einer neueren Programmversion gestartet und kann hier nicht fortgesetzt werden.");
      return "finished";
    }

    // Auch Funktionen, die ohne Freigabe gestorben sind, zählen (Claim in der Datenbank).
    // Gespeicherte Teile sind bezahlt: Mit ihnen abschliessen statt alles zu verwerfen, ohne weitere Modellkosten.
    if (job.crash_count >= MAX_CRASH_STAGES) {
      if (!hasSavedItems() || job.crash_count >= MAX_CRASH_STAGES_HARD) {
        await closeWithError(deps, job, parts, REASON_CRASHES);
        return "finished";
      }
      await failOpen(REASON_CRASHES);
      if (job.phase !== "finalize") {
        const raw = rawItems(parts);
        await update({
          final_items: raw,
          consolidation: { applied: false, raw_count: raw.length, merged: 0, downgraded: 0, error: REASON_CRASHES, duration_ms: 0 },
          phase: "finalize",
          last_progress_at: new Date(clock.now()).toISOString(),
        });
      }
    }

    // Sicherheitsgrenzen: Eine Kette läuft nie endlos.
    if (job.stage_no > MAX_STAGES || job.no_progress_stages >= MAX_NO_PROGRESS_STAGES) {
      if (!job.snapshot) {
        await closeWithError(deps, job, parts, "Analyse konnte nicht vorbereitet werden.");
        return "finished";
      }
      await failOpen(REASON_STAGES);
      if (job.phase === "parts") await update({ phase: "consolidate", last_progress_at: new Date(clock.now()).toISOString() });
    }

    // ── Vorbereitung ──────────────────────────────────────────────────────────
    if (job.phase === "prepare") {
      let prepared;
      try {
        prepared = await deps.prepare(job, cancel.signal);
      } catch (e) {
        if (cancel.signal.aborted) return await stopCancelled();
        const message = e instanceof Error ? e.message : "Analyse fehlgeschlagen";
        log.error(`Analyse ${analysisId}: Vorbereitung fehlgeschlagen`, e);
        await closeWithError(deps, job, parts, message);
        return "finished";
      }
      if (cancel.signal.aborted) return await stopCancelled();
      await store.replaceParts(analysisId, prepared.units);
      await update({
        snapshot: prepared.snapshot,
        signed_urls: prepared.signed_urls,
        urls_expire_at: prepared.urls_expire_at,
        phase: "parts",
        parts_total: prepared.units.length,
        parts_done: 0,
        last_progress_at: new Date(clock.now()).toISOString(),
      });
      parts = await store.listParts(analysisId);
    }

    // ── Teile ─────────────────────────────────────────────────────────────────
    if (job.phase === "parts") {
      const before = finishedCount();
      const r = await runParts();
      if (r === "cancelled") return await stopCancelled();
      const open = parts.filter((p) => p.status === "pending" || p.status === "running").length;
      if (open > 0) {
        return await handOff(finishedCount() > before);
      }
      await update({ phase: "consolidate", last_progress_at: new Date(clock.now()).toISOString() });
    }

    // ── Konsolidierung ────────────────────────────────────────────────────────
    if (job.phase === "consolidate") {
      const r = await runConsolidation();
      if (r === "cancelled") return await stopCancelled();
      if (r === "handoff") return await handOff(true);
    }

    // ── Abschluss ─────────────────────────────────────────────────────────────
    await checkCancelled();
    if (cancel.signal.aborted) return await stopCancelled();
    const finished = await finalizeRun(deps, job, parts, activeMs());
    if (finished === "gone") {
      await checkCancelled();
      return await stopCancelled();
    }
    return "finished";
  } catch (e) {
    if (e instanceof LeaseLost) {
      await checkCancelled();
      return gone ? "gone" : "lease_lost";
    }
    log.error(`Etappe von Analyse ${analysisId} abgebrochen`, e);
    // Kein direkter Anstoss: Der Wächter oder der Browser kommt nach dem Backoff. Mit Fortschritt zählt der
    // Absturz neu, damit bezahlte Arbeit nicht verworfen wird, solange die Analyse vorankommt.
    try {
      const crashes = finishedCount() > finishedAtStart ? 1 : (job?.crash_count ?? 0) + 1;
      // Mit gespeicherten Teilen schliesst die nächste Etappe ab (Prüfung am Anfang von runStage).
      if (job && crashes >= MAX_CRASH_STAGES && !hasSavedItems()) {
        await closeWithError(deps, job, parts, REASON_CRASHES);
        return "finished";
      }
      if (job) await store.updateJob(analysisId, leaseId, { crash_count: crashes });
      await store.releaseLease(analysisId, leaseId, crashBackoffMs(crashes));
    } catch {
      // Datenbank nicht erreichbar: Der Lease läuft von selbst ab, der nächste Claim zählt den Absturz.
      log.warn(`Lease von ${analysisId} nicht freigegeben, läuft von selbst ab.`);
    }
    return "crashed";
  } finally {
    stopped.abort();
    await poll;
  }

  // ── Teile: Worker-Pool statt Wellen ─────────────────────────────────────────
  async function runParts(): Promise<"ok" | "cancelled"> {
    const current = job!;
    const snapshot = current.snapshot!;
    let signedUrls = current.signed_urls ?? [];
    let urlGeneration = 0;
    let resignedThisStage = false;

    // Reste einer abgestürzten Etappe. Die Antwort ist verloren, der Versuch war vielleicht bezahlt.
    for (const part of parts) {
      if (part.status !== "running" || part.lease_id === leaseId) continue;
      const unmetered = part.unmetered_attempts + 1;
      const patch: PartPatch = part.attempts >= MAX_PART_ATTEMPTS
        ? { status: "failed", lease_id: null, unmetered_attempts: unmetered, call: part.call ?? syntheticCall(part, "Mehrfach ohne Antwort abgebrochen") }
        : { status: "pending", lease_id: null, unmetered_attempts: unmetered };
      const ok = await store.savePart(analysisId, part.position, part.lease_id, patch);
      if (ok) Object.assign(part, patch);
    }

    const resign = async () => {
      const fresh = await deps.signUrls(current.files);
      signedUrls = fresh.signed_urls;
      urlGeneration++;
      await update({ signed_urls: fresh.signed_urls, urls_expire_at: fresh.urls_expire_at });
    };
    const expiresAt = current.urls_expire_at ? Date.parse(current.urls_expire_at) : 0;
    if (expiresAt - clock.now() < URL_RESIGN_MIN_REMAINING_MS) await resign();

    const filesNow = (): PlanFile[] => current.files.map((f, i) => toPlanFile(f, signedUrls[i]));
    const completeIds = new Set(snapshot.reference_complete_ids);

    const queue = parts.filter((p) => p.status === "pending").sort((a, b) => a.position - b.position);
    let concurrency = Math.max(1, deps.config.maxConcurrency);
    const state: { stopReason: string | null; writeError: unknown } = {
      // Eine Wiederaufnahme über der Kostengrenze startet keinen Aufruf mehr.
      stopReason: spendNow() >= deps.config.maxRunCostUsd ? REASON_COST : null,
      writeError: null,
    };
    let coldCounted = false;
    /** Reserve je laufendem Aufruf. Der teuerste gemessene Teil geht vor (erster Aufruf schreibt den Cache). */
    const reserveUsd = () => parts.reduce(
      (max, p) => Math.max(max, deps.model.cost({
        input_tokens: p.input_tokens, cache_write_tokens: p.cache_write_tokens, cache_read_tokens: p.cache_read_tokens, output_tokens: p.output_tokens,
      })),
      RESERVE_CALL_USD,
    );
    let overloadWaitMs = current.overload_wait_ms;

    // Erster Aufruf allein: Parallele Anfragen können nicht lesen, was ein anderer gerade schreibt.
    let gateOpen = false;
    let openGate: () => void = () => {};
    const gatePromise = new Promise<void>((resolve) => {
      openGate = () => { gateOpen = true; resolve(); };
    });

    // Speichern nacheinander: Sonst überholt ein älterer Stand einen neueren.
    let serial: Promise<unknown> = Promise.resolve();
    const inSeries = <T>(fn: () => Promise<T>): Promise<T> => {
      const next = serial.then(fn, fn);
      serial = next.catch(() => undefined);
      return next;
    };

    const inflight = new Set<Promise<void>>();

    const settle = async (part: StagePart, outcome: CallOutcome, generation: number) => {
      const merged = mergeAttempt(part, outcome);
      const r = outcome.result;
      let patch: PartPatch;
      // Erst nach dem Speichern in die Warteschlange: Sonst startet ein Teil, dessen Stand noch nicht steht.
      let requeue: "back" | "front" | null = null;
      // Abgebrochener Stream oder Netzfehler: Der Zähler ist nur eine Untergrenze.
      const unmetered = outcome.error_class === "timeout" || outcome.error_class === "transient"
        ? { unmetered_attempts: part.unmetered_attempts + 1 }
        : {};

      if (r.ok) {
        patch = { status: "done", lease_id: null, items: merged.items, call: merged.call, next_effort: null, ...merged.tokens };
      } else {
        const cut = r.duration_ms < PER_CALL_BUDGET_MS - 1_000;
        let decision = decideOnFailure(outcome.error_class, part.attempts, cut);
        if (cancel.signal.aborted) decision = { action: "stop" };

        if (decision.action === "refetch") {
          // Einmal je Etappe neu signieren. Aufrufe mit der alten URL gehen einfach zurück in die Warteschlange.
          if (generation !== urlGeneration) {
            decision = { action: "retry" };
          } else if (!resignedThisStage) {
            resignedThisStage = true;
            await resign();
            decision = { action: "retry" };
          } else {
            decision = { action: "fail" };
          }
        }

        switch (decision.action) {
          case "retry":
            patch = {
              status: "pending", lease_id: null, items: merged.items, call: merged.call, ...merged.tokens, ...unmetered,
              next_effort: decision.next_effort ?? part.next_effort,
            };
            requeue = "back";
            break;
          case "overload": {
            // Versuch zählt nicht. Der Teil kommt zuerst dran, sobald die Pause um ist.
            patch = { status: "pending", lease_id: null, attempts: Math.max(0, part.attempts - 1), ...merged.tokens };
            requeue = "front";
            overloaded = true;
            concurrency = Math.max(MIN_OVERLOAD_CONCURRENCY, Math.floor(concurrency / 2));
            const now = clock.now();
            const until = now + (outcome.retry_after_ms ?? DEFAULT_OVERLOAD_WAIT_MS);
            const added = Math.max(0, until - Math.max(pauseUntil, now));
            pauseUntil = Math.max(pauseUntil, until);
            overloadWaitMs += added;
            if (overloadWaitMs > MAX_OVERLOAD_WAIT_MS) state.stopReason = REASON_OVERLOAD;
            break;
          }
          case "fatal":
            patch = { status: "failed", lease_id: null, items: merged.items, call: merged.call, ...merged.tokens };
            state.stopReason = REASON_ACCOUNT;
            break;
          case "stop":
            patch = { status: "pending", lease_id: null, ...merged.tokens };
            break;
          default:
            patch = { status: "failed", lease_id: null, items: merged.items, call: merged.call, ...merged.tokens, ...unmetered };
        }
      }

      await savePart(part.position, leaseId, patch);
      Object.assign(part, patch);
      if (requeue === "back") queue.push(part);
      if (requeue === "front") queue.unshift(part);

      const cold = !coldCounted && r.cache_write_tokens > 0;
      if (cold) coldCounted = true;
      await withRetries(() => update({
        parts_done: finishedCount(),
        overload_wait_ms: overloadWaitMs,
        ...(cold ? { cold_stages: job!.cold_stages + 1 } : {}),
        // Fortschritt: Die Analyse kommt voran, frühere Abstürze zählen nicht mehr.
        ...(r.ok && job!.crash_count > 0 ? { crash_count: 0 } : {}),
        ...(r.ok || part.status === "failed" ? { last_progress_at: new Date(clock.now()).toISOString() } : {}),
      }));
      // Nur Lebenszeichen und Zwischenstand: Das Ergebnis ist gespeichert, die Kosten stimmen beim nächsten Mal.
      await heartbeat().catch((e) => log.warn(`Lebenszeichen für ${analysisId}: ${e instanceof Error ? e.message : String(e)}`));
      if (!state.stopReason && spendNow() >= deps.config.maxRunCostUsd) state.stopReason = REASON_COST;
    };

    const start = async (part: StagePart, isFirst: boolean) => {
      const attempts = part.attempts + 1;
      const generation = urlGeneration;
      await savePart(part.position, null, { status: "running", attempts, lease_id: leaseId });
      Object.assign(part, { status: "running", attempts, lease_id: leaseId });
      const outcome = await deps.model.callPart({
        unit: part.unit,
        boundary: snapshot.boundary,
        system: snapshot.system,
        referenceText: snapshot.reference_text,
        files: filesNow(),
        inReference: completeIds.has(part.unit.norm.id),
        deadlineAt,
        // Die Engine meldet das Tor auch beim Scheitern. Einen Takt warten, damit ein Kontofehler des
        // ersten Aufrufs ausgewertet ist, bevor die übrigen sinnlos starten.
        onPrefillDone: isFirst ? () => { void clock.sleep(0).then(openGate); } : null,
        effort: part.next_effort,
        signal: cancel.signal,
      });
      if (isFirst) openGate();
      await inSeries(() => settle(part, outcome, generation));
    };

    let started = 0;

    while (true) {
      if (state.writeError) break;
      const stop = cancel.signal.aborted || state.stopReason !== null;
      const now = clock.now();
      // Vor dem Aufruf prüfen und laufende Aufrufe reservieren: Sonst überzieht eine Welle die Grenze.
      const reserve = reserveUsd();
      const budgetOk = spendNow() + (inflight.size + 1) * reserve <= deps.config.maxRunCostUsd;
      if (!stop && !budgetOk && inflight.size === 0 && queue.length > 0) {
        state.stopReason = REASON_COST;
        continue;
      }
      const canStart =
        !stop &&
        budgetOk &&
        queue.length > 0 &&
        (started === 0 || gateOpen) &&
        inflight.size < concurrency &&
        now >= pauseUntil &&
        mayStartCall(deadlineAt - now, longestCall(parts));

      if (canStart) {
        const part = queue.shift()!;
        const isFirst = started === 0;
        started++;
        const task: Promise<void> = start(part, isFirst)
          .catch((e) => { state.writeError = state.writeError ?? e; })
          .finally(() => { inflight.delete(task); });
        inflight.add(task);
        if (isFirst) void clock.sleep(PREFILL_GATE_MAX_MS, stopped.signal).then(() => openGate());
        continue;
      }

      if (inflight.size === 0) {
        if (stop || queue.length === 0) break;
        // Nur noch die Überlast-Pause steht im Weg, und danach reicht die Zeit noch.
        if (now < pauseUntil && mayStartCall(deadlineAt - pauseUntil, longestCall(parts))) {
          await clock.sleep(pauseUntil - now, cancel.signal);
          continue;
        }
        break;
      }

      const waits: Promise<unknown>[] = Array.from(inflight);
      if (!stop && queue.length > 0 && !gateOpen) waits.push(gatePromise);
      if (!stop && queue.length > 0 && now < pauseUntil) waits.push(clock.sleep(pauseUntil - now, cancel.signal));
      await Promise.race(waits);
    }

    await Promise.allSettled(inflight);
    if (state.writeError) throw state.writeError;
    if (cancel.signal.aborted) return "cancelled";
    if (state.stopReason) await failOpen(state.stopReason);
    return "ok";
  }

  // ── Konsolidierung: eigener Schritt, nach einem Absturz nichts doppelt bezahlen ─
  async function runConsolidation(): Promise<"ok" | "handoff" | "cancelled"> {
    const snapshot = job!.snapshot!;
    const raw = rawItems(parts);
    const { callMs, maxTokens } = consolidationBudget(raw.length);

    while (true) {
      const current = job!;
      if (current.consolidation_attempts >= MAX_CONSOLIDATION_ATTEMPTS) {
        // Zweimal gescheitert: Rohpunkte übernehmen, der Bericht sagt es.
        const fallback: ConsolidationResult = current.consolidation ?? {
          applied: false, raw_count: raw.length, merged: 0, downgraded: 0, error: "Konsolidierung gescheitert", duration_ms: 0,
        };
        await update({
          final_items: raw,
          consolidation: { ...fallback, applied: false },
          phase: "finalize",
          last_progress_at: new Date(clock.now()).toISOString(),
        });
        return "ok";
      }

      // Kostengrenze: Der Aufruf ist nur eine Bereinigung und darf sie nicht überschreiten.
      const estimate = deps.model.cost({ input_tokens: raw.length * 150, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: maxTokens });
      if (raw.length >= 2 && spendNow() + estimate > deps.config.maxRunCostUsd) {
        await update({
          final_items: raw,
          consolidation: { applied: false, raw_count: raw.length, merged: 0, downgraded: 0, error: REASON_COST, duration_ms: 0 },
          phase: "finalize",
          last_progress_at: new Date(clock.now()).toISOString(),
        });
        return "ok";
      }

      if (deadlineAt - clock.now() < callMs + 10_000) return "handoff";

      await update({ consolidation_attempts: current.consolidation_attempts + 1 });
      // Die Konsolidierung verändert ihre Eingabe, die Rohpunkte müssen unberührt bleiben.
      const c = await deps.model.consolidate({
        items: structuredClone(raw),
        norms: snapshot.norms,
        deadlineAt,
        signal: cancel.signal,
        callMs,
        maxTokens,
      });
      const prior: UsageTotals = job!.consolidation_usage ?? { input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
      const usage: UsageTotals = {
        input_tokens: prior.input_tokens + c.usage.input_tokens,
        cache_write_tokens: prior.cache_write_tokens + c.usage.cache_write_tokens,
        cache_read_tokens: prior.cache_read_tokens + c.usage.cache_read_tokens,
        output_tokens: prior.output_tokens + c.usage.output_tokens,
      };
      if (cancel.signal.aborted) {
        await update({ consolidation_usage: usage });
        return "cancelled";
      }
      if (c.result.applied) {
        await update({
          final_items: c.items,
          consolidation: c.result,
          consolidation_usage: usage,
          phase: "finalize",
          last_progress_at: new Date(clock.now()).toISOString(),
        });
        await heartbeat();
        return "ok";
      }
      await update({ consolidation: c.result, consolidation_usage: usage });
      await heartbeat();
    }
  }
}
