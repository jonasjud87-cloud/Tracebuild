import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_PLAN_FILES,
  MAX_PLAN_FILE_BYTES,
  planMimeType,
  planStoragePath,
} from "@/lib/plan-files";

/**
 * Signierte Upload-URLs für einen Plansatz. Der Browser lädt jede Datei damit direkt in
 * Storage; die Analyse-Route bekommt danach nur noch die Pfade. So gilt das 4.5-MB-Limit
 * für Vercel-Request-Bodies nicht für Pläne.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const body = await request.json().catch(() => null) as { files?: { name?: unknown; type?: unknown; size?: unknown }[] } | null;
  const files = Array.isArray(body?.files) ? body!.files : [];
  if (files.length === 0) return err("Keine Dateien angegeben");
  if (files.length > MAX_PLAN_FILES) return err(`Höchstens ${MAX_PLAN_FILES} Dateien pro Prüfung`);

  const uploads: { name: string; path: string; token: string }[] = [];
  for (const f of files) {
    const name = typeof f.name === "string" ? f.name.trim() : "";
    const size = Number(f.size);
    if (!name) return err("Datei ohne Namen");
    if (!planMimeType(name, typeof f.type === "string" ? f.type : null)) {
      return err(`${name}: Nur PDF- oder Bilddateien werden unterstützt.`);
    }
    if (!Number.isFinite(size) || size <= 0) return err(`${name}: Die Datei ist leer.`);
    if (size > MAX_PLAN_FILE_BYTES) {
      return err(`${name}: Die Datei ist grösser als ${MAX_PLAN_FILE_BYTES / 1024 / 1024} MB.`, 413);
    }

    const { data, error } = await admin.storage
      .from("documents")
      .createSignedUploadUrl(planStoragePath(params.id, name));
    if (error || !data) return err(`Upload-URL für ${name} fehlgeschlagen: ${error?.message ?? "unbekannt"}`, 500);
    uploads.push({ name, path: data.path, token: data.token });
  }

  return ok(uploads, 201);
}
