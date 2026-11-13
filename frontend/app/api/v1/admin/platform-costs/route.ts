import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsdChf } from "@/lib/admin-currency";
import { loadPlatformCosts } from "@/lib/admin-platform-costs";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  try {
    const rows = await loadPlatformCosts(createAdminClient());
    return ok({ usdToChf: getUsdChf().usdToChf, rows });
  } catch (e) {
    console.error("platform-costs", e instanceof Error ? e.message : "unbekannt");
    return err("Plattformkosten konnten nicht geladen werden.", 500);
  }
}
