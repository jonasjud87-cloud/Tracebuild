/**
 * Eigene Uploads gegen den amtlichen Text: Ist ein Upload derselben Gemeinde dem amtlichen Text sehr
 * ähnlich, gilt für die Analyse nur die amtliche Fassung. Der Upload bleibt bestehen.
 *
 * Nur serverseitig. Das Ergebnis steht ausschliesslich auf der Zeile der Org, der der Upload gehört.
 * Keine Org-ID, kein Text und kein Titel eines Uploads gelangt in globale Tabellen, Audit oder Logs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "../supabase/schema-errors";
import type { ImportFilterRules } from "./import-filter";
import { containment, shingleSet } from "./text-measure";

export interface UploadRow {
  id: string;
  text: string | null;
  jurisdiction_canton?: string | null;
  jurisdiction_bfs?: number | null;
  superseded_by_norm_id?: string | null;
}

export type UploadLink =
  | { action: "link"; uploadId: string; similarity: number }
  | { action: "unlink"; uploadId: string };

/**
 * Rein. Zu kurze Uploads (Scans) bleiben unberührt. Anteil des Uploads, der im amtlichen Text steht:
 * Ein Auszug daraus gilt als abgelöst, eine Sammlung mit eigenem Inhalt nicht.
 */
export function planUploadLinks(
  officialId: string,
  officialText: string,
  uploads: UploadRow[],
  rules: Pick<ImportFilterRules, "upload_similarity_min" | "min_text_chars">
): UploadLink[] {
  const official = shingleSet(officialText);
  const out: UploadLink[] = [];
  for (const upload of uploads) {
    const text = (upload.text ?? "").trim();
    const similarity = text.length >= rules.min_text_chars ? containment(shingleSet(text), official) : 0;
    if (similarity >= rules.upload_similarity_min) {
      out.push({ action: "link", uploadId: upload.id, similarity });
    } else if (upload.superseded_by_norm_id === officialId) {
      out.push({ action: "unlink", uploadId: upload.id });
    }
  }
  return out;
}

const UPLOAD_COLUMNS = "id, text, jurisdiction_canton, jurisdiction_bfs, superseded_by_norm_id";

/**
 * Nach Import oder Änderung einer amtlichen Gemeinde-Norm. Objektbezogene Vorschriften lösen nichts
 * ab: Sie gelten nicht für jedes Grundstück der Gemeinde. Gibt die Anzahl Änderungen zurück. Wirft nie.
 */
export async function linkSimilarUploads(
  admin: SupabaseClient,
  official: { id: string; text: string; municipality: string; canton: string; bfs: number | null },
  rules: ImportFilterRules,
  nowIso: string
): Promise<number> {
  try {
    const query = () =>
      admin.from("norms").select(UPLOAD_COLUMNS).not("org_id", "is", null).is("source_kind", null).eq("jurisdiction_type", "municipal");
    const [byName, byBfs] = await Promise.all([
      query().eq("jurisdiction_name", official.municipality),
      official.bfs !== null ? query().eq("jurisdiction_bfs", official.bfs) : Promise.resolve({ data: [], error: null }),
    ]);
    const error = byName.error ?? byBfs.error;
    if (error) {
      if (!isMissingSchema(error.message)) console.error("Uploads nicht vergleichbar:", error.message);
      return 0;
    }
    const seen = new Map<string, UploadRow>();
    for (const row of [...(byName.data ?? []), ...(byBfs.data ?? [])] as unknown as UploadRow[]) {
      if (row.jurisdiction_canton && row.jurisdiction_canton !== official.canton) continue;
      if (row.jurisdiction_bfs != null && official.bfs != null && row.jurisdiction_bfs !== official.bfs) continue;
      seen.set(row.id, row);
    }

    let changed = 0;
    for (const link of planUploadLinks(official.id, official.text, Array.from(seen.values()), rules)) {
      const patch =
        link.action === "link"
          ? { superseded_by_norm_id: official.id, superseded_similarity: link.similarity, superseded_at: nowIso }
          : { superseded_by_norm_id: null, superseded_similarity: null, superseded_at: null };
      if (link.action === "link" && seen.get(link.uploadId)?.superseded_by_norm_id === official.id) continue;
      const { error: updateError } = await admin.from("norms").update(patch).eq("id", link.uploadId).is("source_kind", null);
      if (updateError) console.error("Upload-Ablösung nicht gespeichert:", updateError.message);
      else changed++;
    }
    return changed;
  } catch (e) {
    console.error("Uploads nicht vergleichbar:", e instanceof Error ? e.message : String(e));
    return 0;
  }
}

/**
 * Nach einem neuen Upload: Gegen die geltenden amtlichen Normen seiner Gemeinde prüfen, damit er
 * gar nicht erst aktiv wird. Wirft nie: Ein Upload darf daran nicht scheitern.
 */
export async function linkUploadToOfficial(
  admin: SupabaseClient,
  upload: { id: string; text: string; jurisdiction_type: string; jurisdiction_name: string | null },
  loadRules: (canton: string) => Promise<ImportFilterRules>,
  nowIso: string = new Date().toISOString()
): Promise<boolean> {
  if (upload.jurisdiction_type !== "municipal" || !upload.jurisdiction_name) return false;
  try {
    const { data, error } = await admin
      .from("norms")
      .select("id, text, jurisdiction_canton")
      .is("org_id", null)
      .eq("source_kind", "oereb_auto")
      .eq("auto_scope", "municipal")
      .eq("jurisdiction_name", upload.jurisdiction_name);
    if (error) {
      if (!isMissingSchema(error.message)) console.error("Upload nicht vergleichbar:", error.message);
      return false;
    }
    let best: { id: string; similarity: number } | null = null;
    for (const official of (data ?? []) as { id: string; text: string | null; jurisdiction_canton: string | null }[]) {
      const rules = await loadRules(official.jurisdiction_canton ?? "");
      const [link] = planUploadLinks(official.id, official.text ?? "", [{ id: upload.id, text: upload.text }], rules);
      if (link?.action === "link" && (!best || link.similarity > best.similarity)) best = { id: official.id, similarity: link.similarity };
    }
    if (!best) return false;
    const { error: updateError } = await admin
      .from("norms")
      .update({ superseded_by_norm_id: best.id, superseded_similarity: best.similarity, superseded_at: nowIso })
      .eq("id", upload.id);
    if (updateError) {
      if (!isMissingSchema(updateError.message)) console.error("Upload-Ablösung nicht gespeichert:", updateError.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Upload nicht vergleichbar:", e instanceof Error ? e.message : String(e));
    return false;
  }
}
