import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import type { AdminAlert } from "@/lib/admin-alerts";
import { alertFingerprint, type AlertState, type StoredAlertState } from "@/lib/admin-alert-state";

export async function loadAlertStates(admin: SupabaseClient): Promise<StoredAlertState[]> {
  const { data, error } = await admin.from("admin_alert_states").select("alert_id, state, fingerprint").limit(5000);
  if (error) {
    if (isMissingSchema(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as StoredAlertState[];
}

export type AlertAction = "archive" | "delete" | "restore";

export async function applyAlertAction(
  admin: SupabaseClient,
  alerts: AdminAlert[],
  action: AlertAction,
  actor: { id: string; email: string },
): Promise<void> {
  if (!alerts.length) return;
  if (action === "restore") {
    const { error } = await admin.from("admin_alert_states").delete().in("alert_id", alerts.map(a => a.id));
    if (error) throw new Error(error.message);
    return;
  }
  const state: AlertState = action === "archive" ? "archived" : "deleted";
  const now = new Date().toISOString();
  const rows = alerts.map(a => ({
    alert_id: a.id,
    state,
    fingerprint: alertFingerprint(a),
    acted_by: actor.id,
    acted_by_email: actor.email,
    acted_at: now,
  }));
  const { error } = await admin.from("admin_alert_states").upsert(rows, { onConflict: "alert_id" });
  if (error) throw new Error(error.message);
}
