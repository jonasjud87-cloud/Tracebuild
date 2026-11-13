import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { evaluateAlerts } from "@/lib/admin-alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyAlertAction, type AlertAction } from "@/lib/admin-alert-store";

export const dynamic = "force-dynamic";

const ACTIONS: AlertAction[] = ["archive", "delete", "restore"];
const MAX_IDS = 200;

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const body = (await request.json().catch(() => null)) as { ids?: unknown; action?: unknown } | null;
  const action = body?.action;
  const ids = body?.ids;
  if (typeof action !== "string" || !ACTIONS.includes(action as AlertAction)) return err("Unbekannte Aktion");
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || ids.some(i => typeof i !== "string")) {
    return err("Meldungen fehlen oder sind ungültig");
  }

  try {
    const wanted = new Set(ids as string[]);
    const { alerts } = await evaluateAlerts();
    const targets = alerts.filter(a => wanted.has(a.id));
    await applyAlertAction(createAdminClient(), targets, action as AlertAction, { id: user.id, email: user.email });
    return ok({ changed: targets.length });
  } catch {
    return err("Aktion fehlgeschlagen. Ist die Migration admin_alert_states eingespielt?", 500);
  }
}
