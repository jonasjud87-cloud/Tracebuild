import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms, planOerebAssignment } from "@/lib/norm-assignment";
import { refreshProjectOereb } from "@/lib/oereb/refresh";
import { oerebPdfUrl } from "@/lib/oereb/service-quirks";

export const maxDuration = 60;

const MIN_AGE_MS = 5 * 60_000;
/** Auch mit force nicht öfter: Schutz der kantonalen Dienste vor wiederholtem Klicken. */
const FORCE_MIN_AGE_MS = 30_000;

interface ProjectRow {
  id: string;
  org_id: string;
  domain: string | null;
  location: { canton?: string; municipality?: string } | null;
  parcel_number: string | null;
  bauzone: string | null;
  zone_source: string | null;
  zone_confidence: string | null;
  // Erst nach der Geoportal-Migration vorhanden.
  egrid?: string | null;
  lv95_e?: number | string | null;
  lv95_n?: number | string | null;
  bfs_number?: number | null;
}

/** Wirft bei Lesefehlern — sonst hiesse es fälschlich "nicht gefunden". select("*"): auch ohne neue Spalten. */
async function loadProject(id: string, orgId: string): Promise<ProjectRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("*")
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
    .select("*")
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
            last_attempt_at: extract.last_attempt_at ?? null,
            last_error: extract.last_error ?? null,
          }
        : null,
      themes,
      gaps: plan.gaps,
      zone: {
        bauzone: project.bauzone,
        zone_source: project.zone_source,
        zone_confidence: project.zone_confidence,
      },
      oereb_pdf_url: oerebPdfUrl(project.location?.canton, extract?.egrid ?? project.egrid),
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
 * Holt den ÖREB-Auszug neu, ausser `{ force: false }` und der letzte Versuch ist jünger als
 * 5 Minuten. Scheitert der Abruf, bleibt der alte Auszug als Rückfall (`used_stale`).
 * Danach werden die Normen zugewiesen. Antwort wie GET plus `fetched`, `documents_pending`,
 * `used_stale`, `stale_fetched_at`, `candidates` und die Zuweisungszähler.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let force = true;
  try {
    const body = await request.json();
    force = body?.force !== false;
  } catch {
    // leerer Body ist erlaubt
  }

  const admin = createAdminClient();

  try {
    const project = await loadProject(params.id, user.org_id);
    if (!project) return err("Projekt nicht gefunden", 404);
    const loc = project.location ?? {};

    // Kanton ohne Dienst: kein Abruf und kein Fehlerdatensatz (in refreshProjectOereb).
    const refresh = await refreshProjectOereb(admin, project, { minAgeMs: force ? FORCE_MIN_AGE_MS : MIN_AGE_MS });

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
      fetched: refresh.result !== null,
      fetch_result: refresh.result,
      candidates: refresh.result?.candidates,
      documents_pending: refresh.documents_pending,
      used_stale: refresh.usedStale,
      stale_fetched_at: refresh.staleFetchedAt,
      assigned_norms_count: assignment.total,
      oereb_assigned: assignment.oerebAssigned,
      oereb_skipped: assignment.oerebSkipped,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
