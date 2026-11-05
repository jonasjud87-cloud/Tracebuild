/** PostgREST meldet fehlende Tabellen, Spalten und Funktionen so: die Migration ist dann nicht eingespielt. */
export function isMissingSchema(message: string | undefined): boolean {
  const m = message ?? "";
  return m.includes("Could not find the table") || m.includes("does not exist") || m.includes("schema cache");
}
