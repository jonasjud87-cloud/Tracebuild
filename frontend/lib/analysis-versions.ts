import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { combinePlanHash, isSha256 } from "@/lib/plan-hash";
import type { ReuseCandidate } from "@/lib/analysis-fingerprint";

export function docTypeKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

export function planHashOf(hashes: (string | null)[]): string | null {
  if (!hashes.length || hashes.some((h) => h === null)) return null;
  return combinePlanHash(hashes as string[]);
}

async function documentIds(admin: SupabaseClient, projectId: string, docType: string): Promise<string[]> {
  const { data } = await admin.from("documents").select("id, doc_type").eq("project_id", projectId);
  const key = docTypeKey(docType);
  return (data ?? []).filter((d) => docTypeKey((d as { doc_type: string | null }).doc_type) === key).map((d) => (d as { id: string }).id);
}

export interface VersionFields {
  version_no: number;
  based_on_analysis_id: string | null;
  plan_sha256: string | null;
}

export async function nextVersionFields(
  admin: SupabaseClient,
  projectId: string,
  docType: string,
  planHash: string | null,
): Promise<VersionFields | null> {
  const ids = await documentIds(admin, projectId, docType);
  if (!ids.length) return { version_no: 1, based_on_analysis_id: null, plan_sha256: planHash };

  const { data: latest, error } = await admin
    .from("analyses")
    .select("version_no")
    .in("document_id", ids)
    .not("version_no", "is", null)
    .order("version_no", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingSchema(error.message)) return null;
    throw new Error(error.message);
  }
  const max = (latest?.[0] as { version_no: number } | undefined)?.version_no ?? 0;

  const { data: done } = await admin
    .from("analyses")
    .select("id")
    .in("document_id", ids)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1);

  return {
    version_no: max + 1,
    based_on_analysis_id: (done?.[0] as { id: string } | undefined)?.id ?? null,
    plan_sha256: planHash,
  };
}

export async function storedPlanHash(admin: SupabaseClient, documentId: string): Promise<string | null> {
  const { data, error } = await admin.from("document_files").select("sha256").eq("document_id", documentId);
  if (error) return null;
  const hashes = (data ?? []).map((r) => (r as { sha256: string | null }).sha256);
  return planHashOf(hashes.map((h) => (isSha256(h) ? h : null)));
}

export async function findReuseCandidates(admin: SupabaseClient, projectId: string, docType: string, planHash: string): Promise<ReuseCandidate[]> {
  const ids = await documentIds(admin, projectId, docType);
  if (!ids.length) return [];
  const query = (excludeDelta: boolean) => {
    let q = admin
      .from("analyses")
      .select("id, version_no, created_at, status, plan_sha256, input_fingerprint:result_json->>input_fingerprint")
      .in("document_id", ids)
      .eq("plan_sha256", planHash)
      .eq("status", "done");
    if (excludeDelta) q = q.neq("analysis_mode", "delta");
    return q;
  };
  let { data, error } = await query(true);
  if (error && isMissingSchema(error.message)) ({ data, error } = await query(false));
  if (error) {
    if (isMissingSchema(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as ReuseCandidate[];
}
