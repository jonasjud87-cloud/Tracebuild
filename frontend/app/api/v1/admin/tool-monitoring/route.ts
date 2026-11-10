import { getAuthUser, ok, err } from "@/lib/auth";
import { checkAccess, listProviders } from "@/lib/tool-monitoring/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/v1/admin/tool-monitoring — Dienste und ob sie eingerichtet sind. Keine Netzaufrufe.
export async function GET() {
  const denied = checkAccess(await getAuthUser());
  if (denied) return err(denied.error, denied.status);
  return ok({ providers: listProviders(process.env) });
}
