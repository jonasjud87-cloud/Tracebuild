import { CANTON_NAMES } from "./norm-groups";

export type ScopeMode = "all" | "cantons" | "projects";
export type NormPriority = "binding" | "advisory";
export type ApprovalStatus = "draft" | "approved";

export const SCOPE_MODES: { value: ScopeMode; label: string }[] = [
  { value: "all", label: "Alle Projekte" },
  { value: "cantons", label: "Bestimmte Kantone" },
  { value: "projects", label: "Bestimmte Projekte" },
];

export const PRIORITIES: { value: NormPriority; label: string; hint: string }[] = [
  { value: "binding", label: "Verbindlich", hint: "Abweichungen gelten als Mangel. Gesetzliche Normen gehen trotzdem vor." },
  { value: "advisory", label: "Empfehlung", hint: "Abweichungen erscheinen höchstens als Hinweis." },
];

export interface CompanyScope {
  scope_mode?: string | null;
  scope_cantons?: string[] | null;
  scope_project_ids?: string[] | null;
}

export interface CompanyNormState extends CompanyScope {
  approval_status?: string | null;
  archived_at?: string | null;
}

export interface ScopePlace {
  canton: string;
  projectId?: string | null;
}

const CANTON_CODES = new Set(Object.keys(CANTON_NAMES));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isScopeMode(v: unknown): v is ScopeMode {
  return v === "all" || v === "cantons" || v === "projects";
}

export function isPriority(v: unknown): v is NormPriority {
  return v === "binding" || v === "advisory";
}

export function companyNormApplies(n: CompanyNormState, place: ScopePlace): boolean {
  if (n.approval_status === "draft") return false;
  if (n.archived_at) return false;
  const mode = n.scope_mode ?? "all";
  if (mode === "cantons") return (n.scope_cantons ?? []).includes(place.canton);
  if (mode === "projects") return !!place.projectId && (n.scope_project_ids ?? []).includes(place.projectId);
  return true;
}

export function isActiveCompanyNorm(n: { approval_status?: string | null; archived_at?: string | null }): boolean {
  return n.approval_status !== "draft" && !n.archived_at;
}

export interface ScopeInput {
  mode: ScopeMode;
  cantons: string[];
  projectIds: string[];
}

export function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export function parseScope(raw: { mode?: unknown; cantons?: unknown; projectIds?: unknown }): { value: ScopeInput } | { error: string } {
  const mode = raw.mode === undefined || raw.mode === null || raw.mode === "" ? "all" : raw.mode;
  if (!isScopeMode(mode)) return { error: "Unbekannter Geltungsbereich" };
  const cantons = Array.from(new Set(parseList(raw.cantons).map((c) => c.toUpperCase())));
  const projectIds = Array.from(new Set(parseList(raw.projectIds).map((p) => p.toLowerCase())));
  if (mode === "cantons") {
    if (!cantons.length) return { error: "Bitte mindestens einen Kanton wählen" };
    if (cantons.some((c) => !CANTON_CODES.has(c))) return { error: "Unbekannter Kanton" };
    return { value: { mode, cantons, projectIds: [] } };
  }
  if (mode === "projects") {
    if (!projectIds.length) return { error: "Bitte mindestens ein Projekt wählen" };
    if (projectIds.some((p) => !UUID.test(p))) return { error: "Ungültiges Projekt" };
    return { value: { mode, cantons: [], projectIds } };
  }
  return { value: { mode: "all", cantons: [], projectIds: [] } };
}

export function scopeLabel(n: CompanyScope, projectNames: Record<string, string> = {}): string {
  const mode = n.scope_mode ?? "all";
  if (mode === "cantons") {
    const list = n.scope_cantons ?? [];
    return list.length ? `Kantone: ${list.join(", ")}` : "Kein Kanton gewählt";
  }
  if (mode === "projects") {
    const ids = n.scope_project_ids ?? [];
    if (!ids.length) return "Kein Projekt gewählt";
    const names = ids.map((id) => projectNames[id] ?? "Projekt");
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} und ${names.length - 3} weitere` : names.join(", ");
  }
  return "Alle Projekte";
}

export function priorityLabel(p: string | null | undefined): string {
  return p === "binding" ? "Verbindlich" : "Empfehlung";
}

export function canApproveCompanyNorms(role: string | null | undefined): boolean {
  return role === "org_admin" || role === "super_admin";
}
