import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseListParams } from "@/lib/admin-analyses/params";
import { buildListResponse } from "@/lib/admin-analyses/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    if (user.role !== "super_admin") return forbidden();

    const now = new Date();
    const parsed = parseListParams(new URL(request.url).searchParams, now);
    if (!parsed.ok) return err(parsed.error, 400);

    const data = await buildListResponse(createAdminClient(), parsed.value, now);
    return ok(data);
  } catch (e) {
    console.error("GET /api/v1/admin/analyses fehlgeschlagen:", e);
    return err(e instanceof Error ? e.message : "Analysen konnten nicht geladen werden", 500);
  }
}
