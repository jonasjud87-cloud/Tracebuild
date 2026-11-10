import { statusIndicatorState, worstState } from "../thresholds";
import type { Metric, ProviderDef } from "../types";
import { attempt, emptyCard, loadStatusPage, STATUS_PAGES } from "./shared";

/** Öffentliche Statusseiten aller Dienste. Kein Token nötig. */
export const statusProvider: ProviderDef = {
  key: "status",
  title: "Statusseiten",
  ttlMs: 60_000,
  configured: () => true,
  async load(_env, deps) {
    const card = emptyCard("status", "Statusseiten");
    const pages = Object.values(STATUS_PAGES);
    const results = await Promise.all(pages.map(p => attempt(loadStatusPage(p.url, deps))));

    results.forEach((r, i) => {
      const p = pages[i];
      if (!r.ok) {
        card.metrics.push({ label: p.label, value: "Nicht erreichbar", source: "api", state: "warn", hint: r.error ?? undefined });
        return;
      }
      const m: Metric = {
        label: p.label,
        value: r.ok.description ?? r.ok.indicator,
        source: "api",
        state: statusIndicatorState(r.ok.indicator),
      };
      if (r.ok.degraded.length > 0) {
        m.hint = r.ok.degraded.slice(0, 3).map(c => `${c.name}: ${c.status}`).join(", ");
      }
      card.metrics.push(m);
      card.links.push({ label: `Status ${p.label}`, href: p.page });
    });

    card.state = worstState(...card.metrics.map(m => m.state));
    if (results.every(r => !r.ok)) {
      card.state = "error";
      card.message = "Keine Statusseite erreichbar";
    }
    return card;
  },
};
