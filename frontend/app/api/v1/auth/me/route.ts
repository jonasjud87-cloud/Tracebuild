import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

const MAX_NAME_LENGTH = 120;

/**
 * Display name of the signed-in account. public.users.name is the source for
 * organization members; super admins have no public.users row, so the auth
 * user_metadata.full_name (also written by the invite flow) is the fallback.
 */
async function loadName(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string | null> {
  const { data: row } = await admin.from("users").select("name").eq("id", userId).maybeSingle();
  const fromRow = (row?.name as string | null | undefined)?.trim();
  if (fromRow) return fromRow;

  const { data } = await admin.auth.admin.getUserById(userId);
  const fromMeta = (data.user?.user_metadata?.full_name as string | undefined)?.trim();
  return fromMeta || null;
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const [{ data: org }, name] = await Promise.all([
    admin.from("organizations").select("id, name, slug").eq("id", user.org_id).maybeSingle(),
    loadName(admin, user.id),
  ]);

  return ok({
    id:     user.id,
    email:  user.email,
    name,
    org_id: user.org_id,
    role:   user.role,
    org:    org ? { id: org.id, name: org.name as string, slug: org.slug as string } : null,
  });
}

// PATCH /api/v1/auth/me — the signed-in account changes its own display name.
// E-mail and password are changed client-side via supabase.auth.updateUser,
// because both need Supabase's own confirmation / session handling.
export async function PATCH(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  if (!body || typeof body.name !== "string") return err("Name fehlt.");

  const name = body.name.trim().replace(/\s+/g, " ");
  if (!name) return err("Name darf nicht leer sein.");
  if (name.length > MAX_NAME_LENGTH) return err(`Name ist zu lang (maximal ${MAX_NAME_LENGTH} Zeichen).`);

  const admin = createAdminClient();

  const { error: rowError } = await admin.from("users").update({ name }).eq("id", user.id);
  if (rowError) return err(rowError.message, 500);

  // Keep the auth metadata in step: it is the name source for accounts without
  // a public.users row and what the e-mail templates read.
  const { data: authData } = await admin.auth.admin.getUserById(user.id);
  const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...(authData.user?.user_metadata ?? {}), full_name: name },
  });
  if (metaError) return err(metaError.message, 500);

  await logAudit(admin, {
    orgId: user.role === "super_admin" ? null : user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "profile_name_change",
    targetId: user.id,
    meta: { name },
  });

  return ok({ name });
}
