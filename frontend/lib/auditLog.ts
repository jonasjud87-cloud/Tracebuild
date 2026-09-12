import { createAdminClient } from "@/lib/supabase/admin";

export type AuditAction = "invite" | "reinvite" | "role_change" | "remove";

export async function logAudit(
  admin: ReturnType<typeof createAdminClient>,
  entry: {
    orgId: string;
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
