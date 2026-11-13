import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_PLAN_FILES } from "@/lib/plan-files";
import { combinePlanHash, isSha256 } from "@/lib/plan-hash";
import { decideReuse } from "@/lib/analysis-reuse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const body = (await request.json().catch(() => null)) as { doc_type?: unknown; file_hashes?: unknown } | null;
  const hashes = Array.isArray(body?.file_hashes) ? body!.file_hashes : [];
  if (!hashes.length || hashes.length > MAX_PLAN_FILES || !hashes.every(isSha256)) return err("Ungültige Prüfsummen");
  const planHash = combinePlanHash(hashes as string[]);
  if (!planHash) return err("Ungültige Prüfsummen");
  const docType = (typeof body?.doc_type === "string" && body.doc_type.trim()) || "Plansatz";

  try {
    return ok(await decideReuse(admin, project, docType, planHash));
  } catch (e) {
    console.error("reuse-check", e instanceof Error ? e.message : "unbekannt");
    return ok({ reusable: null, planKnown: false });
  }
}
