import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { evaluateAlerts } from "@/lib/admin-alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import { countAlerts, splitAlerts } from "@/lib/admin-alert-state";
import { loadAlertStates } from "@/lib/admin-alert-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  try {
    const [result, states] = await Promise.all([evaluateAlerts(), loadAlertStates(createAdminClient())]);
    const { open, archived } = splitAlerts(result.alerts, states);
    return ok({ alerts: open, archived, counts: countAlerts(open), generatedAt: result.generatedAt });
  } catch {
    return err("Alerts nicht verfügbar", 500);
  }
}
