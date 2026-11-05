import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBilling } from "@/lib/admin-billing-data";
import { buildInvoices, monthKey, parseYear, periodRange } from "@/lib/admin-billing";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const raw = new URL(request.url).searchParams.get("year");
  const year = raw === null ? monthKey(Date.now()).slice(0, 4) : parseYear(raw);
  if (!year) return err("Ungültiges Jahr (erwartet YYYY)", 400);

  try {
    const { rows } = await loadBilling(createAdminClient(), periodRange({ kind: "year", value: year }));
    return ok(buildInvoices(rows, year));
  } catch (e) {
    return err(e instanceof Error ? e.message : "Rechnungen konnten nicht geladen werden", 500);
  }
}
