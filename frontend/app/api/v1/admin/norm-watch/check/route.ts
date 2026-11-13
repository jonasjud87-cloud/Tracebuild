import { NextRequest } from "next/server";
import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { createWatchDeps, UUID_RE } from "@/lib/norm-watch/deps";
import { runWatch } from "@/lib/norm-watch/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  let sourceId: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { sourceId?: unknown };
    if (typeof body.sourceId === "string" && body.sourceId) {
      if (!UUID_RE.test(body.sourceId)) return err("Ungültige Quellen-ID.", 400);
      sourceId = body.sourceId;
    }
  } catch {
    sourceId = undefined;
  }

  try {
    const deps = createWatchDeps();
    const summary = await runWatch(deps, { sourceId });
    await logAudit(deps.admin, {
      orgId: null,
      actorId: user.id,
      actorEmail: user.email,
      action: "norm_watch_check",
      meta: {
        checked: summary.checked,
        skipped: summary.skipped,
        drafts: summary.draftsCreated,
        adopted: summary.adopted,
        errors: summary.errors,
        manual: true,
        sources: summary.outcomes.map((o) => `${o.label}: ${o.result}`),
      },
    });
    return ok(summary);
  } catch (e) {
    console.error("norm-watch check", e instanceof Error ? e.message : "unbekannt");
    return err("Der Abgleich konnte nicht ausgeführt werden.", 500);
  }
}
