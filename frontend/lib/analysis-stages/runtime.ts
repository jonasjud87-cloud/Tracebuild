/** Verdrahtung für die Routen: echte Adapter, Job anlegen, Etappe per waitUntil starten. */
import { waitUntil } from "@vercel/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/auditLog";
import { MAX_CONCURRENCY } from "@/lib/analysis-engine";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { maxRunCostUsd } from "./budget";
import type { AnalysisPreflight } from "./contract";
import { createDispatcher } from "./dispatcher-pgnet";
import { dispatchUrl } from "./dispatch-url";
import { createAnthropicModel } from "./model-anthropic";
import type { Clock, JobFile, StageDeps, StageSource } from "./ports";
import { prepareRun, signPlanFiles } from "./prepare";
import { claimStage, runStage } from "./run-stage";
import { createSupabaseStore } from "./store-supabase";

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      signal?.addEventListener("abort", done, { once: true });
    }),
};

export function stageDeps(admin: SupabaseClient): StageDeps {
  return {
    store: createSupabaseStore(admin),
    model: createAnthropicModel(),
    dispatcher: createDispatcher(admin),
    clock: realClock,
    prepare: (job, signal) => prepareRun(admin, job, signal),
    signUrls: (files) => signPlanFiles(admin, files),
    audit: ({ job, status, itemCount, error }) =>
      logAudit(admin, {
        orgId: job.org_id,
        actorId: job.actor_id ?? "",
        actorEmail: job.actor_email ?? "",
        action: "analysis_run",
        targetId: job.analysis_id,
        meta: { projectId: job.project_id, status, ...(itemCount !== undefined ? { itemCount } : {}), ...(error ? { error } : {}) },
      }),
    log: {
      warn: (message) => console.warn(message),
      error: (message, e) => console.error(message, e ?? ""),
    },
    config: { maxConcurrency: MAX_CONCURRENCY, maxRunCostUsd: maxRunCostUsd() },
  };
}

export type CreateJobResult = "created" | "missing_schema" | "conflict";

interface NewJob {
  analysisId: string;
  projectId: string;
  orgId: string;
  actorId: string;
  actorEmail: string;
  runId: string | null;
  files: JobFile[];
  preflight: AnalysisPreflight | null;
}

/** Legt den Job an. UNIQUE (project_id) verhindert eine zweite laufende Analyse im Projekt. */
export async function createJob(admin: SupabaseClient, job: NewJob): Promise<CreateJobResult> {
  const deps = createDispatcher(admin);
  const url = dispatchUrl();
  // Nur mit Wächter ist «läuft im Hintergrund» wahr. Sonst bleibt die URL leer und der Browser trägt.
  const dispatch_url = url && (await deps.available()) ? url : null;
  const row = {
    analysis_id: job.analysisId,
    project_id: job.projectId,
    org_id: job.orgId,
    actor_id: job.actorId,
    actor_email: job.actorEmail,
    run_id: job.runId,
    files: job.files,
    preflight: job.preflight,
    dispatch_url,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin.from("analysis_jobs").insert(row);
    if (!error) return "created";
    if (isMissingSchema(error.message)) return "missing_schema";
    if (error.code !== "23505") throw new Error(error.message);

    // Der Blocker gehört vielleicht zu einer Analyse, die nicht mehr läuft: wegräumen, einmal wiederholen.
    const { data: blocker, error: blockerError } = await admin
      .from("analysis_jobs")
      .select("analysis_id, analyses!inner(status)")
      .eq("project_id", job.projectId)
      .maybeSingle();
    if (blockerError) throw new Error(blockerError.message);
    const analyses = (blocker as unknown as { analyses: { status: string } | { status: string }[] } | null)?.analyses;
    const status = Array.isArray(analyses) ? analyses[0]?.status : analyses?.status;
    if (blocker && status === "running") return "conflict";
    if (blocker) {
      const { error: delError } = await admin.from("analysis_jobs").delete().eq("analysis_id", (blocker as { analysis_id: string }).analysis_id);
      if (delError) throw new Error(delError.message);
    }
  }
  return "conflict";
}

/**
 * Claim und Start in einem. true = Etappe läuft. Wirft nur bei DB-Fehlern des Claims.
 * `startedAtMs`: Beginn der Anfrage, denn waitUntil teilt sich die 300 s mit ihr.
 * Hash des Einmal-Tokens wird nie geloggt.
 */
export async function startStage(
  admin: SupabaseClient,
  analysisId: string,
  tokenHash: string | null,
  source: StageSource,
  startedAtMs: number,
): Promise<boolean> {
  const deps = stageDeps(admin);
  const leaseId = crypto.randomUUID();
  const claim = await claimStage(deps.store, analysisId, tokenHash, leaseId);
  if (!claim) return false;
  waitUntil(
    runStage(deps, { analysisId, leaseId, source, startedAtMs }).catch((e) => {
      console.error(`Etappe von Analyse ${analysisId} abgestürzt:`, e);
    }),
  );
  return true;
}
