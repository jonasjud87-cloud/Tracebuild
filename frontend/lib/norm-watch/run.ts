import type { createAdminClient } from "@/lib/supabase/admin";
import { normTextTooLongMessage } from "@/lib/norm-text";
import { fedlexCurrent, type FetchLike } from "./fedlex";
import { updateNormRow } from "./norm-write";
import { loadSources } from "./overview";
import { sgCurrent, type PdfTextExtractor } from "./sg";
import { nextTitle } from "./status";
import { describeChange, similarity } from "./text";
import type { CheckOutcome, CheckSummary, NormSourceRow, RemoteVersion } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export interface WatchDeps {
  admin: Admin;
  fetchFn: FetchLike;
  extractPdf: PdfTextExtractor;
  now: () => Date;
}

const ERROR_LIMIT = 500;
const DEFAULT_BUDGET_MS = 120_000;
const UNIQUE_VIOLATION = "23505";

function remoteFor(deps: WatchDeps, source: NormSourceRow): Promise<RemoteVersion> {
  return source.provider === "fedlex"
    ? fedlexCurrent(source.identifier, deps.now(), deps.fetchFn)
    : sgCurrent(source.identifier, deps.fetchFn, deps.extractPdf);
}

async function patchSource(deps: WatchDeps, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await deps.admin.from("norm_sources").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

async function openDraftVersion(deps: WatchDeps, sourceId: string): Promise<{ id: string; remote_version: string } | null> {
  const { data, error } = await deps.admin
    .from("norm_update_drafts")
    .select("id, remote_version")
    .eq("source_id", sourceId)
    .eq("status", "draft")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; remote_version: string } | null) ?? null;
}

async function supersedeOpenDraft(deps: WatchDeps, sourceId: string): Promise<void> {
  const { error } = await deps.admin
    .from("norm_update_drafts")
    .update({ status: "superseded", decided_at: deps.now().toISOString() })
    .eq("source_id", sourceId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
}

async function loadNormText(deps: WatchDeps, normId: string): Promise<{ text: string; title: string }> {
  const { data, error } = await deps.admin.from("norms").select("title, text").eq("id", normId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { title: string | null; text: string | null } | null;
  return { text: row?.text ?? "", title: row?.title ?? "" };
}

export async function checkSource(deps: WatchDeps, source: NormSourceRow): Promise<CheckOutcome> {
  const base = { sourceId: source.id, label: source.label };
  const checkedAt = deps.now().toISOString();
  try {
    const remote = await remoteFor(deps, source);
    const remoteFields = { remote_version: remote.version, remote_label: remote.label, last_checked_at: checkedAt, last_error: null };
    const open = await openDraftVersion(deps, source.id);

    if (remote.version === source.ignored_version) {
      if (open && open.remote_version === remote.version) await supersedeOpenDraft(deps, source.id);
      await patchSource(deps, source.id, { ...remoteFields, status: "current" });
      return { ...base, result: "ignored" };
    }

    if (source.norm_id && remote.version === source.applied_version) {
      if (open) await supersedeOpenDraft(deps, source.id);
      await patchSource(deps, source.id, { ...remoteFields, status: "current" });
      return { ...base, result: "current" };
    }

    if (open && open.remote_version === remote.version) {
      await patchSource(deps, source.id, { ...remoteFields, status: "update_available" });
      return { ...base, result: "draft_exists" };
    }

    const text = await remote.fetchText();
    const tooLong = normTextTooLongMessage(text);
    if (tooLong) throw new Error(tooLong);

    const current = source.norm_id ? await loadNormText(deps, source.norm_id) : null;
    const oldText = current?.text ?? "";
    const { changed, diff } = describeChange(oldText, text);

    if (current && oldText && !changed) {
      const titleError = await updateNormRow(deps.admin, source.norm_id as string, {
        title: nextTitle(current.title, source.label, remote.label),
      });
      if (titleError) throw new Error(titleError);
      if (open) await supersedeOpenDraft(deps, source.id);
      await patchSource(deps, source.id, {
        ...remoteFields,
        applied_version: remote.version,
        applied_label: remote.label,
        status: "current",
      });
      return { ...base, result: "adopted" };
    }

    if (open) await supersedeOpenDraft(deps, source.id);
    const { error } = await deps.admin.from("norm_update_drafts").insert({
      source_id: source.id,
      norm_id: source.norm_id,
      remote_version: remote.version,
      remote_label: remote.label,
      new_text: text,
      new_chars: text.length,
      old_chars: oldText.length,
      similarity: oldText ? similarity(oldText, text) : null,
      diff,
    });
    if (error && (error as { code?: string }).code !== UNIQUE_VIOLATION) throw new Error(error.message);
    await patchSource(deps, source.id, { ...remoteFields, status: "update_available" });
    return { ...base, result: error ? "draft_exists" : "draft_created" };
  } catch (e) {
    const message = (e instanceof Error ? e.message : "Unbekannter Fehler").slice(0, ERROR_LIMIT);
    try {
      await patchSource(deps, source.id, { status: "error", last_error: message, last_checked_at: checkedAt });
    } catch {
      console.error("norm-watch: Fehlerstatus nicht gespeichert", source.id);
    }
    return { ...base, result: "error", message };
  }
}

function byOldestCheck(a: NormSourceRow, b: NormSourceRow): number {
  if (!a.last_checked_at && !b.last_checked_at) return a.label.localeCompare(b.label, "de");
  if (!a.last_checked_at) return -1;
  if (!b.last_checked_at) return 1;
  return a.last_checked_at.localeCompare(b.last_checked_at);
}

export async function runWatch(deps: WatchDeps, opts: { sourceId?: string; budgetMs?: number } = {}): Promise<CheckSummary> {
  const all = await loadSources(deps.admin);
  const sources = all.filter((s) => s.enabled && (!opts.sourceId || s.id === opts.sourceId)).sort(byOldestCheck);
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const startedAt = deps.now().getTime();
  const outcomes: CheckOutcome[] = [];
  for (const source of sources) {
    if (outcomes.length > 0 && deps.now().getTime() - startedAt > budget) break;
    outcomes.push(await checkSource(deps, source));
  }
  return {
    checked: outcomes.length,
    skipped: sources.length - outcomes.length,
    draftsCreated: outcomes.filter((o) => o.result === "draft_created").length,
    adopted: outcomes.filter((o) => o.result === "adopted").length,
    errors: outcomes.filter((o) => o.result === "error").length,
    outcomes,
  };
}
