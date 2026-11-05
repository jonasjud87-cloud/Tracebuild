import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import type { AuthUser } from "@/lib/auth";
import { ORPHAN_AFTER_MS, TIMEOUT_ERROR_TEXT } from "./constants";
import { orphanFilter } from "./orphan";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import type { CancelResponse } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export type CancelResult =
  | { ok: true; data: CancelResponse }
  | { ok: false; status: number; error: string };

interface ProjectRef {
  id: string;
  org_id: string;
}

interface Target {
  id: string;
  status: string;
  created_at: string;
  result_json: Record<string, unknown> | null;
  documents: { projects: ProjectRef | ProjectRef[] | null } | { projects: ProjectRef | ProjectRef[] | null }[] | null;
}

function pick<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export async function cancelAnalysis(admin: Admin, id: string, actor: AuthUser, now: Date): Promise<CancelResult> {
  const { data, error } = await admin
    .from("analyses")
    .select("id,status,created_at,result_json,documents!inner(projects!inner(id,org_id))")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Analyse nicht gefunden" };

  const target = data as unknown as Target;
  if (target.status !== "running") {
    return { ok: false, status: 409, error: `Analyse läuft nicht mehr (Status: ${target.status})` };
  }

  const project = pick(pick(target.documents)?.projects);
  const cutoff = new Date(now.getTime() - ORPHAN_AFTER_MS).toISOString();
  // Massgebend ist das letzte Lebenszeichen: Eine gesunde lange Analyse wird nicht als Zeitüberschreitung geschlossen.
  const lastActivity = target.result_json?.last_activity_at;
  const activityBase = typeof lastActivity === "string" && lastActivity ? lastActivity : target.created_at;
  const orphaned = Date.parse(activityBase) < Date.parse(cutoff);
  const newStatus: CancelResponse["status"] = orphaned ? "error" : "cancelled";

  const fields = orphaned
    ? {
        status: "error",
        result_json: { ...(target.result_json ?? {}), error: TIMEOUT_ERROR_TEXT, timed_out: true, closed_by_admin: true },
      }
    : { status: "cancelled" };
  const closeRow = (row: Record<string, unknown>) => {
    const update = admin.from("analyses").update(row).eq("id", id).eq("status", "running");
    return (orphaned ? update.or(orphanFilter(cutoff)) : update).select("id");
  };
  let { data: changed, error: updateError } = await closeRow({ ...fields, finished_at: now.toISOString() });
  // finished_at fehlt, solange die Monitor-Migration nicht eingespielt ist.
  if (updateError && isMissingSchema(updateError.message)) ({ data: changed, error: updateError } = await closeRow(fields));
  if (updateError) return { ok: false, status: 500, error: updateError.message };
  if (!changed || changed.length === 0) {
    return { ok: false, status: 409, error: "Der Status hat sich inzwischen geändert. Bitte neu laden." };
  }

  await logAudit(admin, {
    orgId: project?.org_id ?? null,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "analysis_run",
    targetId: id,
    meta: {
      op: orphaned ? "admin_timeout" : "admin_cancel",
      previousStatus: "running",
      newStatus,
      projectId: project?.id ?? null,
    },
  });

  return { ok: true, data: { id, outcome: orphaned ? "timed_out" : "cancelled", status: newStatus } };
}
