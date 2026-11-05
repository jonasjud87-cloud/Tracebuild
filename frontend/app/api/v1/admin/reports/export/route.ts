import { getAuthUser, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBilling } from "@/lib/admin-billing-data";
import { buildCsv, filterByPeriod, parsePeriod, periodRange, reportFilename } from "@/lib/admin-billing";
import { buildPdf } from "@/lib/admin-billing-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const params = new URL(request.url).searchParams;
  const format = params.get("format");
  if (format !== "csv" && format !== "pdf") return err("Ungültiges Format (csv oder pdf)", 400);
  const period = parsePeriod(params.get("period"));
  if (!period) return err("Ungültiger Zeitraum (YYYY-MM oder YYYY)", 400);

  try {
    const { rows, usdToChf, unassigned } = await loadBilling(createAdminClient(), periodRange(period));
    const selected = filterByPeriod(rows, period);
    const headers = {
      "Content-Disposition": `attachment; filename="${reportFilename(period, format)}"`,
      "Cache-Control": "no-store",
    };

    if (format === "csv") {
      return new Response(buildCsv(selected, usdToChf, unassigned), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
      });
    }
    return new Response(buildPdf(selected, period, usdToChf, new Date(), unassigned), {
      headers: { ...headers, "Content-Type": "application/pdf" },
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : "Export fehlgeschlagen", 500);
  }
}
