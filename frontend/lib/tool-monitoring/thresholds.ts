import type { CardState } from "./types";

export const QUOTA_WARN = 0.8;
export const QUOTA_ERROR = 0.95;
export const CERT_WARN_DAYS = 21;
export const CERT_ERROR_DAYS = 7;

const RANK: Record<CardState, number> = { unconfigured: 0, ok: 1, warn: 2, error: 3 };

/** Schlechtester Zustand; ohne Eingabe ok. */
export function worstState(...states: (CardState | undefined)[]): CardState {
  let worst: CardState = "ok";
  for (const s of states) if (s && s !== "unconfigured" && RANK[s] > RANK[worst]) worst = s;
  return worst;
}

/** Kontingent: warn ab 80 %, error ab 95 %. Ohne Limit (null) oder Limit ≤ 0: ok. */
export function quotaState(used: number, limit: number | null): CardState {
  if (limit === null || !Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return "ok";
  const ratio = used / limit;
  if (ratio >= QUOTA_ERROR) return "error";
  if (ratio >= QUOTA_WARN) return "warn";
  return "ok";
}

/** Statuspage-Indicator: none → ok, major/critical → error, alles andere (minor, maintenance, unbekannt) → warn. */
export function statusIndicatorState(indicator: string | null | undefined): CardState {
  if (indicator === "none") return "ok";
  if (indicator === "major" || indicator === "critical") return "error";
  return "warn";
}

/** Zertifikat: error unter 7 Tagen (auch abgelaufen), warn unter 21 Tagen. */
export function certState(daysLeft: number): CardState {
  if (!Number.isFinite(daysLeft) || daysLeft < CERT_ERROR_DAYS) return "error";
  if (daysLeft < CERT_WARN_DAYS) return "warn";
  return "ok";
}

export function daysUntil(iso: string, now: Date): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.NaN;
  return Math.floor((t - now.getTime()) / 86_400_000);
}

export interface DeploymentLite {
  state: string;
  sha: string | null;
}

export interface DeploymentVerdict {
  state: CardState;
  message: string;
}

const RUNNING = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);

/**
 * Produktions-Deployments (neueste zuerst). Letzter Versuch fehlgeschlagen → error.
 * Aktive Produktion auf anderem Commit als main → warn, ausser main wird gerade gebaut.
 */
export function deploymentState(deployments: DeploymentLite[], mainSha: string | null): DeploymentVerdict {
  if (deployments.length === 0) return { state: "warn", message: "Kein Produktions-Deployment gefunden" };
  const latest = deployments[0];
  if (latest.state === "ERROR") return { state: "error", message: "Letztes Produktions-Deployment fehlgeschlagen" };
  const live = deployments.find(d => d.state === "READY");
  if (!live) return { state: "warn", message: "Kein fertiges Produktions-Deployment" };
  if (mainSha && live.sha && live.sha !== mainSha) {
    const building = deployments.some(d => d.sha === mainSha && RUNNING.has(d.state));
    if (building) return { state: "ok", message: "Neuer Stand von main wird gerade ausgeliefert" };
    return { state: "warn", message: "Produktion ist hinter main" };
  }
  if (RUNNING.has(latest.state)) return { state: "ok", message: "Deployment läuft" };
  return { state: "ok", message: "Produktion aktuell" };
}
