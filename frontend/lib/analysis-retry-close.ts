/** Supabase-Adapter zum Schliessen eines verwaisten Laufs vor «Erneut versuchen». Nur serverseitig. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEASE_SECONDS } from "./analysis-stages/budget";
import { closeWithError } from "./analysis-stages/finalize";
import { stageDeps } from "./analysis-stages/runtime";
import { orphanFilter } from "./admin-analyses/orphan";
import { failureFields, updateClosing } from "./analysis-failure";
import { isMissingSchema } from "./supabase/schema-errors";
import type { OrphanCloseDeps } from "./analysis-retry";

export function supabaseOrphanDeps(admin: SupabaseClient, resultJson: Record<string, unknown> | null): OrphanCloseDeps {
  const deps = stageDeps(admin);
  return {
    async claimJob(analysisId, leaseId) {
      const { data, error } = await admin.from("analysis_jobs").select("analysis_id").eq("analysis_id", analysisId).maybeSingle();
      if (error) {
        if (isMissingSchema(error.message)) return "none";
        throw new Error(error.message);
      }
      if (!data) return "none";
      // Derselbe atomare Claim wie bei einer Etappe: Danach claimt weder Wächter noch Browser.
      const claimed = await deps.store.claim(analysisId, null, leaseId, LEASE_SECONDS);
      return claimed ? "claimed" : "busy";
    },
    async closeClaimed(analysisId, leaseId, reason) {
      const job = await deps.store.loadJob(analysisId, leaseId);
      if (!job) return false;
      const parts = job.phase === "prepare" ? [] : await deps.store.listParts(analysisId);
      // Bisherige Kosten aus den Teilen bleiben verbucht, der Job wird entfernt.
      await closeWithError(deps, job, parts, reason);
      return (await deps.store.analysisStatus(analysisId)) !== "running";
    },
    async closeWithoutJob(analysisId, cutoffIso, reason) {
      const fields = failureFields(reason, Date.now(), { ...(resultJson ?? {}), timed_out: true });
      const { data, error } = await updateClosing(fields, (f) =>
        admin.from("analyses").update(f).eq("id", analysisId).eq("status", "running").or(orphanFilter(cutoffIso)).select("id"));
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },
  };
}
