/**
 * Spike vor dem Einspielen der Migration: Trägt waitUntil unter Next 14.2.30 bis 280 s, und was antwortet
 * ein Sprung über www? Rein. Ohne Datenbank, ohne pg_net, ohne Modellkosten. Anleitung:
 * supabase/ops/analysis-stages-activate.sql, Ablauf: scripts/analysis-spike.mjs.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const SPIKE_ROUTE = "/api/v1/internal/analysis-spike";
export const SPIKE_DEFAULT_WORK_MS = 280_000;
export const SPIKE_MAX_WORK_MS = 285_000;
export const SPIKE_MAX_HOPS = 10;

type Env = Record<string, string | undefined>;

/** Standardmässig aus: Ohne Secret gibt es die Route nicht. Vergleich ohne Zeitsignal, auch bei falscher Länge. */
export function spikeAuthorized(provided: string | null, env: Env = process.env): boolean {
  const secret = env.ANALYSIS_SPIKE_SECRET ?? "";
  if (!secret || !provided) return false;
  const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(digest(secret), digest(provided));
}

export function parseSpikeRequest(body: unknown): { workMs: number; hops: number } {
  const b = (body ?? {}) as { work_ms?: unknown; hops?: unknown };
  const clamp = (v: unknown, max: number, fallback: number) => {
    const n = Number(v);
    return v === undefined || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(0, Math.floor(n)));
  };
  return { workMs: clamp(b.work_ms, SPIKE_MAX_WORK_MS, SPIKE_DEFAULT_WORK_MS), hops: clamp(b.hops, SPIKE_MAX_HOPS, 0) };
}

/** Sprünge gehen fest über www, wie der Anstoss aus der Datenbank. Nie aus dem Host-Header: Das Secret reist mit. */
export function spikeHopUrl(env: Env = process.env): string {
  const origin = (env.ANALYSIS_DISPATCH_ORIGIN ?? "https://www.tracebuild.ch").replace(/\/+$/, "");
  return `${origin}${SPIKE_ROUTE}`;
}
