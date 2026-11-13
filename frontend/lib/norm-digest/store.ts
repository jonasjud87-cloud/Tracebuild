import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { normTextHash } from "@/lib/norm-hash";
import {
  DIGEST_VERSION,
  articleRefs,
  digestEligible,
  digestNote,
  digestsEnabled,
  verifyDigest,
  type DigestCandidate,
  type StoredDigest,
} from "./rules";
import { DigestError, generateDigest, type CompleteFn } from "./generate";

const RETRY_FAILED_AFTER_MS = 6 * 86_400_000;

export interface DigestNorm extends DigestCandidate {
  id: string;
  title: string;
  text: string;
}

export type DigestOutcome =
  | { status: "created"; digestChars: number; sourceChars: number; costUsd: number }
  | { status: "exists" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; costUsd: number };

interface ExistingRow {
  status: string;
  created_at: string;
}

export async function ensureDigest(
  admin: SupabaseClient,
  norm: DigestNorm,
  options: { force?: boolean; complete?: CompleteFn; deadlineAt?: number; now?: () => number } = {},
): Promise<DigestOutcome> {
  if (!digestEligible(norm)) return { status: "skipped", reason: "Norm kommt für einen Prüfauszug nicht in Frage." };
  const sha = normTextHash(norm.text);
  const now = options.now ?? Date.now;

  const { data, error: readError } = await admin
    .from("norm_digests")
    .select("status, created_at")
    .eq("norm_id", norm.id)
    .eq("text_sha256", sha)
    .eq("extractor_version", DIGEST_VERSION)
    .maybeSingle();
  if (readError) {
    if (isMissingSchema(readError.message)) return { status: "skipped", reason: "Tabelle norm_digests fehlt (Migration 20261113000004)." };
    throw new Error(readError.message);
  }
  const existing = data as ExistingRow | null;
  if (existing && !options.force) {
    const age = now() - Date.parse(existing.created_at);
    if (existing.status === "ok" || !(age > RETRY_FAILED_AFTER_MS)) return { status: "exists" };
  }

  const base = {
    norm_id: norm.id,
    text_sha256: sha,
    extractor_version: DIGEST_VERSION,
    source_chars: norm.text.length,
    created_at: new Date(now()).toISOString(),
  };
  const saveFailure = async (reason: string, costUsd: number, digestText: string | null, model: string | null): Promise<DigestOutcome> => {
    if (existing?.status === "ok") return { status: "failed", reason: `${reason} Der bisherige Auszug bleibt aktiv.`, costUsd };
    const { error } = await admin.from("norm_digests").upsert(
      { ...base, status: "failed", digest: digestText, digest_chars: null, model, cost_usd: costUsd, note: reason.slice(0, 2000) },
      { onConflict: "norm_id,text_sha256,extractor_version" },
    );
    if (error) throw new Error(error.message);
    return { status: "failed", reason, costUsd };
  };

  let generated;
  try {
    generated = await generateDigest({ title: norm.title, text: norm.text }, options.complete, { deadlineAt: options.deadlineAt });
  } catch (e) {
    return saveFailure(e instanceof Error ? e.message : "Erstellung fehlgeschlagen", e instanceof DigestError ? e.costUsd : 0, null, null);
  }

  const check = verifyDigest(norm.text, generated.digest);
  if (!check.ok) {
    return saveFailure(digestNote(check, articleRefs(norm.text).size), generated.costUsd, generated.digest, generated.model);
  }

  const omitted = check.omitted.length ? ` Ausgelassen: ${check.omitted.slice(0, 80).join(", ")}${check.omitted.length > 80 ? " …" : ""}` : "";
  const row = {
    ...base,
    status: "ok",
    digest: generated.digest,
    digest_chars: generated.digest.length,
    model: generated.model,
    cost_usd: generated.costUsd,
    note: `${digestNote(check, articleRefs(norm.text).size)}.${omitted}`.slice(0, 2000),
  };
  const { error } = await admin.from("norm_digests").upsert(row, { onConflict: "norm_id,text_sha256,extractor_version" });
  if (error) throw new Error(error.message);

  return { status: "created", digestChars: generated.digest.length, sourceChars: norm.text.length, costUsd: generated.costUsd };
}

export async function loadActiveDigests(admin: SupabaseClient, normIds: string[]): Promise<Map<string, StoredDigest>> {
  const out = new Map<string, StoredDigest>();
  const ids = normIds.filter(Boolean);
  if (!ids.length || !digestsEnabled()) return out;
  const { data, error } = await admin
    .from("norm_digests")
    .select("norm_id, text_sha256, digest, created_at")
    .in("norm_id", ids)
    .eq("status", "ok")
    .eq("extractor_version", DIGEST_VERSION)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingSchema(error.message)) console.error("norm_digests:", error.message);
    return out;
  }
  (data ?? []).forEach((r) => {
    const row = r as { norm_id: string; text_sha256: string; digest: string | null };
    if (row.digest) out.set(row.norm_id, { sha: row.text_sha256, digest: row.digest });
  });
  return out;
}

