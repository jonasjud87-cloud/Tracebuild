/**
 * Speichert eine hochgeladene Norm mit Land (norms.country). Fehlt die Spalte, weil Migration
 * 20261112000001_oereb_fl.sql nicht eingespielt ist, wird wie bisher ohne Land gespeichert.
 */
import { isMissingSchema } from "./supabase/schema-errors";

type InsertResult = { data: ({ id: string } & Record<string, unknown>) | null; error: { message: string } | null };

/** Nur der Teil des Supabase-Clients, den das Speichern braucht. */
export interface NormInsertClient {
  from(table: "norms"): {
    insert(row: Record<string, unknown>): { select(): { single(): PromiseLike<InsertResult> } };
  };
}

export async function insertNormWithCountry(
  client: NormInsertClient,
  row: Record<string, unknown>,
  country: "CH" | "LI" | null
): Promise<InsertResult> {
  const first = await client.from("norms").insert({ ...row, country }).select().single();
  if (!first.error || !isMissingSchema(first.error.message) || !first.error.message.includes("country")) return first;
  return client.from("norms").insert(row).select().single();
}
