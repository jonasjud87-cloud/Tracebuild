export interface AuditItem {
  id: string;
  orgId: string | null;
  orgName: string | null;
  actorId: string | null;
  actorEmail: string;
  action: string;
  targetId: string | null;
  targetEmail: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface AuditFilterState {
  org: string;
  action: string;
  actor: string;
  from: string;
  to: string;
  q: string;
}

export interface OrgOption {
  id: string;
  name: string;
}

export const EMPTY_FILTERS: AuditFilterState = { org: "", action: "", actor: "", from: "", to: "", q: "" };

export const ACTION_LABELS: Record<string, string> = {
  invite: "Einladung",
  reinvite: "Erneute Einladung",
  role_change: "Rollenwechsel",
  remove: "Entfernt",
  project_create: "Projekt erstellt",
  project_delete: "Projekt gelöscht",
  project_update: "Projekt geändert",
  project_member_add: "Projektmitglied hinzugefügt",
  project_member_remove: "Projektmitglied entfernt",
  org_create: "Organisation erstellt",
  org_update: "Organisation geändert",
  org_delete: "Organisation gelöscht",
  org_status_change: "Organisationsstatus geändert",
  norm_delete: "Norm gelöscht",
  norm_promote: "Norm hochgestuft",
  norm_upload_platform: "Plattformnorm hochgeladen",
  norm_upload: "Norm hochgeladen",
  norm_remove: "Norm entfernt",
  norm_custom_create: "Eigene Norm erstellt",
  norm_refresh: "Norm aktualisiert",
  project_norm_add: "Projektnorm hinzugefügt",
  project_norm_remove: "Projektnorm entfernt",
  analysis_run: "Analyse gestartet",
  analysis_delete: "Analyse gelöscht",
  chat_message: "Chatnachricht",
  profile_name_change: "Profilname geändert",
  announcement_create: "Ankündigung erstellt",
  announcement_update: "Ankündigung geändert",
  announcement_delete: "Ankündigung gelöscht",
  block: "Benutzer gesperrt",
  unblock: "Benutzer entsperrt",
  password_reset: "Passwort-Reset ausgelöst",
};

export function actionLabel(action: string, meta: Record<string, unknown> | null | undefined): string {
  if (action === "analysis_run") {
    if (meta?.op === "admin_cancel") return "Analyse abgebrochen (Admin)";
    if (meta?.op === "admin_timeout") return "Analyse beendet: Zeitüberschreitung (Admin)";
  }
  return ACTION_LABELS[action] ?? action;
}

export function buildAuditParams(f: AuditFilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.org) p.set("org", f.org);
  if (f.action) p.set("action", f.action);
  if (f.actor.trim()) p.set("actor", f.actor.trim());
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.q.trim()) p.set("q", f.q.trim());
  return p;
}
