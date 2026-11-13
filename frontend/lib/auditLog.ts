import type { createAdminClient } from "@/lib/supabase/admin";

export type AuditAction =
  | "invite" | "reinvite" | "role_change" | "remove"
  | "project_create" | "project_delete" | "project_update"
  | "project_member_add" | "project_member_remove"
  | "org_create" | "org_update" | "org_delete" | "org_status_change"
  | "norm_delete" | "norm_promote" | "norm_upload_platform"
  | "norm_upload" | "norm_remove" | "norm_custom_create"
  | "norm_refresh" | "project_norm_add" | "project_norm_remove"
  | "analysis_run" | "analysis_delete" | "chat_message"
  | "profile_name_change"
  | "announcement_create" | "announcement_update" | "announcement_delete"
  | "block" | "unblock" | "password_reset"
  | "norm_auto_import" | "norm_auto_update" | "norm_auto_update_rejected"
  | "norm_org_authoritative" | "oereb_document_decision"
  | "norm_watch_check" | "norm_watch_approve" | "norm_watch_reject"
  | "norm_source_create" | "norm_source_update" | "norm_source_delete"
  | "norm_company_update" | "norm_company_approve" | "norm_company_version";

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
    const { error } = await admin.from("audit_log").insert({
      org_id: entry.orgId,
      actor_id: entry.actorId,
      actor_email: entry.actorEmail,
      action: entry.action,
      target_id: entry.targetId ?? null,
      target_email: entry.targetEmail ?? null,
      meta: entry.meta ?? {},
    });
    if (error) console.error("audit_log", entry.action, error.code);
  } catch {
    console.error("audit_log", entry.action, "exception");
  }
}
