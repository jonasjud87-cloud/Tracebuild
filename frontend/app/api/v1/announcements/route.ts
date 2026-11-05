import { getAuthUser, unauthorized, ok, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ANNOUNCEMENT_COLUMNS,
  AnnouncementRow,
  AnnouncementType,
  PublicAnnouncement,
  compareBySeverity,
  isVisibleTo,
  orgVisibilityFilter,
} from "@/lib/announcements";

export const dynamic = "force-dynamic";

function noStore<T extends Response>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return noStore(unauthorized());

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("announcements")
    .select(ANNOUNCEMENT_COLUMNS)
    .eq("active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .or(orgVisibilityFilter(user.org_id))
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) return noStore(err("Ankündigungen konnten nicht geladen werden.", 500));

  const now = new Date();
  const result: PublicAnnouncement[] = ((data ?? []) as AnnouncementRow[])
    .filter((r) =>
      isVisibleTo({ orgId: r.org_id, active: r.active, startsAt: r.starts_at, endsAt: r.ends_at }, user.org_id, now),
    )
    .sort((a, b) => compareBySeverity({ type: a.type, startsAt: a.starts_at }, { type: b.type, startsAt: b.starts_at }))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      type: r.type as AnnouncementType,
      dismissible: r.dismissible,
      endsAt: r.ends_at,
      updatedAt: r.updated_at,
    }));

  return noStore(ok(result));
}
