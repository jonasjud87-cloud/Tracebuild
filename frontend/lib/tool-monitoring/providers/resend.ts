import { fetchJson } from "../http";
import { parseResendDomains, parseResendUsage, type UsageValue } from "../parse";
import { fmtQuota } from "../format";
import { PLANS } from "../plans";
import { quotaState, worstState } from "../thresholds";
import type { Metric, ProviderDef } from "../types";
import { allFailed, attempt, emptyCard, envValue, firstError, has } from "./shared";

const API = "https://api.resend.com";
export const SENDER_DOMAIN = "tracebuild.ch";
export const SENDER_ADDRESS = "info@tracebuild.ch";

/** Kontingent-Zeile. Fehlt das Limit in der API, gilt der Planwert (gekennzeichnet). */
export function usageMetric(label: string, u: UsageValue | null, fallbackLimit: number): Metric {
  const fromApi = u !== null && u.limit !== undefined;
  const limit = fromApi ? (u.limit as number | null) : fallbackLimit;
  const used = u?.used ?? null;
  return {
    label,
    value: fmtQuota(used, limit),
    source: fromApi ? "api" : "plan",
    state: used === null ? "ok" : quotaState(used, limit),
    quota: used === null ? undefined : { used, limit },
    hint: fromApi ? undefined : "Limit aus Plan",
  };
}

export const resendProvider: ProviderDef = {
  key: "resend",
  title: "Resend (E-Mail)",
  ttlMs: 15 * 60_000,
  configured: env => has(env, "MONITORING_RESEND_API_KEY"),
  async load(env, deps) {
    const card = emptyCard("resend", "Resend (E-Mail)");
    const opts = { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs, headers: { Authorization: `Bearer ${envValue(env, "MONITORING_RESEND_API_KEY") ?? ""}` } };
    const [usage, domains] = await Promise.all([attempt(fetchJson(`${API}/usage`, opts)), attempt(fetchJson(`${API}/domains`, opts))]);
    if (allFailed(usage, domains)) throw firstError(usage, domains);

    const plan = PLANS.resend;
    const u = usage.ok ? parseResendUsage(usage.ok.body) : null;
    if (!usage.ok) card.notes.push(`Nutzung nicht abrufbar: ${usage.error}`);
    card.metrics.push(usageMetric("E-Mails heute", u?.daily ?? null, plan.dailyLimit));
    card.metrics.push(usageMetric("E-Mails im Monat", u?.monthly ?? null, plan.monthlyLimit));

    if (domains.ok) {
      const list = parseResendDomains(domains.ok.body);
      const own = list.find(d => d.name === SENDER_DOMAIN);
      card.metrics.push({
        label: `Domain ${SENDER_DOMAIN}`,
        value: own ? own.status : "nicht eingetragen",
        source: "api",
        state: own?.status === "verified" ? "ok" : "warn",
        hint: own?.status === "verified" ? undefined : `Für Absender ${SENDER_ADDRESS} muss die Domain verifiziert sein`,
      });
    } else card.notes.push(`Domains nicht abrufbar: ${domains.error}`);

    card.notes.push(`Versand per SMTP über Supabase Auth. Gewünschter Absender: ${SENDER_ADDRESS}`);
    card.costs.push({ label: `Plan ${plan.name}`, usd: plan.baseUsd, source: "plan" });
    card.links.push({ label: "Dashboard", href: "https://resend.com/emails" }, { label: "Abrechnung", href: plan.billingUrl });
    card.state = worstState(...card.metrics.map(m => m.state), usage.ok && domains.ok ? "ok" : "warn");
    return card;
  },
};
