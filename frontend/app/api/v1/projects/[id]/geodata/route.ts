import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readGeodata, refreshGeodata, type GeodataProject } from "@/lib/geoadmin/refresh";
import type { GeodataResponse } from "@/lib/geoadmin/contract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_AGE_MS = 5 * 60_000;
/** Auch mit force nicht öfter: Fair Use bei geo.admin.ch. */
const FORCE_MIN_AGE_MS = 30_000;

async function loadProject(id: string, orgId: string): Promise<GeodataProject | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("projects").select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(`Projekt konnte nicht gelesen werden: ${error.message}`);
  return (data as GeodataProject | null) ?? null;
}

/** Gespeicherter Stand; beim ersten Öffnen wird abgerufen. Ausfall externer Dienste: 200 mit Status. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const project = await loadProject(params.id, user.org_id);
    if (!project) return err("Projekt nicht gefunden", 404);
    const admin = createAdminClient();
    return ok<GeodataResponse>((await readGeodata(admin, project)) ?? (await refreshGeodata(admin, project)));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

/** Neu abrufen, ausser `{ force: false }` und der letzte Versuch ist jünger als 5 Minuten. */
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

  try {
    const project = await loadProject(params.id, user.org_id);
    if (!project) return err("Projekt nicht gefunden", 404);
    return ok<GeodataResponse>(await refreshGeodata(createAdminClient(), project, { minAgeMs: force ? FORCE_MIN_AGE_MS : MIN_AGE_MS }));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
