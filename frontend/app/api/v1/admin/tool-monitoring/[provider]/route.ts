import { getAuthUser, ok, err } from "@/lib/auth";
import { getUsdChf } from "@/lib/admin-currency";
import { createDeps, monitoringCache } from "@/lib/tool-monitoring/runtime";
import { checkAccess, loadCard } from "@/lib/tool-monitoring/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/v1/admin/tool-monitoring/[provider] — eine Karte. Dienstfehler kommen als state "error", nicht als 500.
export async function GET(request: Request, { params }: { params: { provider: string } }) {
  const denied = checkAccess(await getAuthUser());
  if (denied) return err(denied.error, denied.status);

  try {
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const result = await loadCard(params.provider, {
      env: process.env,
      deps: createDeps(process.env),
      cache: monitoringCache,
      fresh,
      usdToChf: getUsdChf().usdToChf,
    });
    if (result.status !== 200) return err(result.error, result.status);
    return ok(result.data);
  } catch {
    return err("Dienst konnte nicht geprüft werden", 500);
  }
}
