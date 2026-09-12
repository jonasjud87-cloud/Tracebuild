import { createAdminClient } from "@/lib/supabase/admin";

export type AuditAction =
  | "invite" | "reinvite" | "role_change" | "remove"
  | "project_create" | "project_delete" | "project_update"
  | "project_member_add" | "project_member_remove"
  | "org_create" | "org_update" | "org_delete" | "org_status_change"
  | "norm_delete" | "norm_promote" | "norm_upload_platform"
  | "norm_upload" | "norm_remove" | "norm_custom_create"
  | "norm_refresh" | "project_norm_add" | "project_norm_remove"
  | "analysis_run" | "analysis_delete" | "chat_message";

export async function logAudit(
  admin: ReturnType<typeof createAdminClient>,
  entry: {
    orgId: string | null;
    actorId: string;
    actorEmail: string;
    action: AuditAction;
    targetId?: string;
    targetEmail?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("audit_log").insert({
      org_id: entry.orgId,
      actor_id: entry.actorId,
      actor_email: entry.actorEmail,
      action: entry.action,
      target_id: entry.targetId ?? null,
      target_email: entry.targetEmail ?? null,
      meta: entry.meta ?? {},
    });
  } catch {
    // Audit-Log ist best effort — ein Logging-Fehler darf die eigentliche
    // Aktion nie blockieren.
  }
}
