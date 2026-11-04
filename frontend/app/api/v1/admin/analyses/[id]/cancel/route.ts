import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/admin-analyses/params";
import { cancelAnalysis } from "@/lib/admin-analyses/mutations";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    if (user.role !== "super_admin") return forbidden();
    if (!isUuid(params.id)) return err("Ungültige Analyse-ID", 400);

    const result = await cancelAnalysis(createAdminClient(), params.id, user, new Date());
    if (!result.ok) return err(result.error, result.status);
    return ok(result.data);
  } catch (e) {
    console.error("POST /api/v1/admin/analyses/[id]/cancel fehlgeschlagen:", e);
    return err(e instanceof Error ? e.message : "Abbruch fehlgeschlagen", 500);
  }
}
