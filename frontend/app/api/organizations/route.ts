import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { validateCreate } from "@/lib/validations/organization";
import { slugify, uniqueSlug, formatOrg } from "@/lib/organizations";
import { logAudit } from "@/lib/auditLog";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("*")
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("created_at",  { ascending: true });

  if (error) return err(error.message, 500);
  return ok((data ?? []).map(formatOrg));
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  let body: unknown;
  try { body = await req.json(); } catch { return err("Ungültiger JSON-Body"); }

  const validation = validateCreate(body);
  if ("error" in validation) return err(validation.error);
  const input = validation.data;

  const admin = createAdminClient();
  const slug  = await uniqueSlug(admin, slugify(input.name));

  const { data, error } = await admin
    .from("organizations")
    .insert({
      name:             input.name,
      slug,
      description:      input.description    ?? null,
      plan:             input.plan,
      status:           input.status         ?? "active",
      owner_name:       input.ownerName      ?? null,
      owner_email:      input.ownerEmail     ?? null,
      user_limit:       input.userLimit      ?? null,
      project_limit:    input.projectLimit   ?? null,
      storage_limit_gb: input.storageLimitGb ?? null,
      monthly_budget:   input.monthlyBudget  ?? null,
      is_default:       input.isDefault      ?? false,
    })
    .select()
    .single();

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: data.id,
    actorId: user.id,
    actorEmail: user.email,
    action: "org_create",
    targetId: data.id,
    meta: { name: data.name },
  });

  return ok(formatOrg(data), 201);
}
