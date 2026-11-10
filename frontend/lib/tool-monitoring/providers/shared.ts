import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { MonitorError, fetchJson, safeMessage } from "../http";
import { parseStatusSummary, type StatusSummary } from "../parse";
import type { CardState, MonitoringEnv, ProviderDeps, ProviderKey, ProviderOutput } from "../types";

export const MIGRATION_FILE = "20261111000002_tool_monitoring.sql";
export const MISSING_MIGRATION = `Migration fehlt (${MIGRATION_FILE})`;

export function emptyCard(provider: ProviderKey, title: string): ProviderOutput {
  return { provider, title, state: "ok", metrics: [], costs: [], links: [], notes: [] };
}

export function has(env: MonitoringEnv, ...keys: string[]): boolean {
  return keys.every(k => typeof env[k] === "string" && env[k]!.trim() !== "");
}

export function envValue(env: MonitoringEnv, key: string): string | undefined {
  const v = env[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

export function supabaseConfigured(env: MonitoringEnv): boolean {
  return has(env, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_KEY");
}

/** RPC aufrufen. Fehlende Funktion → MonitorError «Migration fehlt», sonst feste Meldung ohne DB-Text. */
export async function callRpc(deps: ProviderDeps, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  if (!deps.rpc) throw new MonitorError("Supabase nicht konfiguriert");
  let res: Awaited<ReturnType<NonNullable<ProviderDeps["rpc"]>>>;
  try {
    res = await deps.rpc(fn, args);
  } catch {
    throw new MonitorError("Datenbank nicht erreichbar");
  }
  if (res.error) {
    if (isMissingSchema(res.error.message)) throw new MonitorError(MISSING_MIGRATION);
    throw new MonitorError("Datenbankabfrage fehlgeschlagen");
  }
  return res.data;
}

export const STATUS_PAGES = {
  vercel: { label: "Vercel", url: "https://www.vercel-status.com/api/v2/summary.json", page: "https://www.vercel-status.com" },
  supabase: { label: "Supabase", url: "https://status.supabase.com/api/v2/summary.json", page: "https://status.supabase.com" },
  github: { label: "GitHub", url: "https://www.githubstatus.com/api/v2/summary.json", page: "https://www.githubstatus.com" },
  claude: { label: "Claude", url: "https://status.claude.com/api/v2/summary.json", page: "https://status.claude.com" },
  resend: { label: "Resend", url: "https://resend-status.com/api/v2/summary.json", page: "https://resend-status.com" },
} as const;

export async function loadStatusPage(url: string, deps: ProviderDeps): Promise<StatusSummary> {
  const r = await fetchJson(url, { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs });
  return parseStatusSummary(r.body);
}

/** Teilabrufe: Fehler einzelner Teile werden Hinweise, schlagen alle fehl, wirft die Funktion den ersten Fehler. */
export interface Part<T> {
  ok: T | null;
  error: string | null;
  status: number | null;
}

export async function attempt<T>(p: Promise<T>): Promise<Part<T>> {
  try {
    return { ok: await p, error: null, status: null };
  } catch (e) {
    return { ok: null, error: safeMessage(e), status: e instanceof MonitorError ? e.status : null };
  }
}

export function allFailed(...parts: Part<unknown>[]): boolean {
  return parts.length > 0 && parts.every(p => p.ok === null);
}

export function firstError(...parts: Part<unknown>[]): MonitorError {
  const p = parts.find(x => x.error);
  return new MonitorError(p?.error ?? "Unerwarteter Fehler beim Abruf", p?.status ?? null);
}

export function statesOf(card: ProviderOutput): CardState[] {
  return card.metrics.map(m => m.state ?? "ok");
}

