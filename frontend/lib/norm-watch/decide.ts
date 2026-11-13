import type { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { assignNormsToOrgProjects } from "@/lib/norm-assignment";
import { uploadCountry } from "@/lib/norm-applies";
import { insertNormWithCountry, type NormInsertClient } from "@/lib/norm-country";
import { normTextHash } from "@/lib/norm-hash";
import { updateNormRow } from "./norm-write";
import { SOURCE_COLUMNS } from "./overview";
import { nextTitle } from "./status";
import type { NormSourceRow } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export interface Actor {
  id: string;
  email: string;
}

export type DecisionResult =
  | { ok: true; normId: string | null; announcementId: string | null }
  | { ok: false; status: number; message: string };

interface ClaimedDraft {
  id: string;
  source_id: string;
  norm_id: string | null;
  remote_version: string;
  remote_label: string;
  new_text: string;
}

const LAYER_BY_TYPE: Record<string, number> = { national: 1, cantonal: 3 };
const REASSIGN_BUDGET_MS = 45_000;

async function claimDraft(admin: Admin, actor: Actor, draftId: string, status: "approved" | "rejected"): Promise<ClaimedDraft | null> {
  const { data, error } = await admin
    .from("norm_update_drafts")
    .update({ status, decided_at: new Date().toISOString(), decided_by: actor.id, decided_by_email: actor.email })
    .eq("id", draftId)
    .eq("status", "draft")
    .select("id, source_id, norm_id, remote_version, remote_label, new_text")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ClaimedDraft | null) ?? null;
}

async function releaseDraft(admin: Admin, draftId: string): Promise<void> {
  const { error } = await admin
    .from("norm_update_drafts")
    .update({ status: "draft", decided_at: null, decided_by: null, decided_by_email: null })
    .eq("id", draftId);
  if (error) console.error("norm-watch: Entwurf nicht freigegeben", draftId, error.message);
}

async function loadSource(admin: Admin, id: string): Promise<NormSourceRow | null> {
  const { data, error } = await admin.from("norm_sources").select(SOURCE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as NormSourceRow | null) ?? null;
}

