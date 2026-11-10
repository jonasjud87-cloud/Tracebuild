import { MonitorError } from "../http";
import { fmtDateTime } from "../format";
import { certState, daysUntil, worstState } from "../thresholds";
import type { MonitoringEnv, ProviderDef } from "../types";
import { emptyCard, envValue } from "./shared";

export function siteHost(env: MonitoringEnv): string | null {
  const raw = envValue(env, "NEXT_PUBLIC_SITE_URL");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

export const domainProvider: ProviderDef = {
  key: "domain",
  title: "Domain & Zertifikat",
  ttlMs: 15 * 60_000,
  configured: env => siteHost(env) !== null,
  async load(env, deps) {
    const card = emptyCard("domain", "Domain & Zertifikat");
    const host = siteHost(env);
    if (!host) throw new MonitorError("NEXT_PUBLIC_SITE_URL fehlt oder ist nicht https");
    if (!deps.tls) throw new MonitorError("TLS-Prüfung nicht verfügbar");
    const info = await deps.tls(host, 443, deps.timeoutMs ?? 8000);
    const days = daysUntil(info.validTo, deps.now());
    card.metrics.push({ label: "Host", value: host, source: "api" });
    card.metrics.push({
      label: "Zertifikat gültig bis",
      value: `${fmtDateTime(info.validTo)} (${Number.isFinite(days) ? `${days} Tage` : "–"})`,
      source: "api",
      state: certState(days),
      hint: info.issuer ? `Aussteller: ${info.issuer}` : undefined,
    });
    if (!info.authorized) {
      card.metrics.push({ label: "Vertrauenskette", value: "nicht vertraut", source: "api", state: "error" });
    }
    card.links.push({ label: "Website", href: `https://${host}` });
    card.state = worstState(...card.metrics.map(m => m.state));
    return card;
  },
};
