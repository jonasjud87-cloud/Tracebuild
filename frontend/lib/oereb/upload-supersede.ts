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
  org_authoritative?: boolean | null;
}

export type UploadLink =
  | { action: "link"; uploadId: string; similarity: number }
  | { action: "unlink"; uploadId: string };

type UploadRules = Pick<ImportFilterRules, "upload_similarity_min" | "min_text_chars">;

/**
 * Rein. Zu kurze Uploads (Scans) bleiben unberührt. Anteil des Uploads, der im amtlichen Text steht:
 * Ein Auszug daraus gilt als abgelöst, eine Sammlung mit eigenem Inhalt nicht. Ein massgebender Upload
 * behält seinen Verweis: Er sagt, welche amtliche Norm er verdrängt.
 */
export function planUploadLink(officialId: string, official: Set<number>, upload: UploadRow, rules: UploadRules): UploadLink | null {
  const text = (upload.text ?? "").trim();
  const similarity = text.length >= rules.min_text_chars ? containment(shingleSet(text), official) : 0;
  if (similarity >= rules.upload_similarity_min) return { action: "link", uploadId: upload.id, similarity };
  if (upload.superseded_by_norm_id === officialId && !upload.org_authoritative) return { action: "unlink", uploadId: upload.id };
  return null;
}

export function planUploadLinks(officialId: string, officialText: string, uploads: UploadRow[], rules: UploadRules): UploadLink[] {
  const official = shingleSet(officialText);
  return uploads.map((u) => planUploadLink(officialId, official, u, rules)).filter((l): l is UploadLink => !!l);
}

const UPLOAD_META = "id, jurisdiction_canton, jurisdiction_bfs, superseded_by_norm_id, org_authoritative";

/**
 * Nach Import oder Änderung einer amtlichen Gemeinde-Norm. Objektbezogene Vorschriften lösen nichts
 * ab: Sie gelten nicht für jedes Grundstück der Gemeinde. Erst die Zeilen, dann je Upload der Text: Ein
 * paralleles Laden aller Volltexte sprengte den Speicher. Uploads setzen weder BFS noch Kanton zwingend,
 * deshalb der Name; ein abweichender Kanton oder eine abweichende BFS schliesst aus. Wirft nie.
 */
export async function linkSimilarUploads(
  admin: SupabaseClient,
  official: { id: string; text: string; municipality: string; canton: string; bfs: number | null },
  rules: ImportFilterRules,
  nowIso: string
): Promise<number> {
  try {
    const { data, error } = await admin
      .from("norms")
      .select(UPLOAD_META)
      .not("org_id", "is", null)
      .is("source_kind", null)
      .eq("jurisdiction_type", "municipal")
      .eq("jurisdiction_name", official.municipality);
    if (error) {
      if (!isMissingSchema(error.message)) console.error("Uploads nicht vergleichbar:", error.message);
      return 0;
    }
    const uploads = ((data ?? []) as unknown as Omit<UploadRow, "text">[]).filter(
      (row) =>
        (!row.jurisdiction_canton || row.jurisdiction_canton === official.canton) &&
        (row.jurisdiction_bfs == null || official.bfs == null || row.jurisdiction_bfs === official.bfs)
    );
    if (!uploads.length) return 0;

    const officialSet = shingleSet(official.text);
    let changed = 0;
    for (const upload of uploads) {
      const { data: full, error: textError } = await admin.from("norms").select("text").eq("id", upload.id).maybeSingle();
      if (textError) {
        console.error("Upload nicht lesbar:", textError.message);
        continue;
      }
      const link = planUploadLink(official.id, officialSet, { ...upload, text: (full as { text: string | null } | null)?.text ?? null }, rules);
      if (!link || (link.action === "link" && upload.superseded_by_norm_id === official.id)) continue;

      // Nur ändern, was wir gelesen haben: Ein paralleler Lauf kann den Verweis schon gesetzt haben.
      const previous = upload.superseded_by_norm_id ?? null;
      const patch =
        link.action === "link"
          ? { superseded_by_norm_id: official.id, superseded_similarity: link.similarity, superseded_at: nowIso }
          : { superseded_by_norm_id: null, superseded_similarity: null, superseded_at: null };
      let query = admin.from("norms").update(patch).eq("id", upload.id).is("source_kind", null);
      query = previous ? query.eq("superseded_by_norm_id", previous) : query.is("superseded_by_norm_id", null);
      const { error: updateError, data: updated } = await query.select("id");
      if (updateError) console.error("Upload-Ablösung nicht gespeichert:", updateError.message);
      else if (updated?.length) changed++;
    }
    return changed;
  } catch (e) {
    console.error("Uploads nicht vergleichbar:", e instanceof Error ? e.message : String(e));
    return 0;
  }
}

/**
 * Massgebender Upload zeigte auf eine zurückgenommene Norm: Der Nachfolger darf nicht zusätzlich laufen,
 * auch wenn der Text unter der Grenze liegt. Der Entscheid der Org gilt dem Erlass, nicht der Fassung.
 */
export async function repointAuthoritativeUploads(admin: SupabaseClient, oldNormId: string, newNormId: string): Promise<void> {
  const { error } = await admin
    .from("norms")
    .update({ superseded_by_norm_id: newNormId })
    .eq("superseded_by_norm_id", oldNormId)
    .eq("org_authoritative", true);
  if (error && !isMissingSchema(error.message)) console.error("Massgebender Upload nicht umgehängt:", error.message);
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
      .select("id, jurisdiction_canton")
      .is("org_id", null)
      .eq("source_kind", "oereb_auto")
      .eq("auto_scope", "municipal")
      .eq("jurisdiction_name", upload.jurisdiction_name);
    if (error) {
      if (!isMissingSchema(error.message)) console.error("Upload nicht vergleichbar:", error.message);
      return false;
    }
    let best: { id: string; similarity: number } | null = null;
    for (const official of (data ?? []) as { id: string; jurisdiction_canton: string | null }[]) {
      const { data: full, error: textError } = await admin.from("norms").select("text").eq("id", official.id).maybeSingle();
      if (textError) continue;
      const rules = await loadRules(official.jurisdiction_canton ?? "");
      const text = (full as { text: string | null } | null)?.text ?? "";
      const [link] = planUploadLinks(official.id, text, [{ id: upload.id, text: upload.text }], rules);
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
