/**
 * Reine Parser für alle Quellen. Unbekannte Felder werden verworfen, fehlende optionale Felder
 * ergeben null. Passt die Grundform nicht, wirft der Parser MonitorError mit fester Meldung.
 */
import { z } from "zod";
import { MonitorError } from "./http";

const FORMAT_ERROR = "Unerwartetes Antwortformat";

function parseWith<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new MonitorError(FORMAT_ERROR);
  return r.data;
}

/** Zahl aus Zahl oder Zahlentext, sonst null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const num = z.unknown().optional().transform(toNumber);
const optStr = z.string().nullish().transform(v => v ?? null);

// ── Statusseiten (Atlassian Statuspage /api/v2/summary.json) ─────────────────
const StatusSummarySchema = z.object({
  status: z.object({ indicator: z.string(), description: optStr }),
  components: z.array(z.object({ name: z.string(), status: z.string(), group: z.boolean().nullish() })).nullish(),
});

export interface StatusSummary {
  indicator: string;
  description: string | null;
  degraded: { name: string; status: string }[];
}

export function parseStatusSummary(body: unknown): StatusSummary {
  const d = parseWith(StatusSummarySchema, body);
  const degraded = (d.components ?? [])
    .filter(c => c.status !== "operational" && !c.group)
    .map(c => ({ name: c.name, status: c.status }));
  return { indicator: d.status.indicator, description: d.status.description, degraded };
}

// ── Vercel ───────────────────────────────────────────────────────────────────
const VercelDeploymentSchema = z.object({
  uid: z.string(),
  url: optStr,
  created: num,
  readyState: optStr,
  state: optStr,
  errorCode: optStr,
  inspectorUrl: optStr,
  meta: z.object({ githubCommitSha: optStr, githubCommitRef: optStr }).nullish(),
});
const VercelDeploymentsSchema = z.object({ deployments: z.array(VercelDeploymentSchema) });

export interface VercelDeployment {
  id: string;
  state: string;
  sha: string | null;
  ref: string | null;
  createdMs: number | null;
  url: string | null;
  inspectorUrl: string | null;
  errorCode: string | null;
}

export function parseVercelDeployments(body: unknown): VercelDeployment[] {
  const d = parseWith(VercelDeploymentsSchema, body);
  return d.deployments
    .map(x => ({
      id: x.uid,
      state: (x.readyState ?? x.state ?? "UNKNOWN").toUpperCase(),
      sha: x.meta?.githubCommitSha ?? null,
      ref: x.meta?.githubCommitRef ?? null,
      createdMs: x.created,
      url: x.url,
      inspectorUrl: x.inspectorUrl,
      errorCode: x.errorCode,
    }))
    .sort((a, b) => (b.createdMs ?? 0) - (a.createdMs ?? 0));
}

export interface FocusSum {
  totalUsd: number;
  lines: number;
  invalid: number;
}

/** Vercel-Billing (FOCUS, JSON je Zeile). Summe von BilledCost in USD; Gutschriften sind negativ und zählen mit. */
export function sumFocusJsonl(text: string): FocusSum {
  let total = 0;
  let lines = 0;
  let invalid = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      invalid++;
      continue;
    }
    const cost = typeof row === "object" && row !== null ? toNumber((row as Record<string, unknown>).BilledCost) : null;
    if (cost === null) {
      invalid++;
      continue;
    }
    total += cost;
    lines++;
  }
  return { totalUsd: Math.round(total * 10000) / 10000, lines, invalid };
}

// ── Supabase ─────────────────────────────────────────────────────────────────
/** Projekt-Ref aus https://<ref>.supabase.co, sonst null (eigene Domain, lokale Instanz). */
export function supabaseRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const m = /^([a-z0-9]{10,40})\.supabase\.co$/.exec(host);
  return m ? m[1] : null;
}

const HealthSchema = z.array(z.object({ name: z.string(), healthy: z.boolean().nullish(), status: optStr }));

export interface ServiceHealth {
  name: string;
  healthy: boolean;
  status: string | null;
}

export function parseSupabaseHealth(body: unknown): ServiceHealth[] {
  return parseWith(HealthSchema, body).map(h => ({ name: h.name, healthy: h.healthy === true, status: h.status }));
}

const DiskSchema = z.object({
  metrics: z.object({ fs_size_bytes: num, fs_avail_bytes: num, fs_used_bytes: num }),
});

export function parseDiskUtil(body: unknown): { usedBytes: number; sizeBytes: number } | null {
  const r = DiskSchema.safeParse(body);
  if (!r.success) return null;
  const { fs_size_bytes: size, fs_used_bytes: used } = r.data.metrics;
  if (size === null || used === null || size <= 0) return null;
  return { usedBytes: used, sizeBytes: size };
}

const ApiCountsSchema = z.object({ result: z.array(z.record(z.string(), z.unknown())).nullish() });

/** Summe aller total_*_requests-Felder über das Zeitfenster. */
export function parseApiCounts(body: unknown): number | null {
  const r = ApiCountsSchema.safeParse(body);
  if (!r.success || !r.data.result) return null;
  let total = 0;
  for (const row of r.data.result) {
    for (const [k, v] of Object.entries(row)) {
      if (/^total_.*_requests$/.test(k)) total += toNumber(v) ?? 0;
    }
  }
  return total;
}

