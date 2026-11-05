import type { SupabaseClient } from "@supabase/supabase-js";
import { syncProjectDocuments } from "./documents";

/**
 * Anzahl Dokumente dieses Projekts, die der Client noch importieren soll
 * (POST …/oereb/documents/sync). Hält dabei die Dokumente des aktuellen Auszugs fest; läuft
 * deshalb nach jedem Abruf (refreshProjectOereb). Ohne Migration: 0.
 */
export async function countPendingDocuments(admin: SupabaseClient, projectId: string): Promise<number> {
  const state = await syncProjectDocuments(admin, projectId);
  await assignChangedNorms(state.changedNormIds);
  return state.pending;
}

/**
 * Der Fassungsvergleich kann in jedem Abgleich eine Norm freigeben: Auch fremde Projekte der Gemeinde
 * sollen sie bekommen, nicht erst bei ihrer nächsten Analyse. Lädt die Zuweisung erst bei Bedarf.
 */
export async function assignChangedNorms(normIds: string[] | undefined): Promise<void> {
  if (!normIds?.length) return;
  try {
    const { assignNormToMatchingProjects } = await import("../norm-assignment");
    for (const id of normIds) await assignNormToMatchingProjects(id);
  } catch (e) {
    console.error("Geänderte Normen nicht zugewiesen:", e instanceof Error ? e.message : String(e));
  }
}
