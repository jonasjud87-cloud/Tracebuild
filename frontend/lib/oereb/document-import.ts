/**
 * Import eines ÖREB-Dokuments als globale Norm, ein Dokument pro Request (eigene 300 s). Läuft nie
 * im Analysepfad. Manuell gepflegte Normen (`source_kind IS NULL`) werden nie überschrieben.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentSyncResponse } from "../geoadmin/contract";
import { logAudit, type AuditAction } from "../auditLog";
import { normTextHash } from "../norm-hash";
import { normTextTooLongMessage } from "../norm-text";
import { isMissingSchema } from "../supabase/schema-errors";
import { backoffUntil, decideIdentity, decideUpdate, nextRecheck, type ManualNormRef } from "./document-decisions";
import { fetchDocument, type DocumentFetchResult } from "./document-fetch";
import {
  isCapped,
  isDocumentDue,
  orderDueDocuments,
  syncProjectDocuments,
  type OerebDocumentRow,
  type ProjectDocumentState,
} from "./documents";
import { VERSION_COLUMNS, measureDocument } from "./document-versions";
import { readPdfWithClaude, textWithoutPageMarkers, pageCountFromText, type OcrClient, type OcrResult } from "./document-ocr";
import {
  MANUAL_EXCLUDE_REASON,
  OLDER_VERSION_REASON,
  contentStatus,
  decideContent,
  decidePreDownload,
  isNeutralScopeCandidate,
  isOcrCandidate,
  neutralScopeEvidence,
  scopeOf,
  type ImportFilterRules,
} from "./import-filter";
import { titleKey } from "./title-key";
import { linkSimilarUploads } from "./upload-supersede";

const LOCK_SECONDS = 300;
const PARSE_TIMEOUT_MS = 120_000;
/** Ab so vielen Versuchen gilt ein neues Dokument als fehlgeschlagen, auch wenn der Lauf abstürzt. */
const MAX_PENDING_ATTEMPTS = 3;
const UNIQUE_VIOLATION = "23505";

type Outcome = NonNullable<DocumentSyncResponse["processed"]>["outcome"];

export interface ImportActor {
  id: string;
  email: string;
}

export interface ImportDeps {
  fetchDoc?: (url: string, opts: Parameters<typeof fetchDocument>[1]) => Promise<DocumentFetchResult>;
  /** PDF-Text. Der Standard lädt pdf-parse erst bei Bedarf. */
  extractText?: (bytes: Buffer) => Promise<string>;
  /** Weist eine neue Norm den betroffenen Projekten zu. */
  assignNew?: (normId: string) => Promise<void>;
  /** Modell-Client fürs Lesen von Scans. Der Standard wird erst bei Bedarf geladen. */
  ocrClient?: OcrClient;
}

/** Spalten aus 20261109000001. Fehlen sie noch, speichert der Import ohne sie. */
const EXTRA_COLUMNS = ["scope_reason", "text_source"] as const;

/** Der Admin hat den Import verlangt. Host-Prüfung, Duplikate und Schrumpfschutz gelten weiter. */
const isForced = (doc: { manual_decision?: string | null }) => doc.manual_decision === "force_import";

async function defaultExtractText(bytes: Buffer): Promise<string> {
  const { extractPdfText } = await import("../pdf-text");
  return extractPdfText(bytes, { timeoutMs: PARSE_TIMEOUT_MS });
}

/** Postgres speichert kein NUL-Zeichen; manche PDFs liefern es. */
function cleanText(text: string): string {
  return text.replaceAll("\u0000", "").trim();
}

// ── Sperre ───────────────────────────────────────────────────────────────────

/**
 * Atomar in einem Statement: Von zwei gleichzeitigen Aufrufen erhält nur einer die Zeile, also
 * wird höchstens einmal geladen. Das Hochzählen von `attempts` aus dem gelesenen Wert genügt, weil
 * die Bedingung auf `lock_until` den zweiten Aufruf ausschliesst.
 */
export async function acquireDocumentLock(
  admin: SupabaseClient,
  doc: { id: string; attempts?: number | null; status?: string },
  now: Date = new Date()
): Promise<OerebDocumentRow | null> {
  const iso = now.toISOString();
  const attempts = (doc.attempts ?? 0) + 1;
  // Schon beim Sperren: Stirbt der Lauf (Speicher, Timeout), schreibt niemand mehr etwas, und ohne
  // das liefe dasselbe PDF sofort wieder in denselben Absturz.
  const giveUp = doc.status === "pending" && attempts >= MAX_PENDING_ATTEMPTS;
  const { data, error } = await admin
    .from("oereb_documents")
    .update({
      lock_until: new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString(),
      attempts,
      next_check_at: backoffUntil(attempts, now.getTime()),
      ...(giveUp ? { status: "failed", reject_detail: `Nach ${attempts} Versuchen abgebrochen` } : {}),
    })
    .eq("id", doc.id)
    .or(`lock_until.is.null,lock_until.lt.${iso}`)
    .lte("next_check_at", iso)
    .select();
  if (error) throw new Error(`Sperre für ÖREB-Dokument fehlgeschlagen: ${error.message}`);
  return ((data ?? [])[0] as OerebDocumentRow | undefined) ?? null;
}

