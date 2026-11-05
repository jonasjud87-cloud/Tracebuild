import type { SupabaseClient } from "@supabase/supabase-js";
import { syncProjectDocuments } from "./documents";

/**
 * Anzahl Dokumente dieses Projekts, die der Client noch importieren soll
 * (POST …/oereb/documents/sync). Hält dabei die Dokumente des aktuellen Auszugs fest; läuft
 * deshalb nach jedem Abruf (refreshProjectOereb). Ohne Migration: 0.
 */
export async function countPendingDocuments(admin: SupabaseClient, projectId: string): Promise<number> {
  return (await syncProjectDocuments(admin, projectId)).pending;
}
