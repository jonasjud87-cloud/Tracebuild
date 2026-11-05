import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plansatz-Dateien: was hochgeladen werden darf und wo es liegt.
 *
 * Die Dateien gehen vom Browser direkt in Supabase Storage (signierte Upload-URL) und
 * nie durch eine Vercel-Funktion — deren Request-Body ist auf 4.5 MB begrenzt, ein
 * Architektenplan ist meist grösser. Gilt für Client und Server gleichermassen.
 */

export const MAX_PLAN_FILES = 20;
export const MAX_PLAN_FILE_BYTES = 50 * 1024 * 1024;

export const PLAN_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type PlanMimeType = (typeof PLAN_MIME_TYPES)[number];

/** Mime-Typ aus Browser-Angabe oder Dateiendung; null = nicht unterstützt. */
export function planMimeType(name: string, type: string | null | undefined): PlanMimeType | null {
  const t = (type ?? "").toLowerCase();
  if ((PLAN_MIME_TYPES as readonly string[]).includes(t)) return t as PlanMimeType;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return null;
}

/** Was der Client nach dem Upload an die Analyse-Route schickt. */
export interface UploadedPlanFile {
  path: string;
  name: string;
  type: PlanMimeType;
  size: number;
}

/**
 * Storage-Pfad. Muss mit "{project_id}/" beginnen — daran hängt die Zuordnung zum
 * Projekt (Prüfung in der Analyse-Route) und der Speicherverbrauch je Organisation.
 */
export function planStoragePath(projectId: string, fileName: string): string {
  const safe = fileName.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-120) || "plan";
  return `${projectId}/${crypto.randomUUID()}_${safe}`;
}

/**
 * Was das Löschen einer Analyse aus dem Storage entfernen darf: nur Pfade dieses Projekts. Die Pfade stammen
 * aus Tabellen, und das Löschen läuft mit Service-Role: Ein fremder Pfad darf dort nie etwas bewirken.
 */
export function ownedStoragePaths(projectId: string, paths: Iterable<string>): string[] {
  return Array.from(paths).filter(
    (p) => typeof p === "string" && p.startsWith(`${projectId}/`) && p.length > projectId.length + 1 && !/\.\.|\\|%2e|%2f|%5c/i.test(p),
  );
}

/**
 * Räumt nach einem gescheiterten Start auf. Die Pfade kommen vom Browser: Was zu einer Analyse gehört, bleibt,
 * auch wenn die Prüfung nicht klappt. Im Zweifel bleibt die Datei liegen.
 */
export async function removeUnreferencedPlanFiles(
  admin: SupabaseClient,
  projectId: string,
  paths: Iterable<string>,
  fileUrl: (path: string) => string,
): Promise<void> {
  const owned = ownedStoragePaths(projectId, paths);
  if (owned.length === 0) return;
  const [files, docs] = await Promise.all([
    admin.from("document_files").select("storage_path").in("storage_path", owned),
    admin.from("documents").select("file_url").in("file_url", owned.map(fileUrl)),
  ]);
  if (files.error || docs.error) return;
  const used = new Set((files.data ?? []).map((r) => r.storage_path as string));
  const usedUrls = new Set((docs.data ?? []).map((r) => r.file_url as string));
  const free = owned.filter((p) => !used.has(p) && !usedUrls.has(fileUrl(p)));
  if (free.length > 0) await admin.storage.from("documents").remove(free);
}