const DbStatsSchema = z.object({
  db_bytes: num,
  tables: z.array(z.object({ name: z.string(), bytes: num, rows: num })).nullish(),
  storage: z.array(z.object({ bucket: z.string(), bytes: num, objects: num })).nullish(),
  auth_users: num,
  auth_active_30d: num,
  cron: z
    .array(
      z.object({
        jobname: optStr,
        active: z.boolean().nullish(),
        last_status: optStr,
        last_start: optStr,
        last_message: optStr,
        failed_24h: num,
      })
    )
    .nullish(),
  net: z.array(z.object({ status_code: num, n: num, timed_out: num })).nullish(),
});

export type DbStats = z.infer<typeof DbStatsSchema>;

export function parseDbStats(body: unknown): DbStats {
  return parseWith(DbStatsSchema, body);
}

// ── Eigene Modellkosten ──────────────────────────────────────────────────────
const AiCostRowsSchema = z.array(z.object({ source: z.string(), day: z.string(), cost_usd: num, calls: num }));

export interface AiCostRow {
  source: string;
  day: string;
  costUsd: number;
  calls: number;
}

export function parseAiCosts(body: unknown): AiCostRow[] {
  return parseWith(AiCostRowsSchema, body ?? []).map(r => ({
    source: r.source,
    day: r.day.slice(0, 10),
    costUsd: r.cost_usd ?? 0,
    calls: r.calls ?? 0,
  }));
}

// ── Geoportal ────────────────────────────────────────────────────────────────
const GeoHealthSchema = z.object({
  available: z.boolean(),
  cantons: z
    .array(z.object({ canton: optStr, calls: num, ok: num, error_pct: num, last_ok: optStr }))
    .nullish(),
  dead: z.array(z.object({ canton: optStr, calls: num, last_attempt: optStr, last_error: optStr })).nullish(),
  geodata: z.array(z.object({ status: z.string(), n: num })).nullish(),
});

export type GeoHealth = z.infer<typeof GeoHealthSchema>;

export function parseGeoportalHealth(body: unknown): GeoHealth {
  return parseWith(GeoHealthSchema, body);
}

// ── GitHub ───────────────────────────────────────────────────────────────────
const RunsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      name: optStr,
      status: optStr,
      conclusion: optStr,
      html_url: optStr,
      created_at: optStr,
      head_sha: optStr,
    })
  ),
});

export interface WorkflowRun {
  name: string;
  status: string | null;
  conclusion: string | null;
  url: string | null;
  createdAt: string | null;
}

/** Je Workflow nur der neueste Lauf (Antwort ist neueste zuerst). */
export function parseLatestRuns(body: unknown): WorkflowRun[] {
  const seen = new Set<string>();
  const out: WorkflowRun[] = [];
  for (const r of parseWith(RunsSchema, body).workflow_runs) {
    const name = r.name ?? "Workflow";
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, status: r.status, conclusion: r.conclusion, url: r.html_url, createdAt: r.created_at });
  }
  return out;
}

export function parseArrayLength(body: unknown): number {
  if (!Array.isArray(body)) throw new MonitorError(FORMAT_ERROR);
  return body.length;
}

const AlertsSchema = z.array(
  z.object({
    security_advisory: z.object({ severity: optStr }).nullish(),
    security_vulnerability: z.object({ severity: optStr }).nullish(),
  })
);

export function parseDependabot(body: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of parseWith(AlertsSchema, body)) {
    const sev = (a.security_vulnerability?.severity ?? a.security_advisory?.severity ?? "unknown").toLowerCase();
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  return counts;
}

const CommitSchema = z.object({
  sha: z.string(),
  html_url: optStr,
  commit: z.object({ author: z.object({ date: optStr }).nullish() }).nullish(),
});

export function parseCommit(body: unknown): { sha: string; url: string | null; date: string | null } {
  const c = parseWith(CommitSchema, body);
  return { sha: c.sha, url: c.html_url, date: c.commit?.author?.date ?? null };
}

// ── Resend ───────────────────────────────────────────────────────────────────
const UsageWindow = z.object({ used: num, limit: num, resets_at: optStr }).nullish();
const ResendUsageSchema = z.object({
  emails: z.object({ daily: UsageWindow, monthly: UsageWindow }).nullish(),
  domains: z.object({ used: num, limit: num }).nullish(),
});

export interface UsageValue {
  used: number | null;
  /** null = kein Limit (Bezahlplan). undefined = nicht geliefert. */
  limit: number | null | undefined;
  resetsAt: string | null;
}

export interface ResendUsage {
  daily: UsageValue | null;
  monthly: UsageValue | null;
  domains: UsageValue | null;
}

function usageValue(w: { used: number | null; limit: number | null; resets_at?: string | null } | null | undefined, raw: unknown): UsageValue | null {
  if (!w) return null;
  const hasLimit = typeof raw === "object" && raw !== null && "limit" in raw;
  return { used: w.used, limit: hasLimit ? w.limit : undefined, resetsAt: w.resets_at ?? null };
}

export function parseResendUsage(body: unknown): ResendUsage {
  const d = parseWith(ResendUsageSchema, body);
  const raw = body as { emails?: { daily?: unknown; monthly?: unknown }; domains?: unknown };
  return {
    daily: usageValue(d.emails?.daily, raw.emails?.daily),
    monthly: usageValue(d.emails?.monthly, raw.emails?.monthly),
    domains: usageValue(d.domains, raw.domains),
  };
}

const ResendDomainsSchema = z.object({ data: z.array(z.object({ name: z.string(), status: optStr })) });

export function parseResendDomains(body: unknown): { name: string; status: string }[] {
  return parseWith(ResendDomainsSchema, body).data.map(d => ({ name: d.name.toLowerCase(), status: d.status ?? "unknown" }));
}
