import { z } from "zod";

/** Dienste der Seite «Tools & Dienste». Reihenfolge = Reihenfolge der Karten. */
export const PROVIDER_KEYS = ["status", "vercel", "supabase", "github", "resend", "anthropic", "domain", "geoportal"] as const;
export const ProviderKeySchema = z.enum(PROVIDER_KEYS);
export type ProviderKey = z.infer<typeof ProviderKeySchema>;

export type CardState = "ok" | "warn" | "error" | "unconfigured";

/** Herkunft eines Werts: aus der API des Dienstes, aus dem hinterlegten Plan oder aus der eigenen DB. */
export type DataSource = "api" | "plan" | "db";

export interface Quota {
  used: number;
  /** null = kein Limit (z. B. Bezahlplan). */
  limit: number | null;
}

export interface Metric {
  label: string;
  /** Bereits formatiert (de-CH). */
  value: string;
  source: DataSource;
  state?: CardState;
  quota?: Quota;
  hint?: string;
}

export interface CostLine {
  label: string;
  usd: number;
  source: DataSource;
  note?: string;
}

export interface LinkItem {
  label: string;
  href: string;
}

export interface CardResult {
  provider: ProviderKey;
  title: string;
  state: CardState;
  message?: string;
  metrics: Metric[];
  costs: CostLine[];
  links: LinkItem[];
  notes: string[];
  checkedAt: string;
  cached: boolean;
  usdToChf: number;
}

export interface ProviderInfo {
  key: ProviderKey;
  title: string;
  configured: boolean;
}

export type MonitoringEnv = Readonly<Record<string, string | undefined>>;

export interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

export type RpcFn = (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;

export interface TlsInfo {
  validTo: string;
  authorized: boolean;
  issuer?: string;
}

export type TlsProbe = (host: string, port: number, timeoutMs: number) => Promise<TlsInfo>;

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderDeps {
  fetchImpl: FetchImpl;
  now: () => Date;
  /** Fehlt, wenn die Supabase-Konfiguration fehlt. */
  rpc?: RpcFn;
  tls?: TlsProbe;
  timeoutMs?: number;
}

/** Ergebnis eines Providers vor Zeitstempel, Cache-Flag und Kurs. */
export type ProviderOutput = Omit<CardResult, "checkedAt" | "cached" | "usdToChf">;

export interface ProviderDef {
  key: ProviderKey;
  title: string;
  /** Lebensdauer im Cache. */
  ttlMs: number;
  configured: (env: MonitoringEnv) => boolean;
  load: (env: MonitoringEnv, deps: ProviderDeps) => Promise<ProviderOutput>;
}
