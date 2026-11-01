// Display names and short descriptions of the user roles, as members see them.
// Kept in line with the role table in the handbook (app/anleitung).

export const ROLE_LABELS: Record<string, string> = {
  super_admin:     "Super Admin",
  org_admin:       "Org Admin",
  project_manager: "Projektleiter",
  member:          "Mitglied",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  super_admin:
    "TraceBuild-Administrator mit Zugriff auf alle Organisationen.",
  org_admin:
    "Projekte bearbeiten, Pläne prüfen und Normen hochladen; zusätzlich Personen einladen, Rollen ändern, Projektmitglieder zuweisen und Projekte löschen.",
  project_manager:
    "Projekte bearbeiten, Pläne prüfen und Normen hochladen.",
  member:
    "Projekte bearbeiten, Pläne prüfen und Normen hochladen.",
};

export function roleLabel(role: string | null | undefined): string {
  return (role && ROLE_LABELS[role]) || "Mitglied";
}