export interface DigestStatusRow {
  normId: string;
  title: string;
  sourceChars: number;
  state: "ok" | "failed" | "missing" | "outdated";
  digestChars: number | null;
  note: string | null;
  costUsd: number | null;
  createdAt: string | null;
}

const COLUMN_SETS = [
  "id, title, text, layer, org_id, jurisdiction_type, country, auto_scope, archived_at, approval_status",
  "id, title, text, layer, org_id, jurisdiction_type, country, auto_scope",
  "id, title, text, layer, org_id, jurisdiction_type",
];

async function loadEligible(admin: SupabaseClient): Promise<DigestNorm[]> {
  let last = "";
  for (const columns of COLUMN_SETS) {
    const { data, error } = await admin.from("norms").select(columns).is("org_id", null).eq("jurisdiction_type", "national");
    if (!error) return ((data ?? []) as unknown as DigestNorm[]).filter((n) => digestEligible(n));
    last = error.message;
    if (!isMissingSchema(error.message)) break;
  }
  throw new Error(last);
}

interface DigestRow {
  norm_id: string;
  text_sha256: string;
  extractor_version: number;
  status: string;
  digest_chars: number | null;
  note: string | null;
  cost_usd: number | null;
  created_at: string;
}

async function loadRows(admin: SupabaseClient, ids: string[]): Promise<{ available: boolean; rows: DigestRow[] }> {
  if (!ids.length) return { available: true, rows: [] };
  const { data, error } = await admin
    .from("norm_digests")
    .select("norm_id, text_sha256, extractor_version, status, digest_chars, note, cost_usd, created_at")
    .in("norm_id", ids)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchema(error.message)) return { available: false, rows: [] };
    throw new Error(error.message);
  }
  return { available: true, rows: (data ?? []) as DigestRow[] };
}

export async function digestOverview(admin: SupabaseClient): Promise<{ available: boolean; rows: DigestStatusRow[] }> {
  const eligible = await loadEligible(admin);
  const loaded = await loadRows(admin, eligible.map((n) => n.id));
  if (!loaded.available) return { available: false, rows: [] };

  const rows = eligible.map<DigestStatusRow>((n) => {
    const sha = normTextHash(n.text);
    const own = loaded.rows.filter((d) => d.norm_id === n.id);
    const current = own.find((d) => d.text_sha256 === sha && d.extractor_version === DIGEST_VERSION);
    const base = { normId: n.id, title: n.title, sourceChars: n.text.length };
    if (current) {
      return {
        ...base,
        state: current.status === "ok" ? "ok" : "failed",
        digestChars: current.digest_chars,
        note: current.note,
        costUsd: current.cost_usd,
        createdAt: current.created_at,
      };
    }
    return { ...base, state: own.length ? "outdated" : "missing", digestChars: null, note: null, costUsd: null, createdAt: own[0]?.created_at ?? null };
  });
  rows.sort((a, b) => b.sourceChars - a.sourceChars);
  return { available: true, rows };
}

export async function ensureAllDigests(
  admin: SupabaseClient,
  options: { deadlineAt: number; force?: boolean; onlyIds?: string[]; complete?: CompleteFn },
): Promise<{ created: number; failed: number; skipped: number; costUsd: number }> {
  const eligible = (await loadEligible(admin)).filter((n) => !options.onlyIds || options.onlyIds.includes(n.id));
  const loaded = await loadRows(admin, eligible.map((n) => n.id));
  const hasRow = (n: DigestNorm) => loaded.rows.some((d) => d.norm_id === n.id && d.text_sha256 === normTextHash(n.text) && d.extractor_version === DIGEST_VERSION);
  const todo = [...eligible].sort((a, b) => Number(hasRow(a)) - Number(hasRow(b)));

  const summary = { created: 0, failed: 0, skipped: 0, costUsd: 0 };
  for (const norm of todo) {
    if (Date.now() > options.deadlineAt) {
      summary.skipped += 1;
      continue;
    }
    const outcome = await ensureDigest(admin, norm, { force: options.force, complete: options.complete, deadlineAt: options.deadlineAt });
    if (outcome.status === "created") {
      summary.created += 1;
      summary.costUsd += outcome.costUsd;
    } else if (outcome.status === "failed") {
      summary.failed += 1;
      summary.costUsd += outcome.costUsd;
    } else {
      summary.skipped += 1;
    }
  }
  return summary;
}
