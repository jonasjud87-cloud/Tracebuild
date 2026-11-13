import { NextRequest } from "next/server";
import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { UUID_RE } from "@/lib/norm-watch/deps";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();
  if (!UUID_RE.test(params.id)) return err("Ungültige ID.", 400);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return err("Ungültiger JSON-Body.", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return err("Ungültiger JSON-Body.", 400);
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (label.length < 1 || label.length > 200) return err("Bezeichnung fehlt oder ist zu lang.");
    patch.label = label;
  }
  const admin = createAdminClient();
  if ("normId" in body) {
    if (body.normId === null || body.normId === "") {
      patch.norm_id = null;
    } else if (typeof body.normId === "string" && UUID_RE.test(body.normId)) {
      const { data: norm } = await admin.from("norms").select("id").eq("id", body.normId).is("org_id", null).maybeSingle();
      if (!norm) return err("Die gewählte Norm ist keine plattformweite Norm.", 404);
      patch.norm_id = body.normId;
      patch.applied_version = null;
      patch.applied_label = null;
      patch.ignored_version = null;
      patch.status = "unchecked";
    } else {
      return err("Ungültige Norm-ID.", 400);
    }
  }
  if (Object.keys(patch).length === 0) return err("Keine Änderung angegeben.", 400);

  const { data, error } = await admin.from("norm_sources").update(patch).eq("id", params.id).select("id").maybeSingle();
  if (error) {
    console.error("norm-watch update", error.code);
    return err("Speichern fehlgeschlagen.", 500);
  }
  if (!data) return err("Quelle nicht gefunden.", 404);

  if ("norm_id" in patch) {
    await admin
      .from("norm_update_drafts")
      .update({ status: "superseded", decided_at: new Date().toISOString() })
      .eq("source_id", params.id)
      .eq("status", "draft");
  }

  await logAudit(admin, {
    orgId: null,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_source_update",
    targetId: params.id,
    meta: { fields: Object.keys(patch) },
  });
  return ok({ id: params.id });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();
  if (!UUID_RE.test(params.id)) return err("Ungültige ID.", 400);

  const admin = createAdminClient();
  const { data, error } = await admin.from("norm_sources").delete().eq("id", params.id).select("id, label").maybeSingle();
  if (error) {
    console.error("norm-watch delete", error.code);
    return err("Löschen fehlgeschlagen.", 500);
  }
  if (!data) return err("Quelle nicht gefunden.", 404);

  await logAudit(admin, {
    orgId: null,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_source_delete",
    targetId: params.id,
    meta: { label: (data as { label: string }).label },
  });
  return ok({ id: params.id });
}
