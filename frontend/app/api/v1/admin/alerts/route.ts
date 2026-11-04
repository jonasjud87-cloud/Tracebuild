import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { evaluateAlerts } from "@/lib/admin-alerts";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  try {
    return ok(await evaluateAlerts());
  } catch {
    return err("Alerts nicht verfügbar", 500);
  }
}
