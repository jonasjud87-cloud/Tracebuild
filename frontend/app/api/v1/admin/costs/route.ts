import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBilling } from "@/lib/admin-billing-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  try {
    const { rows } = await loadBilling(createAdminClient());
    return ok(rows);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Kosten konnten nicht geladen werden", 500);
  }
}
