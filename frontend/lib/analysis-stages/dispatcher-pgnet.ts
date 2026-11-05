/**
 * Etappen-Auslöser. Standard: Die Datenbank stösst an (pg_net), nicht die Funktion selbst, damit die
 * Anfrage keine x-vercel-id trägt (Rekursionssperre 508). Das ist Schlussfolgerung, den Spike dazu
 * beschreibt supabase/ops/analysis-stages-activate.sql. Mit ANALYSIS_STAGE_DISPATCHER=browser trägt der Browser.
 * Das Einmal-Token entsteht und bleibt in der Datenbank, hier kommt es nie an.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { dispatcherKind } from "./dispatch-url";
import type { Dispatcher } from "./ports";

export function createPgNetDispatcher(admin: SupabaseClient): Dispatcher {
  return {
    async available() {
      const { data, error } = await admin.rpc("analysis_background_available");
      if (error) {
        if (!isMissingSchema(error.message)) console.warn("analysis_background_available:", error.code);
        return false;
      }
      return data === true;
    },
    async dispatch(analysisId) {
      const { data, error } = await admin.rpc("analysis_dispatch", { p_analysis_id: analysisId });
      // 0 Zeilen: Nichts wurde gesendet. Der Wächter holt nach.
      if (!error) return typeof data === "number" && data > 0 ? "sent" : "failed";
      // Nur der Fehlertext, nie Parameter oder Header.
      console.warn(`analysis_dispatch für ${analysisId} fehlgeschlagen: ${error.message}`);
      return isMissingSchema(error.message) ? "unavailable" : "failed";
    },
  };
}

const browserDispatcher: Dispatcher = {
  available: async () => false,
  dispatch: async () => "unavailable",
};

export function createDispatcher(admin: SupabaseClient): Dispatcher {
  return dispatcherKind() === "browser" ? browserDispatcher : createPgNetDispatcher(admin);
}