async function createAnnouncement(admin: Admin, actor: Actor, source: NormSourceRow, remoteLabel: string): Promise<string | null> {
  const { data, error } = await admin
    .from("announcements")
    .insert({
      org_id: null,
      title: `Rechtsgrundlage aktualisiert: ${source.label}`.slice(0, 120),
      message: `${source.label} gilt in der Fassung «${remoteLabel}». Neue Prüfungen verwenden ab sofort diesen Stand.`.slice(0, 1000),
      type: "info",
      active: false,
      dismissible: true,
      created_by: actor.id,
      created_by_email: actor.email,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("norm-watch: Ankündigungsentwurf nicht gespeichert", error?.code);
    return null;
  }
  return (data as { id: string }).id;
}

async function reassignAllOrgs(admin: Admin): Promise<void> {
  const { data: orgs } = await admin.from("organizations").select("id").is("deleted_at", null);
  const deadline = Date.now() + REASSIGN_BUDGET_MS;
  for (const org of orgs ?? []) {
    if (Date.now() > deadline) {
      console.error("norm-watch: Zuweisung nach Zeitbudget abgebrochen, der Rest folgt beim nächsten Abgleich der Organisation");
      return;
    }
    try {
      await assignNormsToOrgProjects(org.id as string);
    } catch (e) {
      console.error("norm-watch: Zuweisung fehlgeschlagen", org.id, e instanceof Error ? e.message : "unbekannt");
    }
  }
}

async function applyToExistingNorm(admin: Admin, actor: Actor, draft: ClaimedDraft, source: NormSourceRow, normId: string): Promise<void> {
  const { data, error } = await admin.from("norms").select("title, text").eq("id", normId).maybeSingle();
  if (error) throw new Error(error.message);
  const norm = data as { title: string | null; text: string | null } | null;
  if (!norm) throw new Error("Die verknüpfte Norm existiert nicht mehr.");

  const archived = await admin.from("norm_text_versions").insert({
    norm_id: normId,
    text: norm.text ?? "",
    version_label: source.applied_label,
    draft_id: draft.id,
    archived_by_email: actor.email,
  });
  if (archived.error) throw new Error(archived.error.message);

  const writeError = await updateNormRow(admin, normId, {
    text: draft.new_text,
    title: nextTitle(norm.title ?? source.label, source.label, draft.remote_label),
  });
  if (writeError) throw new Error(writeError);
}

async function createNormFromDraft(admin: Admin, draft: ClaimedDraft, source: NormSourceRow): Promise<string> {
  const national = source.jurisdiction_type === "national";
  const { data, error } = await insertNormWithCountry(
    admin as unknown as NormInsertClient,
    {
      title: `${source.label}, ${draft.remote_label}`,
      domain: "bau",
      layer: LAYER_BY_TYPE[source.jurisdiction_type] ?? 3,
      jurisdiction_type: source.jurisdiction_type,
      jurisdiction_name: national ? null : source.jurisdiction_name,
      org_id: null,
      category: source.category,
      text: draft.new_text,
      source_url: source.label,
      zone: null,
      pdf_url: null,
    },
    uploadCountry(source.jurisdiction_type, source.jurisdiction_name, null),
  );
  if (error || !data) throw new Error(error?.message ?? "Norm konnte nicht angelegt werden.");
  return data.id;
}

async function markSourceApplied(admin: Admin, source: NormSourceRow, draft: ClaimedDraft, normId: string): Promise<string | null> {
  const patch = {
    norm_id: normId,
    applied_version: draft.remote_version,
    applied_label: draft.remote_label,
    remote_version: draft.remote_version,
    remote_label: draft.remote_label,
    status: "current",
    last_error: null,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin.from("norm_sources").update(patch).eq("id", source.id);
    if (!error) return null;
    if (attempt === 1) return error.message;
  }
  return null;
}

export async function approveDraft(admin: Admin, actor: Actor, draftId: string): Promise<DecisionResult> {
  const draft = await claimDraft(admin, actor, draftId, "approved");
  if (!draft) return { ok: false, status: 409, message: "Der Entwurf ist nicht mehr offen." };

  let committed = false;
  try {
    const source = await loadSource(admin, draft.source_id);
    if (!source) throw new Error("Die Quelle existiert nicht mehr.");

    if (draft.norm_id !== source.norm_id) {
      await admin.from("norm_update_drafts").update({ status: "superseded" }).eq("id", draft.id);
      return {
        ok: false,
        status: 409,
        message: "Die Zuordnung der Norm hat sich seit dem Entwurf geändert. Der Entwurf wurde verworfen, bitte neu prüfen.",
      };
    }

    let normId = source.norm_id;
    let created = false;
    if (normId) {
      await applyToExistingNorm(admin, actor, draft, source, normId);
    } else {
      normId = await createNormFromDraft(admin, draft, source);
      created = true;
    }
    committed = true;

    const sourceError = await markSourceApplied(admin, source, draft, normId);
    if (sourceError) {
      console.error("norm-watch: Quelle nicht aktualisiert", source.id, sourceError);
      return {
        ok: false,
        status: 500,
        message: "Der Text wurde ersetzt, aber der Status der Quelle konnte nicht gespeichert werden. Der nächste Abgleich bereinigt das.",
      };
    }

    if (created) await reassignAllOrgs(admin);

    const announcementId = await createAnnouncement(admin, actor, source, draft.remote_label);
    if (announcementId) await admin.from("norm_update_drafts").update({ announcement_id: announcementId }).eq("id", draft.id);

    await logAudit(admin, {
      orgId: null,
      actorId: actor.id,
      actorEmail: actor.email,
      action: "norm_watch_approve",
      targetId: normId,
      meta: {
        source: source.label,
        version: draft.remote_label,
        draft: draft.id,
        created,
        chars: draft.new_text.length,
        sha256: normTextHash(draft.new_text),
      },
    });
    return { ok: true, normId, announcementId };
  } catch (e) {
    console.error("norm-watch: Freigabe fehlgeschlagen", e instanceof Error ? e.message : "unbekannt");
    if (!committed) await releaseDraft(admin, draft.id);
    return { ok: false, status: 500, message: e instanceof Error ? e.message : "Freigabe fehlgeschlagen." };
  }
}

export async function rejectDraft(admin: Admin, actor: Actor, draftId: string): Promise<DecisionResult> {
  const draft = await claimDraft(admin, actor, draftId, "rejected");
  if (!draft) return { ok: false, status: 409, message: "Der Entwurf ist nicht mehr offen." };

  try {
    const source = await loadSource(admin, draft.source_id);
    const { error } = await admin
      .from("norm_sources")
      .update({ ignored_version: draft.remote_version, status: "current", last_error: null })
      .eq("id", draft.source_id);
    if (error) throw new Error(error.message);
    await logAudit(admin, {
      orgId: null,
      actorId: actor.id,
      actorEmail: actor.email,
      action: "norm_watch_reject",
      targetId: draft.norm_id ?? undefined,
      meta: { source: source?.label ?? null, version: draft.remote_label, draft: draft.id },
    });
    return { ok: true, normId: draft.norm_id, announcementId: null };
  } catch (e) {
    await releaseDraft(admin, draft.id);
    return { ok: false, status: 500, message: e instanceof Error ? e.message : "Ablehnen fehlgeschlagen." };
  }
}
