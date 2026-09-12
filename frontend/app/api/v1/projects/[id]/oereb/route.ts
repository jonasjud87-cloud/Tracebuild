import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms, planOerebAssignment } from "@/lib/norm-assignment";
import { fetchAndPersistExtract, invalidateExtract, type FetchExtractResult } from "@/lib/oereb/fetch";
import { isSupported } from "@/lib/oereb/registry";

interface ProjectRow {
  id: string;
  org_id: string;
  domain: string | null;
  location: { canton?: string; municipality?: string } | null;
  parcel_number: string | null;
  bauzone: string | null;
  zone_source: string | null;
  zone_confidence: string | null;
}

/** Wirft, wenn die Projektspalten der ÖREB-Migration fehlen — sonst hiesse es fälschlich "nicht gefunden". */
async function loadProject(id: string, orgId: string): Promise<ProjectRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("id, org_id, domain, location, parcel_number, bauzone, zone_source, zone_confidence")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`Projekt konnte nicht gelesen werden: ${error.message}`);
  return (data as ProjectRow | null) ?? null;
}

/**
 * Baut die Antwort für den Normen-Tab: Auszugsstatus, Themen, Lücken, Zone.
 * Gibt einen Fehlertext zurück, wenn die ÖREB-Tabellen fehlen.
 */
type View = { error: string; data?: undefined } | { error?: undefined; data: Record<string, unknown> };

async function buildView(project: ProjectRow): Promise<View> {
  const admin = createAdminClient();

  const { data: extract, error: exErr } = await admin
    .from("oereb_extracts")
    .select("id, status, status_detail, egrid, canton, parcel_number, fetched_at")
    .eq("project_id", project.id)
    .maybeSingle();
  if (exErr) return { error: `ÖREB-Auszug konnte nicht gelesen werden: ${exErr.message}` };

  let themes: unknown[] = [];
  if (extract) {
    const { data, error: thErr } = await admin
      .from("oereb_themes")
      .select("id, theme_code, theme_name, sub_theme, concern, legal_status, area_pct, area_m2, type_code, legend_text, law_links, authority")
      .eq("extract_id", extract.id)
      .order("concern", { ascending: true })
      .order("theme_code", { ascending: true });
    if (thErr) return { error: `ÖREB-Themen konnten nicht gelesen werden: ${thErr.message}` };
    themes = data ?? [];
  }

  const plan = await planOerebAssignment(project.id, project.org_id, project.domain ?? "bau");

  return {
    data: {
      extract: extract
        ? {
            status: extract.status,
            status_detail: extract.status_detail,
            egrid: extract.egrid,
            canton: extract.canton,
            parcel_number: extract.parcel_number,
            fetched_at: extract.fetched_at,
          }
        : null,
      themes,
      gaps: plan.gaps,
      zone: {
        bauzone: project.bauzone,
        zone_source: project.zone_source,
        zone_confidence: project.zone_confidence,
      },
    },
  };
}

/** Auszug, Themen, Lücken und Zone eines Projekts (für den Normen-Tab). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const project = await loadProject(params.id, user.org_id);
    if (!project) return err("Projekt nicht gefunden", 404);

    const view = await buildView(project);
    if (view.error !== undefined) return err(view.error, 500);
    return ok(view.data);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

/**
 * Holt den ÖREB-Auszug (einmalig — ein vorhandener 'ok'-Auszug wird nur mit
 * `{ force: true }` neu geladen; Entscheidung 4) und weist danach die Normen zu.
 * Antwort wie GET plus `fetched` und die Zuweisungszähler.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let force = false;
  try {
    const body = await request.json();
    force = body?.force === true;
  } catch {
    // leerer Body ist erlaubt
  }

  const admin = createAdminClient();

  try {
    const project = await loadProject(params.id, user.org_id);
    if (!project) return err("Projekt nicht gefunden", 404);
    const loc = project.location ?? {};

    const { data: existing, error: exErr } = await admin
      .from("oereb_extracts")
      .select("status, canton, parcel_number")
      .eq("project_id", project.id)
      .maybeSingle();
    if (exErr) return err(`ÖREB-Auszug konnte nicht gelesen werden: ${exErr.message}`, 500);

    // Auszug zu einer anderen Parzelle / einem anderen Kanton gilt nicht als gültig.
    const stale =
      !!existing &&
      ((existing.parcel_number ?? null) !== (project.parcel_number ?? null) ||
        (existing.canton ?? "").toUpperCase() !== (loc.canton ?? "").toUpperCase());

    let fetched = false;
    let fetchResult: FetchExtractResult | null = null;
    // Kanton ohne Adapter: kein Abruf und kein Fehlerdatensatz — die UI zeigt "nicht angebunden".
    if (isSupported(loc.canton) && (force || stale || !existing || existing.status !== "ok")) {
      // Ein fremder Auszug darf nicht als Rückfallwert überleben (persistFailure schützt 'ok').
      if (stale) await invalidateExtract(project.id);
      fetchResult = await fetchAndPersistExtract(
        project.id,
        loc.canton ?? "",
        loc.municipality ?? "",
        project.parcel_number ?? ""
      );
      fetched = true;
    }

    const assignment = await assignNorms(
      project.id,
      user.org_id,
      loc.canton ?? "",
      loc.municipality ?? "",
      project.domain ?? "bau"
    );

    // Zone kann sich durch den Abruf geändert haben → frisch lesen.
    const fresh = (await loadProject(params.id, user.org_id)) ?? project;
    const view = await buildView(fresh);
    if (view.error !== undefined) return err(view.error, 500);

    return ok({
      ...view.data,
      fetched,
      fetch_result: fetchResult,
      assigned_norms_count: assignment.total,
      oereb_assigned: assignment.oerebAssigned,
      oereb_skipped: assignment.oerebSkipped,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
