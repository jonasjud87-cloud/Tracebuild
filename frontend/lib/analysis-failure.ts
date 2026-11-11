/**
 * Abschluss einer Analyse mit Fehler: immer mit Grund und finished_at. Ohne Supabase-Client testbar.
 */
import { isMissingSchema } from "./supabase/schema-errors";

export const FALLBACK_FAILURE_REASON = "Unbekannter Fehler";

/** Nie leer: Ohne Grund zeigt die Seite nur «Unbekannter Fehler» und der Support hat nichts. */
export function failureReason(message: unknown): string {
  const text = typeof message === "string" ? message.trim() : message instanceof Error ? message.message.trim() : "";
  return text || FALLBACK_FAILURE_REASON;
}

/** Felder für status = 'error'. `resultJson` bleibt erhalten, `error` wird gesetzt. */
export function failureFields(
  message: unknown,
  nowMs: number,
  resultJson: Record<string, unknown> | null = null,
): { status: "error"; finished_at: string; result_json: Record<string, unknown> } {
  return {
    status: "error",
    finished_at: new Date(nowMs).toISOString(),
    result_json: { ...(resultJson ?? {}), error: failureReason(message) },
  };
}

/**
 * Schreibt mit finished_at. Fehlt die Spalte (Monitor-Migration nicht eingespielt), ein zweiter
 * Versuch ohne, damit die Analyse nicht auf «läuft» stehen bleibt.
 */
export async function updateClosing<R extends { error: { message: string } | null }>(
  fields: Record<string, unknown>,
  run: (fields: Record<string, unknown>) => PromiseLike<R>,
): Promise<R> {
  const first = await run(fields);
  if (!first.error || !isMissingSchema(first.error.message) || !("finished_at" in fields)) return first;
  const { finished_at: _finishedAt, ...rest } = fields;
  return run(rest);
}
