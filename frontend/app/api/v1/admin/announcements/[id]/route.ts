import { NextRequest } from "next/server";
import { getAuthUser, unauthorized, forbidden, ok, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import {
  ANNOUNCEMENT_COLUMNS,
  AnnouncementRow,
  isUuid,
  rowToAnnouncement,
  validateInput,
} from "@/lib/announcements";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();
  if (!isUuid(params.id)) return err("Ungültige ID.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Ungültiger JSON-Body.", 400);
  }

  const parsed = validateInput(body, true);
  if ("error" in parsed) return err(parsed.error, 400);
  const input = parsed.value;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("announcements")
    .select(ANNOUNCEMENT_COLUMNS)
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) return err("Ankündigung nicht gefunden.", 404);
  const current = existing as AnnouncementRow;

  const startsAt = input.startsAt ?? current.starts_at;
  const endsAt = input.endsAt !== undefined ? input.endsAt : current.ends_at;
  if (endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return err("Die Endzeit muss nach der Startzeit liegen.", 400);
  }

  if (input.orgId) {
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("id", input.orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!org) return err("Organisation nicht gefunden.", 404);
  }

  const update: Record<string, unknown> = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.message !== undefined) update.message = input.message;
  if (input.type !== undefined) update.type = input.type;
  if (input.orgId !== undefined) update.org_id = input.orgId;
  if (input.startsAt !== undefined) update.starts_at = input.startsAt;
  if (input.endsAt !== undefined) update.ends_at = input.endsAt;
  if (input.dismissible !== undefined) update.dismissible = input.dismissible;
  if (input.active !== undefined) update.active = input.active;

  const { data, error } = await admin
    .from("announcements")
    .update(update)
    .eq("id", params.id)
    .select(ANNOUNCEMENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("announcements", error?.code);
    return err("Speichern fehlgeschlagen.", 500);
  }
  const row = data as AnnouncementRow;

  let orgName: string | null = null;
  if (row.org_id) {
    const { data: org } = await admin.from("organizations").select("name").eq("id", row.org_id).maybeSingle();
    orgName = org?.name ?? null;
  }

  await logAudit(admin, {
    orgId: row.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "announcement_update",
    targetId: row.id,
    meta: { title: row.title, type: row.type, fields: Object.keys(update) },
  });

  return ok(rowToAnnouncement(row, orgName));
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();
  if (!isUuid(params.id)) return err("Ungültige ID.", 400);

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("announcements")
    .select("id, org_id, title, type")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) return err("Ankündigung nicht gefunden.", 404);

  const { error } = await admin.from("announcements").delete().eq("id", params.id);
  if (error) {
    console.error("announcements", error.code);
    return err("Löschen fehlgeschlagen.", 500);
  }

  await logAudit(admin, {
    orgId: existing.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "announcement_delete",
    targetId: existing.id,
    meta: { title: existing.title, type: existing.type },
  });

  return ok({ id: params.id });
}