// ── Lesen ────────────────────────────────────────────────────────────────────

interface NormRow {
  id: string;
  title: string;
  text: string;
  text_sha256: string | null;
  source_kind: string | null;
  source_url: string | null;
}

/** Manuell gepflegte globale Normen derselben Gemeinde (Name und Kanton oder BFS). */
async function loadManualNorms(admin: SupabaseClient, state: ProjectDocumentState): Promise<ManualNormRef[]> {
  const select = "id, title, text, jurisdiction_canton, jurisdiction_bfs";
  const query = () =>
    admin.from("norms").select(select).is("org_id", null).is("source_kind", null).eq("jurisdiction_type", "municipal");
  const [byName, byBfs] = await Promise.all([
    query().eq("jurisdiction_name", state.municipality),
    state.bfs !== null ? query().eq("jurisdiction_bfs", state.bfs) : Promise.resolve({ data: [], error: null }),
  ]);
  if (byName.error) throw new Error(`Normen konnten nicht gelesen werden: ${byName.error.message}`);
  if (byBfs.error) throw new Error(`Normen konnten nicht gelesen werden: ${byBfs.error.message}`);

  const seen = new Map<string, ManualNormRef>();
  type Row = { id: string; title: string; text: string | null; jurisdiction_canton: string | null };
  for (const n of [...(byName.data ?? []), ...(byBfs.data ?? [])] as Row[]) {
    if (n.jurisdiction_canton && n.jurisdiction_canton !== state.canton) continue;
    seen.set(n.id, {
      id: n.id,
      title_key: titleKey(n.title, state.municipality),
      text_sha256: n.text ? normTextHash(n.text) : null,
    });
  }
  return Array.from(seen.values());
}

