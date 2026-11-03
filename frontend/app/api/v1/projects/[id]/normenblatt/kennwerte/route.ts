import { createHash } from "node:crypto";
import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normMatchesZone } from "@/lib/zone-match";
import { runKennwerteExtraction, type KennwertItem, type KennwertNormInput } from "@/lib/normenblatt-extraction";

/**
 * Geltende Werte des Normenblatts: pro zugewiesener (zonengefilterter) Norm ein
 * extrahierter Kennwert-Satz. Teuerster Teil ist der LLM-Call — deshalb Cache in
 * `project_norm_summaries`, Schlüssel `norms_hash` (sha256 der sortierten, aktuell
 * zugewiesenen Norm-IDs). Ändert sich die Normenzuweisung nicht, trifft der Hash
 * und es wird kein Call ausgelöst (Hauptpfad). `?force=1` erzwingt eine
 * Neuberechnung unabhängig vom Hash — nur für eine explizite Nutzeraktion gedacht.
 */

interface NormRow {
  id: string;
  title: string;
  category: string | null;
  text: string | null;
  zone: string | null;
}

interface ProjectNormRow {
  norms: NormRow | null;
}

function hashNormIds(ids: string[]): string {
  const sorted = ids.slice().sort();
  return createHash("sha256").update(sorted.join(",")).digest("hex");
}

async function loadZoneFilteredNorms(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  bauzone: string | null,
): Promise<KennwertNormInput[]> {
  const { data, error } = await admin
    .from("project_norms")
    .select("norms(id, title, category, text, zone)")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  const rows = (data as unknown as ProjectNormRow[]) ?? [];
  return rows
    .filter((r) => r.norms !== null && normMatchesZone(r.norms!.zone, bauzone))
    .map((r) => ({
      id: r.norms!.id,
      title: r.norms!.title,
      category: r.norms!.category,
      text: r.norms!.text ?? "",
    }))
    .filter((n) => n.text.trim().length > 0);
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handle(request, params.id);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handle(request, params.id);
}

async function handle(request: Request, projectId: string) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  let force = searchParams.get("force") === "1";
  if (request.method === "POST") {
    try {
      const body = await request.json();
      force = force || body?.force === true;
    } catch {
      // leerer Body ist erlaubt
    }
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, bauzone")
    .eq("id", projectId)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  try {
    const norms = await loadZoneFilteredNorms(admin, projectId, project.bauzone ?? null);
    const normsHash = hashNormIds(norms.map((n) => n.id));

    if (norms.length === 0) {
      return ok({ items: [], model: null, cost_usd: null, cached: false });
    }

    if (!force) {
      const { data: cached } = await admin
        .from("project_norm_summaries")
        .select("norms_hash, items, model, cost_usd, created_at")
        .eq("project_id", projectId)
        .maybeSingle();
      if (cached && cached.norms_hash === normsHash) {
        return ok({
          items: cached.items as KennwertItem[],
          model: cached.model,
          cost_usd: cached.cost_usd,
          created_at: cached.created_at,
          cached: true,
        });
      }
    }

    // Cache fehlt oder ist veraltet (oder force=1): genau ein LLM-Call für alle Normen.
    const result = await runKennwerteExtraction(norms);

    const { error: upsertError } = await admin
      .from("project_norm_summaries")
      .upsert(
        {
          project_id: projectId,
          norms_hash: normsHash,
          items: result.items,
          model: result.model,
          cost_usd: result.cost_usd,
          created_at: new Date().toISOString(),
        },
        { onConflict: "project_id" },
      );
    if (upsertError) return err(upsertError.message, 500);

    return ok({ items: result.items, model: result.model, cost_usd: result.cost_usd, cached: false });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
