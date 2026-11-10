import { isMissingSchema } from "./supabase/schema-errors";

/** Projektnummer: optionale, vom Unternehmen vergebene Kennung, eindeutig je Organisation. */
export const PROJECT_NUMBER_MAX = 40;
export const PROJECT_NUMBER_UNIQUE_INDEX = "projects_org_project_number_uidx";
export const PROJECT_NUMBER_CHECK = "projects_project_number_check";

export type ParsedProjectNumber = { value: string | null } | { error: string };

// Auch C1-Steuerzeichen und unsichtbare Zeichen: Postgres [[:cntrl:]] trifft je nach Locale U+0080–U+009F,
// und Zero-Width-Zeichen erzeugten optisch gleiche Doubletten.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2028\u2029\u2060]/;

/** Prüft die Eingabe. Leer oder fehlend ergibt null (keine Nummer). */
export function parseProjectNumber(input: unknown): ParsedProjectNumber {
  if (input === undefined || input === null || input === "") return { value: null };
  if (typeof input !== "string") return { error: "Ungültige Projektnummer." };
  const s = input.trim();
  if (!s) return { value: null };
  if (CONTROL_CHARS.test(s)) {
    return { error: "Die Projektnummer darf keine Zeilenumbrüche, Tabulatoren oder unsichtbaren Zeichen enthalten." };
  }
  // Länge in Codepoints, wie char_length in Postgres.
  if (Array.from(s).length > PROJECT_NUMBER_MAX) {
    return { error: `Die Projektnummer darf höchstens ${PROJECT_NUMBER_MAX} Zeichen lang sein.` };
  }
  return { value: s };
}

/** Spalte project_number fehlt: Migration 20261111000001 nicht eingespielt. */
export function isMissingProjectNumberColumn(message: string | undefined): boolean {
  return (message ?? "").includes("project_number") && isMissingSchema(message);
}

interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/** Übersetzt Verletzungen von Eindeutigkeit oder Check in eine Meldung; sonst null. */
export function projectNumberDbError(
  error: DbErrorLike | null | undefined,
  value: string | null | undefined,
): { status: number; message: string } | null {
  if (!error) return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (error.code === "23505" && text.includes(PROJECT_NUMBER_UNIQUE_INDEX)) {
    return {
      status: 409,
      message: value
        ? `Die Projektnummer «${value}» ist in Ihrer Organisation bereits vergeben. Bitte eine andere wählen.`
        : "Diese Projektnummer ist in Ihrer Organisation bereits vergeben.",
    };
  }
  if (error.code === "23514" && text.includes(PROJECT_NUMBER_CHECK)) {
    return {
      status: 400,
      message: `Ungültige Projektnummer (höchstens ${PROJECT_NUMBER_MAX} Zeichen, ohne führende oder abschliessende Leerzeichen).`,
    };
  }
  return null;
}
