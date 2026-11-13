import { NextRequest } from "next/server";
import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { digestOverview, ensureAllDigests } from "@/lib/norm-digest/store";
import { UUID_RE } from "@/lib/norm-watch/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUN_BUDGET_MS = 240_000;

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();
  try {
    return ok(await digestOverview(createAdminClient()));
  } catch (e) {
    console.error("norm-digests", e instanceof Error ? e.message : "unbekannt");
    return err("Prüfauszüge konnten nicht geladen werden.", 500);
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const body = (await request.json().catch(() => ({}))) as { force?: unknown; normId?: unknown };
  const normId = typeof body.normId === "string" ? body.normId : null;
  if (normId && !UUID_RE.test(normId)) return err("Ungültige ID.", 400);

  try {
    const summary = await ensureAllDigests(createAdminClient(), {
      deadlineAt: Date.now() + RUN_BUDGET_MS,
      force: body.force === true,
      onlyIds: normId ? [normId] : undefined,
    });
    return ok(summary);
  } catch (e) {
    console.error("norm-digests", e instanceof Error ? e.message : "unbekannt");
    return err("Prüfauszüge konnten nicht erstellt werden.", 500);
  }
}
