/**
 * A norm's `zone` column is either empty (applies to every zone in its jurisdiction)
 * or a comma-separated list of zone codes (e.g. "W2,W3"). A norm with a zone tag only
 * matches a project once the project's own Bauzone is known and equals one of the tags.
 */
/**
 * Wie normMatchesZone, aber eine unsichere Zone (Konfidenz 'low') filtert nicht: Sie ist nur ein
 * Kandidat, und ein falscher Kandidat dürfte keine zonengebundene Norm aus der Prüfung werfen.
 */
export function normAppliesToZone(
  normZone: string | null | undefined,
  projectZone: string | null | undefined,
  confidence: string | null | undefined
): boolean {
  return confidence === "low" || normMatchesZone(normZone, projectZone);
}

export function normMatchesZone(normZone: string | null | undefined, projectZone: string | null | undefined): boolean {
  const tags = (normZone ?? "")
    .split(",")
    .map((z) => z.trim().toUpperCase())
    .filter(Boolean);
  if (tags.length === 0) return true;
  if (!projectZone?.trim()) return false;
  return tags.includes(projectZone.trim().toUpperCase());
}
