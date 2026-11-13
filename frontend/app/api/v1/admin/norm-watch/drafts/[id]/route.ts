import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { UUID_RE } from "@/lib/norm-watch/deps";
import { describeChange, similarity } from "@/lib/norm-watch/text";
import type { DraftDetail, DraftDiff } from "@/lib/norm-watch/types";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();
  if (!UUID_RE.test(params.id)) return err("Ungültige ID.", 400);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("norm_update_drafts")
    .select("id, source_id, norm_id, remote_label, new_chars, old_chars, similarity, diff, created_at, status")
    .eq("id", params.id)
    .maybeSingle();
  if (error) {
    console.error("norm-watch draft", error.code);
    return err("Entwurf konnte nicht geladen werden.", 500);
  }
  if (!data) return err("Entwurf nicht gefunden.", 404);
  const draft = data as {
    id: string;
    source_id: string;
    norm_id: string | null;
    remote_label: string;
    new_chars: number;
    old_chars: number;
    similarity: number | null;
    diff: DraftDiff;
    created_at: string;
    status: DraftDetail["status"];
  };

  const { data: source } = await admin
    .from("norm_sources")
    .select("label, applied_label")
    .eq("id", draft.source_id)
    .maybeSingle();
  let normTitle: string | null = null;
  let diff = draft.diff;
  let currentSimilarity = draft.similarity;
  if (draft.norm_id) {
    const { data: norm } = await admin.from("norms").select("title, text").eq("id", draft.norm_id).maybeSingle();
    const row = norm as { title: string | null; text: string | null } | null;
    normTitle = row?.title ?? null;
    if (row?.text) {
      const { data: full } = await admin.from("norm_update_drafts").select("new_text").eq("id", params.id).maybeSingle();
      const newText = (full as { new_text: string | null } | null)?.new_text;
      if (newText) {
        diff = describeChange(row.text, newText).diff;
        currentSimilarity = similarity(row.text, newText);
      }
    }
  }

  const detail: DraftDetail = {
    id: draft.id,
    sourceId: draft.source_id,
    label: (source as { label: string } | null)?.label ?? "",
    normId: draft.norm_id,
    normTitle,
    remoteLabel: draft.remote_label,
    appliedLabel: (source as { applied_label: string | null } | null)?.applied_label ?? null,
    newChars: draft.new_chars,
    oldChars: draft.old_chars,
    similarity: currentSimilarity,
    diff,
    status: draft.status,
    createdAt: draft.created_at,
  };
  return ok(detail);
}
