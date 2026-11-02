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
