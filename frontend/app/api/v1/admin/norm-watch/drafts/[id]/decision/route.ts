import { NextRequest } from "next/server";
import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveDraft, rejectDraft } from "@/lib/norm-watch/decide";
import { UUID_RE } from "@/lib/norm-watch/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();
  if (!UUID_RE.test(params.id)) return err("Ungültige ID.", 400);

  let decision: unknown;
  try {
    decision = ((await request.json()) as { decision?: unknown }).decision;
  } catch {
    return err("Ungültiger JSON-Body.", 400);
  }
  if (decision !== "approve" && decision !== "reject") return err("Entscheid muss «approve» oder «reject» sein.", 400);

  const admin = createAdminClient();
  const actor = { id: user.id, email: user.email };
  const result = decision === "approve" ? await approveDraft(admin, actor, params.id) : await rejectDraft(admin, actor, params.id);
  if (!result.ok) return err(result.message, result.status);
  return ok({ decision, normId: result.normId, announcementId: result.announcementId });
}
