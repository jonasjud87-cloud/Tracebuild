import { NextRequest } from "next/server";
import { getAuthUser, unauthorized, forbidden, ok, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("audit_log")
    .select("*")
    .eq("org_id", params.id)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return err(error.message, 500);
  return ok(data ?? []);
}
