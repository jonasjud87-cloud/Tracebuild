import type { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

type Admin = ReturnType<typeof createAdminClient>;

export interface CompanyNormRow {
  id: string;
  org_id: string | null;
  title: string;
  domain: string;
  category: string;
  zone: string | null;
  jurisdiction_type: string;
  approval_status: string;
  archived_at: string | null;
  version_no: number;
  supersedes_norm_id: string | null;
  priority: string;
  scope_mode: string;
  scope_cantons: string[];
  scope_project_ids: string[];
}

const COLUMNS =
  "id, org_id, title, domain, category, zone, jurisdiction_type, approval_status, archived_at, version_no, supersedes_norm_id, priority, scope_mode, scope_cantons, scope_project_ids";

export async function loadCompanyNorm(
  admin: Admin,
  orgId: string,
  id: string,
): Promise<{ norm: CompanyNormRow | null; error: string | null }> {
  const { data, error } = await admin
    .from("norms")
    .select(COLUMNS)
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("jurisdiction_type", "org")
    .maybeSingle();
  if (error) {
    return { norm: null, error: isMissingSchema(error.message) ? "Unternehmensnormen sind noch nicht eingerichtet (Migration 20261113000003 fehlt)." : error.message };
  }
  return { norm: (data as CompanyNormRow | null) ?? null, error: null };
}
