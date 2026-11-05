/** Adapter: Jobzustand in Supabase. Nur benannte Spalten, nie select("*"): Die Zeilen enthalten signierte URLs. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimResult, ItemRow, JobPatch, JobStore, PartPatch, StageJob, StagePart } from "./ports";
import type { StageUnit } from "./plan";

const JOB_COLUMNS = [
  "analysis_id", "project_id", "org_id", "actor_id", "actor_email", "run_id", "state_version", "phase", "stage_no",
  "no_progress_stages", "resumes", "active_ms", "dispatch_url", "snapshot", "files", "signed_urls", "urls_expire_at",
  "preflight", "parts_total", "parts_done", "consolidation", "consolidation_attempts", "consolidation_usage",
  "final_items", "overload_wait_ms", "created_at",
].join(",");

const PART_COLUMNS = [
  "position", "unit", "status", "attempts", "unmetered_attempts", "next_effort", "lease_id", "items", "call",
  "input_tokens", "cache_write_tokens", "cache_read_tokens", "output_tokens",
].join(",");

export function createSupabaseStore(admin: SupabaseClient): JobStore {
  return {
    async claim(analysisId, tokenHash, leaseId, leaseSeconds): Promise<ClaimResult | null> {
      const { data, error } = await admin.rpc("analysis_claim_stage", {
        p_analysis_id: analysisId,
        p_token_hash: tokenHash,
        p_lease_id: leaseId,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as ClaimResult[];
      return rows[0] ?? null;
    },

    async loadJob(analysisId, leaseId) {
      const { data, error } = await admin
        .from("analysis_jobs")
        .select(JOB_COLUMNS)
        .eq("analysis_id", analysisId)
        .eq("lease_id", leaseId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as StageJob | null) ?? null;
    },

    async updateJob(analysisId, leaseId, patch: JobPatch) {
      const { data, error } = await admin
        .from("analysis_jobs")
        .update(patch)
        .eq("analysis_id", analysisId)
        .eq("lease_id", leaseId)
        .select("analysis_id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },

    async releaseLease(analysisId, leaseId, nowIso) {
      const { data, error } = await admin
        .from("analysis_jobs")
        .update({ lease_id: null, lease_until: null, waiting_since: nowIso, next_dispatch_at: nowIso })
        .eq("analysis_id", analysisId)
        .eq("lease_id", leaseId)
        .select("analysis_id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },

    async clearDispatchUrl(analysisId) {
      const { error } = await admin.from("analysis_jobs").update({ dispatch_url: null }).eq("analysis_id", analysisId);
      if (error) throw new Error(error.message);
    },

    async deleteJob(analysisId) {
      const { error } = await admin.from("analysis_jobs").delete().eq("analysis_id", analysisId);
      if (error) throw new Error(error.message);
    },

    async analysisStatus(analysisId) {
      const { data, error } = await admin.from("analyses").select("status").eq("id", analysisId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { status: string } | null)?.status ?? null;
    },

    async replaceParts(analysisId, units: StageUnit[]) {
      // Eine abgestürzte Vorbereitung darf wiederholt werden.
      const { error: delError } = await admin.from("analysis_job_parts").delete().eq("analysis_id", analysisId);
      if (delError) throw new Error(delError.message);
      const { error } = await admin
        .from("analysis_job_parts")
        .insert(units.map((unit, position) => ({ analysis_id: analysisId, position, unit })));
      if (error) throw new Error(error.message);
    },

    async listParts(analysisId) {
      const { data, error } = await admin
        .from("analysis_job_parts")
        .select(PART_COLUMNS)
        .eq("analysis_id", analysisId)
        .order("position");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as StagePart[];
    },

    async savePart(analysisId, position, expectedLease, patch: PartPatch) {
      const query = admin
        .from("analysis_job_parts")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("analysis_id", analysisId)
        .eq("position", position);
      const { data, error } = await (expectedLease === null ? query.is("lease_id", null) : query.eq("lease_id", expectedLease))
        .select("position");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },

    async writeProgress(analysisId, costUsd, resultJson) {
      const { error } = await admin
        .from("analyses")
        .update({ cost_usd: costUsd, result_json: resultJson })
        .eq("id", analysisId)
        .eq("status", "running");
      if (error) throw new Error(error.message);
    },

    async existingNormIds(ids) {
      const { data, error } = await admin.from("norms").select("id").in("id", ids);
      if (error) throw new Error(error.message);
      return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    },

    async deleteItems(analysisId) {
      const { error } = await admin.from("analysis_items").delete().eq("analysis_id", analysisId);
      if (error) throw new Error(error.message);
    },

    async insertItems(rows: ItemRow[]) {
      const { error } = await admin.from("analysis_items").insert(rows);
      return error ? error.message : null;
    },

    async closeAnalysis(analysisId, fields) {
      const { data, error } = await admin
        .from("analyses")
        .update(fields)
        .eq("id", analysisId)
        .eq("status", "running")
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },

    async recordCancelled(analysisId, fields) {
      // Der vom Admin gesetzte Abschluss (error) behält seinen Text, nur die Kosten kommen dazu.
      const { error } = await admin
        .from("analyses")
        .update(fields)
        .eq("id", analysisId)
        .eq("status", "cancelled");
      if (error) throw new Error(error.message);
      const { error: costError } = await admin
        .from("analyses")
        .update({ cost_usd: fields.cost_usd })
        .eq("id", analysisId)
        .eq("status", "error");
      if (costError) throw new Error(costError.message);
    },
  };
}
