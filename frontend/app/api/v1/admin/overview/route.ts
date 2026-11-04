import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { getOverview } from "@/lib/admin-overview/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  try {
    return ok(await getOverview());
  } catch {
    return err("Übersicht konnte nicht geladen werden", 500);
  }
}
