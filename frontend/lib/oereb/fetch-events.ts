import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "../supabase/schema-errors";

export interface FetchEvent {
  source: "oereb" | "geodata";
  canton: string | null;
  project_id: string;
  status: string;
  detail: string | null;
  duration_ms: number;
}

/**
 * Hält einen Abruf fest. Ein gespeicherter Auszug verdeckt Ausfälle (last_error überschreibt sich),
 * erst die Ereignisse zeigen einen dauerhaft ausgefallenen Kanton. Best effort, wirft nie.
 */
export async function recordFetchEvent(admin: SupabaseClient, event: FetchEvent): Promise<void> {
  try {
    const { error } = await admin.from("oereb_fetch_events").insert({
      ...event,
      canton: event.canton?.trim().toUpperCase() || null,
      detail: event.detail?.slice(0, 500) ?? null,
    });
    if (error && !isMissingSchema(error.message)) console.error("Abruf-Ereignis nicht gespeichert:", error.message);
  } catch (e) {
    console.error("Abruf-Ereignis nicht gespeichert:", e);
  }
}