async function loadNorm(admin: SupabaseClient, id: string): Promise<NormRow | null> {
  const { data, error } = await admin
    .from("norms")
    .select("id, title, text, text_sha256, source_kind, source_url")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Norm konnte nicht gelesen werden: ${error.message}`);
  return (data as NormRow | null) ?? null;
}

// ── Schreiben ────────────────────────────────────────────────────────────────

async function finish(admin: SupabaseClient, doc: OerebDocumentRow, patch: Record<string, unknown>): Promise<void> {
  const update = (p: Record<string, unknown>) => admin.from("oereb_documents").update({ ...p, lock_until: null }).eq("id", doc.id);
  let { error } = await update(patch);
  // Vor den Migrationen 20261107000001 und 20261109000001 fehlen Spalten: Der Entscheid selbst muss trotzdem halten.
  if (error && isMissingSchema(error.message)) {
    const reduced = { ...patch };
    for (const column of EXTRA_COLUMNS) delete reduced[column];
    ({ error } = await update(reduced));
    if (error && isMissingSchema(error.message)) {
      for (const column of VERSION_COLUMNS) delete reduced[column];
      ({ error } = await update(reduced));
    }
  }
  if (error) throw new Error(`ÖREB-Dokument konnte nicht gespeichert werden: ${error.message}`);
}

async function touchNorm(admin: SupabaseClient, normId: string, nowIso: string): Promise<void> {
  const { error } = await admin.from("norms").update({ source_checked_at: nowIso }).eq("id", normId);
  if (error) console.error(`source_checked_at der Norm ${normId} nicht gesetzt:`, error.message);
}

interface ImportContext {
  admin: SupabaseClient;
  state: ProjectDocumentState;
  rules: ImportFilterRules;
  actor: ImportActor;
  projectId: string;
  now: number;
  nowIso: string;
  /** Normen, deren Zuweisung am Ende neu zu berechnen ist. */
  reassign: Set<string>;
}

async function audit(ctx: ImportContext, action: AuditAction, normId: string, doc: OerebDocumentRow, meta: Record<string, unknown>) {
  await logAudit(ctx.admin as Parameters<typeof logAudit>[0], {
    orgId: null,
    actorId: ctx.actor.id,
    actorEmail: ctx.actor.email,
    action,
    targetId: normId,
    meta: {
      document_id: doc.id,
      url: doc.url_normalized,
      canton: doc.canton,
      bfs: doc.bfs_number,
      project_id: ctx.projectId,
      ...meta,
    },
  });
}

type InsertResult = { kind: "inserted"; id: string } | { kind: "manual"; id: string };

/** Vor dem Insert prüfen; 23505 aus einem parallelen Lauf gleich behandeln. */
async function insertNorm(
  ctx: ImportContext,
  doc: OerebDocumentRow,
  scope: string,
  text: string,
  textSha: string,
  pdfSha: string,
  aiRead: boolean
): Promise<InsertResult> {
  const { admin, state } = ctx;
  const row = {
    org_id: null,
    source_kind: "oereb_auto",
    auto_scope: scope,
    layer: 4,
    jurisdiction_type: "municipal",
    jurisdiction_name: state.municipality,
    jurisdiction_canton: state.canton,
    jurisdiction_bfs: state.bfs,
    domain: "bau",
    category: (doc.theme_codes ?? []).some((c) => /nutzungsplanung/i.test(c)) ? "Baureglement" : "Reglement",
    text,
    text_sha256: textSha,
    source_url: doc.url_normalized,
    pdf_url: doc.url_normalized,
    source_doc: `ÖREB ${state.canton}`,
    source_checked_at: ctx.nowIso,
    zone: null,
    ...(aiRead ? { text_read_by_ai: true } : {}),
  };

  const conflictingNorm = async (title: string) => {
    const { data, error } = await admin
      .from("norms")
      .select("id, source_kind")
      .eq("title", title)
      .eq("jurisdiction_type", "municipal")
      .eq("jurisdiction_name", state.municipality)
      .is("org_id", null)
      .maybeSingle();
    if (error) throw new Error(`Norm konnte nicht gelesen werden: ${error.message}`);
    return data as { id: string; source_kind: string | null } | null;
  };

  let title = doc.title;
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await conflictingNorm(title);
    if (existing && !existing.source_kind) return { kind: "manual", id: existing.id };
    if (existing) title = `${doc.title} [${pdfSha.slice(0, 6)}]`;

    const { data, error } = await admin.from("norms").insert({ ...row, title }).select("id").single();
    if (!error && data) return { kind: "inserted", id: (data as { id: string }).id };
    if (error?.code !== UNIQUE_VIOLATION) throw new Error(`Norm konnte nicht angelegt werden: ${error?.message}`);
  }
  throw new Error("Norm konnte wegen eines Titelkonflikts nicht angelegt werden");
}

/** Nur amtliche Gemeinde-Normen lösen Uploads ab. Zählt für die Neuzuweisung der Gemeinde. */
async function relinkUploads(ctx: ImportContext, doc: OerebDocumentRow, normId: string, text: string): Promise<void> {
  if ((doc.scope ?? scopeOf(doc.title, ctx.rules)) !== "municipal") return;
  const { municipality, canton, bfs } = ctx.state;
  const changed = await linkSimilarUploads(ctx.admin, { id: normId, text, municipality, canton, bfs }, ctx.rules, ctx.nowIso);
  if (changed > 0) ctx.reassign.add(normId);
}

/**
 * Neutraler Titel, inzwischen als Gemeindeordnung belegt. Auch ohne neuen Download: Bereits als
 * `parcel` importierte Dokumente (Herisau) sollen nicht auf ein neues PDF warten müssen.
 */
async function upgradeNeutralScope(ctx: ImportContext, doc: OerebDocumentRow, normId: string, knownText?: string): Promise<void> {
  const { admin, rules, state } = ctx;
  if (doc.scope === "municipal" || !isNeutralScopeCandidate(doc, rules)) return;
  if (knownText === undefined && typeof doc.article_run === "number" && doc.article_run < rules.neutral_min_article_run) return;
  let text = knownText;
  if (text === undefined) {
    const norm = await loadNorm(admin, normId);
    if (norm?.source_kind !== "oereb_auto") return;
    text = norm.text ?? "";
  }
  const evidence = neutralScopeEvidence(doc, text, rules);
  if (!evidence || isCapped({ title: doc.title, scope: "municipal" }, state.all, rules)) return;

  const { data, error } = await admin
    .from("norms")
    .update({ auto_scope: "municipal" })
    .eq("id", normId)
    .eq("source_kind", "oereb_auto")
    .eq("auto_scope", "parcel")
    .select("id");
  if (error) {
    console.error(`Norm ${normId} nicht gemeindeweit gesetzt:`, error.message);
    return;
  }
  if (!data?.length) return;
  await finish(admin, doc, { scope: "municipal", scope_reason: evidence });
  ctx.reassign.add(normId);
  await relinkUploads(ctx, { ...doc, scope: "municipal" }, normId, text);
}

// ── Scans durch Claude lesen ─────────────────────────────────────────────────

async function saveOcrState(ctx: ImportContext, doc: OerebDocumentRow, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await ctx.admin.from("oereb_documents").update(patch).eq("id", doc.id);
  if (error) console.error(`Lesestand des ÖREB-Dokuments ${doc.id} nicht gespeichert:`, error.message);
  return !error;
}

/**
 * Derselbe PDF-Stand wurde schon gelesen und steht als Norm: Nicht nochmals bezahlen. Nur wenn die
 * Norm noch genau diesen Text trägt, sonst wäre es ein fremder Stand.
 */
async function findReadText(ctx: ImportContext, pdfSha: string): Promise<{ text: string; docId: string } | null> {
  const { data, error } = await ctx.admin
    .from("oereb_documents")
    .select("id, norm_id, text_sha256")
    .eq("ocr_pdf_sha256", pdfSha)
    .eq("ocr_status", "read")
    .not("norm_id", "is", null)
    .limit(5);
  if (error) throw new Error(`Gelesene Dokumente konnten nicht geprüft werden: ${error.message}`);
  for (const row of (data ?? []) as { id: string; norm_id: string; text_sha256: string | null }[]) {
    const norm = await loadNorm(ctx.admin, row.norm_id);
    if (norm?.text && norm.source_kind === "oereb_auto" && norm.text_sha256 === row.text_sha256) return { text: norm.text, docId: row.id };
  }
  return null;
}

function ocrStatePatch(doc: OerebDocumentRow, result: Exclude<OcrResult, { kind: "retry" }>, pdfSha: string, pages: number, nowIso: string): Record<string, unknown> {
  return {
    ocr_status: result.kind === "read" ? "read" : "failed",
    ocr_pdf_sha256: pdfSha,
    ocr_model: result.model,
    ocr_pages: pages,
    ocr_input_tokens: result.usage.input_tokens,
    ocr_output_tokens: result.usage.output_tokens,
    ocr_cost_usd: Number(((doc.ocr_cost_usd ?? 0) + result.costUsd).toFixed(6)),
    ocr_detail: result.kind === "read" ? null : `${result.reason}: ${result.detail}`,
    ocr_read_at: nowIso,
  };
}

/**
 * Text eines Scans, oder null, wenn es beim PDF-Text bleibt. Ein Versuch je PDF-Stand: Der Versuch wird
 * VOR dem Aufruf festgehalten, sodass auch ein Absturz der Funktion keinen zweiten Lauf bezahlt.
 * Wiederholt wird nur, was nichts gekostet hat. Einen neuen Versuch löst sonst nur ein neues PDF oder
 * ein Admin aus. Gesendet werden die Bytes aus dem eigenen, geprüften Abruf, nie die URL.
 */
async function readScan(ctx: ImportContext, doc: OerebDocumentRow, bytes: Buffer, text: string, pdfSha: string, deps: ImportDeps): Promise<string | null> {
  const { rules, nowIso, now } = ctx;
  // Im Stopp (auch wenn der Filter nicht lesbar ist) entstehen keine Kosten.
  if (!rules.ocr_enabled || rules.doc_types.length === 0 || !("ocr_status" in doc)) return null;
  if (textWithoutPageMarkers(text).length >= rules.min_text_chars) return null;
  if (!isForced(doc) && !isOcrCandidate(doc, rules)) return null;

  const known = await findReadText(ctx, pdfSha);
  if (known) {
    await saveOcrState(ctx, doc, { ocr_status: "read", ocr_pdf_sha256: pdfSha, ocr_detail: `Text von Dokument ${known.docId} übernommen`, ocr_read_at: nowIso });
    return known.text;
  }

  if (doc.ocr_status && doc.ocr_pdf_sha256 === pdfSha) {
    if (doc.ocr_status === "started") {
      await saveOcrState(ctx, doc, { ocr_status: "failed", ocr_detail: "aborted: Lauf wurde abgebrochen, Kosten unbekannt" });
    }
    return null;
  }

  const pages = pageCountFromText(text);
  const deadlineAt = now + rules.ocr_deadline_ms;
  if (deadlineAt - Date.now() < rules.ocr_min_call_ms) {
    // Download und Textprüfung haben die Zeit verbraucht. Nichts bezahlt: Ein neuer Request versucht es.
    throw new Error("Zu wenig Zeit für das Lesen des Scans in diesem Request");
  }

  const client = deps.ocrClient ?? ((await import("../anthropic")).anthropic as unknown as OcrClient);
  const result = await readPdfWithClaude(
    {
      bytes,
      title: doc.title,
      pages,
      rules,
      deadlineAt,
      onBeforeCall: async () => {
        const saved = await saveOcrState(ctx, doc, { ocr_status: "started", ocr_pdf_sha256: pdfSha, ocr_model: rules.ocr_model, ocr_pages: pages, ocr_detail: null, ocr_read_at: nowIso });
        if (!saved) throw new Error("Leseversuch konnte nicht festgehalten werden");
      },
    },
    client
  );

  if (result.kind === "retry") {
    await saveOcrState(ctx, doc, { ocr_status: null, ocr_pdf_sha256: null, ocr_detail: `retry: ${result.detail}` });
    throw new Error(`Scan konnte nicht gelesen werden: ${result.detail}`);
  }
  await saveOcrState(ctx, doc, ocrStatePatch(doc, result, pdfSha, pages, nowIso));
  return result.kind === "read" ? result.text : null;
}

// ── Vorhandene Norm aktualisieren (5.6) ──────────────────────────────────────

interface Downloaded {
  bytes: number;
  pdfSha: string;
  etag: string | null;
  lastModified: string | null;
}

async function updateNorm(
  ctx: ImportContext,
  doc: OerebDocumentRow,
  normId: string,
  text: string,
  file: Downloaded,
  supersededDocId: string | null,
  aiRead: boolean
): Promise<Outcome> {
  const { admin, rules, now, nowIso } = ctx;
  const norm = await loadNorm(admin, normId);
  if (!norm) {
    await finish(admin, doc, { status: "removed", norm_id: null, reject_detail: "Norm wurde gelöscht" });
    return "rejected";
  }
  const textSha = normTextHash(text);
  const measures = measureDocument(doc.title, text, rules);
  const common = {
    status: "imported",
    norm_id: normId,
    reject_reason: null,
    reject_detail: null,
    bytes: file.bytes,
    pdf_sha256: file.pdfSha,
    etag: file.etag,
    last_modified: file.lastModified,
    last_checked_at: nowIso,
    next_check_at: nextRecheck(rules, now),
    attempts: 0,
    scope: doc.scope ?? scopeOf(doc.title, rules),
  };
  const supersede = async () => {
    if (!supersededDocId) return;
    const { error } = await admin
      .from("oereb_documents")
      .update({ status: "rejected", reject_reason: "superseded", reject_detail: `Abgelöst durch ${doc.id}`, norm_id: null })
      .eq("id", supersededDocId);
    if (error) console.error(`Altes ÖREB-Dokument ${supersededDocId} nicht abgelöst:`, error.message);
  };

  // Jemand hat die Norm zur manuellen gemacht: Sie gehört nun nicht mehr dem Import.
  if (norm.source_kind !== "oereb_auto") {
    await finish(admin, doc, {
      ...common,
      last_update_status: "manual_takeover",
      last_update_detail: "Norm wird manuell gepflegt und nicht überschrieben",
    });
    return "kept_old";
  }

  const tooLong = normTextTooLongMessage(text);
  const decision = tooLong
    ? ({ action: "kept_old", detail: `too_long: ${text.length} Zeichen` } as const)
    : decideUpdate({
        oldTextSha: norm.text_sha256,
        oldChars: (norm.text ?? "").length,
        newTextSha: textSha,
        newText: text,
        rules,
        title: doc.title,
        forced: isForced(doc),
      });

  if (decision.action === "unchanged") {
    await supersede();
    await finish(admin, doc, { ...common, ...measures, chars: text.length, text_sha256: textSha, last_update_status: "unchanged", last_update_detail: null });
    await touchNorm(admin, normId, nowIso);
    await upgradeNeutralScope(ctx, { ...doc, ...common }, normId, text);
    return "unchanged";
  }

  if (decision.action === "kept_old") {
    // Bei einer neuen Version bleibt das alte Dokument gültig, das neue hat den Test nicht bestanden.
    await finish(admin, doc, supersededDocId
      ? { status: "rejected", reject_reason: "kept_old", reject_detail: decision.detail, last_checked_at: nowIso, filter_snapshot: rules }
      : { ...common, last_update_status: "rejected_shrink", last_update_detail: decision.detail });
    await audit(ctx, "norm_auto_update_rejected", normId, doc, {
      old_sha: norm.text_sha256,
      new_sha: textSha,
      old_chars: (norm.text ?? "").length,
      new_chars: text.length,
      detail: decision.detail,
    });
    return "kept_old";
  }

  // Alter Stand zuerst in norm_versions, dann Update mit optimistischer Bedingung.
  const { data: version, error: versionError } = await admin
    .from("norm_versions")
    .insert({
      norm_id: norm.id,
      title: norm.title,
      text: norm.text,
      text_sha256: norm.text_sha256 ?? normTextHash(norm.text ?? ""),
      source_url: norm.source_url,
    })
    .select("id")
    .single();
  if (versionError) throw new Error(`Normversion konnte nicht gespeichert werden: ${versionError.message}`);

  const patch: Record<string, unknown> = {
    text,
    text_sha256: textSha,
    source_url: doc.url_normalized,
    pdf_url: doc.url_normalized,
    source_checked_at: nowIso,
    // Nur wenn es zählt: Vor der Migration fehlt die Spalte, und mit Lesen aus ist sie immer false.
    ...(aiRead || doc.text_source === "ai_read" ? { text_read_by_ai: aiRead } : {}),
  };
  const applyPatch = (p: Record<string, unknown>) => {
    let q = admin.from("norms").update(p).eq("id", norm.id).eq("source_kind", "oereb_auto");
    q = norm.text_sha256 === null ? q.is("text_sha256", null) : q.eq("text_sha256", norm.text_sha256);
    return q.select("id");
  };
  // Eine neue Version kann den Titel ändern («Stand …»). Kollidiert er, bleibt der alte Titel.
  let result = await applyPatch(doc.title !== norm.title && supersededDocId ? { ...patch, title: doc.title } : patch);
  if (result.error?.code === UNIQUE_VIOLATION) result = await applyPatch(patch);
  if (result.error) throw new Error(`Norm konnte nicht aktualisiert werden: ${result.error.message}`);

  if (!result.data?.length) {
    // Konflikt: Ein paralleler Lauf war schneller. Kein Fehler, nächster Durchlauf entscheidet neu.
    await admin.from("norm_versions").delete().eq("id", (version as { id: string }).id);
    await finish(admin, doc, { last_update_status: "conflict", last_checked_at: nowIso, next_check_at: nextRecheck(rules, now) });
    return "unchanged";
  }

  await supersede();
  await finish(admin, doc, { ...common, ...measures, chars: text.length, text_sha256: textSha, text_source: aiRead ? "ai_read" : "pdf", last_update_status: "updated", last_update_detail: null });
  await relinkUploads(ctx, doc, norm.id, text);
  await upgradeNeutralScope(ctx, { ...doc, ...common }, norm.id, text);
  await audit(ctx, "norm_auto_update", norm.id, doc, {
    old_sha: norm.text_sha256,
    new_sha: textSha,
    old_chars: (norm.text ?? "").length,
    new_chars: text.length,
    ai_read: aiRead,
    forced: isForced(doc),
  });
  return "updated";
}

// ── Ein Dokument ─────────────────────────────────────────────────────────────

async function rejectNew(ctx: ImportContext, doc: OerebDocumentRow, reason: string, detail: string, extra: Record<string, unknown> = {}) {
  await finish(ctx.admin, doc, {
    status: "rejected",
    reject_reason: reason,
    reject_detail: detail,
    filter_snapshot: ctx.rules,
    last_checked_at: ctx.nowIso,
    ...extra,
  });
}

/**
 * Abgelehnte ältere Fassung nachprüfen: Hat sie sich geändert, zählen die neuen Messwerte beim
 * nächsten Vergleich. Selbst bleibt sie abgelehnt, den Entscheid fällt nur der Vergleich.
 */
async function recheckOlderVersion(ctx: ImportContext, doc: OerebDocumentRow, deps: ImportDeps): Promise<{ outcome: Outcome }> {
  const { admin, state, rules, now, nowIso } = ctx;
  const later = {
    attempts: 0,
    last_checked_at: nowIso,
    next_check_at: new Date(now + rules.older_version_recheck_hours * 3_600_000).toISOString(),
  };
  const res = await (deps.fetchDoc ?? fetchDocument)(doc.url_normalized, {
    rules,
    canton: state.canton,
    etag: doc.etag,
    lastModified: doc.last_modified,
  });
  if (res.kind !== "ok") {
    await finish(admin, doc, later);
    return { outcome: res.kind === "failed" ? "failed" : "unchanged" };
  }
  const pdfSha = createHash("sha256").update(res.bytes).digest("hex");
  const file = { etag: res.etag, last_modified: res.lastModified, pdf_sha256: pdfSha, bytes: res.bytes.length };
  if (doc.pdf_sha256 === pdfSha) {
    await finish(admin, doc, { ...later, ...file });
    return { outcome: "unchanged" };
  }
  try {
    const text = cleanText(await (deps.extractText ?? defaultExtractText)(res.bytes));
    await finish(admin, doc, { ...later, ...file, ...measureDocument(doc.title, text, rules), chars: text.length, text_sha256: normTextHash(text) });
    return { outcome: "updated" };
  } catch (e) {
    console.error(`Ältere Fassung ${doc.id} nicht lesbar:`, e instanceof Error ? e.message : String(e));
    await finish(admin, doc, later);
    return { outcome: "unchanged" };
  }
}

async function processDocument(ctx: ImportContext, doc: OerebDocumentRow, deps: ImportDeps): Promise<{ outcome: Outcome; newNormId?: string }> {
  const { admin, state, rules, now, nowIso } = ctx;

  // Ein Entscheid kann zwischen der Liste und der Sperre gefallen sein.
  if (doc.manual_decision === "exclude") {
    await finish(admin, doc, { status: "rejected", reject_reason: MANUAL_EXCLUDE_REASON, last_checked_at: nowIso });
    return { outcome: "rejected" };
  }
  if (doc.status === "rejected" && doc.reject_reason === OLDER_VERSION_REASON) return recheckOlderVersion(ctx, doc, deps);

  const forced = isForced(doc);
  // Der Admin hat eine Norm wieder freigegeben: Zuweisungen neu berechnen, egal wie der Abruf ausgeht.
  if (doc.norm_id && doc.last_update_status === "manual_restored") ctx.reassign.add(doc.norm_id);

  const isExisting = !!doc.norm_id;
  const scope = doc.scope ?? scopeOf(doc.title, rules);
  const self = { ...doc, scope };

  const manualNorms = isExisting ? [] : await loadManualNorms(admin, state);
  const identity = {
    doc: self,
    siblings: state.all,
    manualNorms,
    currentUrls: state.currentUrls,
    nowMs: now,
    supersedeAfterDays: rules.supersede_after_days,
  };

  const early = decideIdentity(identity);
  if (early.action === "removed" && !forced) {
    await finish(admin, doc, { status: "removed", reject_detail: early.detail, last_checked_at: nowIso });
    return { outcome: "rejected" };
  }
  if (early.action === "duplicate_manual") {
    await finish(admin, doc, { status: "duplicate_manual", norm_id: null, reject_detail: early.detail, last_checked_at: nowIso });
    return { outcome: "duplicate_manual" };
  }

  if (!isExisting) {
    const pre = decidePreDownload(
      { title: doc.title, doc_type: doc.doc_type, authority: doc.authority, url: doc.url_normalized },
      rules,
      state.canton
    );
    // Der Stopp und die Host-Prüfung gelten auch für einen Admin-Entscheid.
    if (pre && (!forced || pre.reason === "host_not_allowed" || rules.doc_types.length === 0)) {
      await rejectNew(ctx, doc, pre.reason, pre.detail);
      return { outcome: "rejected" };
    }
    if (!forced && early.action === "insert" && isCapped(doc, state.all, rules)) {
      await rejectNew(ctx, doc, "cap_reached", `Gemeinde hat bereits ${rules.max_accepted_per_municipality} importierte Gemeinde-Dokumente`);
      return { outcome: "rejected" };
    }
  }

  const res = await (deps.fetchDoc ?? fetchDocument)(doc.url_normalized, {
    rules,
    canton: state.canton,
    etag: isExisting ? doc.etag : null,
    lastModified: isExisting ? doc.last_modified : null,
  });

  if (res.kind === "not_modified") {
    await finish(admin, doc, {
      attempts: 0,
      last_checked_at: nowIso,
      next_check_at: nextRecheck(rules, now),
      last_update_status: "unchanged",
    });
    if (doc.norm_id) {
      await touchNorm(admin, doc.norm_id, nowIso);
      await upgradeNeutralScope(ctx, doc, doc.norm_id);
    }
    return { outcome: "unchanged" };
  }

  if (res.kind === "failed") {
    const next = backoffUntil(doc.attempts ?? 1, now);
    await finish(admin, doc, isExisting
      ? { last_checked_at: nowIso, next_check_at: next, last_update_status: "fetch_failed", last_update_detail: res.detail }
      : { status: "failed", reject_detail: res.detail, last_checked_at: nowIso, next_check_at: next });
    return { outcome: "failed" };
  }

  const keepOld = async (detail: string): Promise<{ outcome: Outcome }> => {
    await finish(admin, doc, {
      attempts: 0,
      last_checked_at: nowIso,
      next_check_at: nextRecheck(rules, now),
      last_update_status: "rejected_shrink",
      last_update_detail: detail,
    });
    await audit(ctx, "norm_auto_update_rejected", doc.norm_id as string, doc, { old_sha: doc.text_sha256, detail });
    return { outcome: "kept_old" };
  };

  if (res.kind === "rejected") {
    if (isExisting) return keepOld(`${res.reason}: ${res.detail}`);
    await rejectNew(ctx, doc, res.reason, res.detail);
    return { outcome: "rejected" };
  }

  const pdfSha = createHash("sha256").update(res.bytes).digest("hex");
  if (isExisting && doc.pdf_sha256 === pdfSha) {
    await finish(admin, doc, {
      attempts: 0,
      etag: res.etag,
      last_modified: res.lastModified,
      last_checked_at: nowIso,
      next_check_at: nextRecheck(rules, now),
      last_update_status: "unchanged",
    });
    await touchNorm(admin, doc.norm_id as string, nowIso);
    await upgradeNeutralScope(ctx, doc, doc.norm_id as string);
    return { outcome: "unchanged" };
  }

  let text: string;
  try {
    text = cleanText(await (deps.extractText ?? defaultExtractText)(res.bytes));
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (isExisting) return keepOld(`pdf_unreadable: ${detail}`);
    await rejectNew(ctx, doc, "pdf_unreadable", detail, { bytes: res.bytes.length, pdf_sha256: pdfSha });
    return { outcome: "rejected" };
  }

  const file: Downloaded = { bytes: res.bytes.length, pdfSha, etag: res.etag, lastModified: res.lastModified };

  // Der gelesene Text läuft ab hier denselben Weg wie jeder andere: Inhaltstest, Schrumpfschutz, Fassungsvergleich.
  const readText = await readScan(ctx, doc, res.bytes, text, pdfSha, deps);
  const aiRead = readText !== null;
  if (readText !== null) text = cleanText(readText);

  if (isExisting) {
    return { outcome: await updateNorm(ctx, doc, doc.norm_id as string, text, file, null, aiRead) };
  }

  const evidence = scope === "municipal" ? null : neutralScopeEvidence(doc, text, rules);
  const finalScope = evidence ? "municipal" : scope;
  const textSha = normTextHash(text);
  const measured = {
    bytes: file.bytes,
    chars: text.length,
    pdf_sha256: pdfSha,
    text_sha256: textSha,
    scope: finalScope,
    ...(evidence ? { scope_reason: evidence } : {}),
    ...(aiRead ? { text_source: "ai_read" } : {}),
    etag: res.etag,
    last_modified: res.lastModified,
    ...measureDocument(doc.title, text, rules),
  };

  const decision = decideIdentity({ ...identity, doc: { ...self, scope: finalScope }, textSha });
  if (decision.action === "duplicate_manual") {
    await finish(admin, doc, { status: "duplicate_manual", reject_detail: decision.detail, last_checked_at: nowIso, ...measured });
    return { outcome: "duplicate_manual" };
  }
  if (decision.action === "new_version") {
    return { outcome: await updateNorm(ctx, { ...doc, scope: finalScope }, decision.normId, text, file, decision.supersededDocId, aiRead) };
  }

  if (decision.action === "duplicate_content") {
    await rejectNew(ctx, doc, "duplicate_content", decision.detail, measured);
    return { outcome: "rejected" };
  }

  const rejected = decideContent(text, rules, doc.title);
  if (rejected && !(forced && textWithoutPageMarkers(text).length >= rules.force_min_text_chars)) {
    await rejectNew(ctx, doc, rejected.reason, rejected.detail, { ...measured, status: contentStatus(rejected.reason, doc.title, rules, doc.official_number) });
    return { outcome: "rejected" };
  }
  if (evidence && !forced && isCapped({ title: doc.title, scope: "municipal" }, state.all, rules)) {
    await rejectNew(ctx, doc, "cap_reached", `Gemeinde hat bereits ${rules.max_accepted_per_municipality} importierte Gemeinde-Dokumente`, measured);
    return { outcome: "rejected" };
  }
  const tooLong = normTextTooLongMessage(text);
  if (tooLong) {
    await rejectNew(ctx, doc, "too_long", tooLong, measured);
    return { outcome: "rejected" };
  }

  const inserted = await insertNorm(ctx, doc, finalScope, text, textSha, pdfSha, aiRead);
  if (inserted.kind === "manual") {
    await finish(admin, doc, {
      status: "duplicate_manual",
      reject_detail: `Manuell gepflegte Norm ${inserted.id} trägt denselben Titel`,
      last_checked_at: nowIso,
      ...measured,
    });
    return { outcome: "duplicate_manual" };
  }

  await finish(admin, doc, {
    ...measured,
    status: "imported",
    norm_id: inserted.id,
    reject_reason: null,
    reject_detail: null,
    etag: res.etag,
    last_modified: res.lastModified,
    attempts: 0,
    last_checked_at: nowIso,
    next_check_at: nextRecheck(rules, now),
    last_update_status: "imported",
    filter_snapshot: rules,
  });
  await audit(ctx, "norm_auto_import", inserted.id, doc, { new_sha: textSha, new_chars: text.length, scope: finalScope, ai_read: aiRead, forced });
  await relinkUploads(ctx, { ...doc, scope: finalScope }, inserted.id, text);
  return { outcome: "imported", newNormId: inserted.id };
}

// ── Einstieg ─────────────────────────────────────────────────────────────────

/**
 * Bearbeitet das nächste fällige Dokument dieses Projekts. Nur Dokumente aus dem eigenen Auszug;
 * der Client sendet nie eine URL. Sind alle fälligen Dokumente gesperrt: `in_progress`.
 */
export async function syncNextDocument(
  admin: SupabaseClient,
  projectId: string,
  actor: ImportActor,
  deps: ImportDeps = {}
): Promise<DocumentSyncResponse> {
  const state = await syncProjectDocuments(admin, projectId);
  if (!state.available) return { available: false, processed: null, in_progress: false, remaining: 0 };

  const now = Date.now();
  const due = orderDueDocuments(state.own.filter((d) => isDocumentDue(d, now)), state.rules);
  if (due.length === 0) {
    // Der erste Abgleich kann eine Norm freigegeben haben, ohne dass etwas fällig ist.
    if (deps.assignNew) {
      for (const normId of state.changedNormIds ?? []) {
        await deps.assignNew(normId).catch((e) => console.error(`Norm ${normId} nicht zugewiesen:`, e));
      }
    }
    return { available: true, processed: null, in_progress: false, remaining: 0 };
  }

  const ctx: ImportContext = {
    admin,
    state,
    rules: state.rules,
    actor,
    projectId,
    now,
    nowIso: new Date(now).toISOString(),
    reassign: new Set(),
  };

  for (const candidate of due) {
    const doc = await acquireDocumentLock(admin, candidate, new Date(now));
    if (!doc) continue;

    let outcome: Outcome = "failed";
    let newNormId: string | undefined;
    try {
      ({ outcome, newNormId } = await processDocument(ctx, doc, deps));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`Import des ÖREB-Dokuments ${doc.id} fehlgeschlagen:`, e);
      // Ein importiertes Dokument bleibt importiert, sonst hinge seine Norm in der Luft.
      await finish(admin, doc, {
        ...(doc.norm_id ? { last_update_status: "failed", last_update_detail: detail } : { status: "failed", reject_detail: detail }),
        last_checked_at: ctx.nowIso,
        next_check_at: backoffUntil(doc.attempts ?? 1, now),
      }).catch((err) => console.error(`ÖREB-Dokument ${doc.id} nicht entsperrt:`, err));
    }

    // Der Abgleich danach kann einen Verlierer zurücknehmen oder eine Fassung wieder freigeben.
    const after = await syncProjectDocuments(admin, projectId);
    if (deps.assignNew) {
      const toAssign = new Set([
        ...(newNormId ? [newNormId] : []),
        ...Array.from(ctx.reassign),
        ...(state.changedNormIds ?? []),
        ...(after.changedNormIds ?? []),
      ]);
      for (const normId of Array.from(toAssign)) {
        await deps.assignNew(normId).catch((e) => console.error(`Norm ${normId} nicht zugewiesen:`, e));
      }
    }
    return {
      available: true,
      processed: { id: doc.id, title: doc.title, outcome },
      in_progress: false,
      remaining: after.pending,
    };
  }
  return { available: true, processed: null, in_progress: true, remaining: state.pending };
}
