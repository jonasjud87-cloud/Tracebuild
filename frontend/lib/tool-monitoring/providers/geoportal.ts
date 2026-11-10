import { parseGeoportalHealth } from "../parse";
import { fmtDateTime, fmtInt } from "../format";
import { worstState } from "../thresholds";
import type { ProviderDef } from "../types";
import { callRpc, emptyCard, supabaseConfigured } from "./shared";

export const geoportalProvider: ProviderDef = {
  key: "geoportal",
  title: "Geoportal (ÖREB)",
  ttlMs: 5 * 60_000,
  configured: supabaseConfigured,
  async load(_env, deps) {
    const card = emptyCard("geoportal", "Geoportal (ÖREB)");
    const h = parseGeoportalHealth(await callRpc(deps, "monitoring_geoportal_health"));
    if (!h.available) {
      card.state = "warn";
      card.message = "Keine Abrufprotokolle vorhanden (Tabelle oereb_fetch_events fehlt)";
      return card;
    }
    const cantons = h.cantons ?? [];
    const calls = cantons.reduce((a, c) => a + (c.calls ?? 0), 0);
    const ok = cantons.reduce((a, c) => a + (c.ok ?? 0), 0);
    card.metrics.push({ label: "ÖREB-Abrufe (24 h)", value: fmtInt(calls), source: "db" });
    if (calls > 0) {
      card.metrics.push({ label: "Fehlerquote (24 h)", value: `${(((calls - ok) / calls) * 100).toFixed(1)} %`, source: "db" });
    }
    const worst = cantons.filter(c => (c.error_pct ?? 0) > 0).slice(0, 5);
    if (worst.length > 0) {
      card.metrics.push({ label: "Kantone mit Fehlern", value: worst.map(c => `${c.canton ?? "?"} ${c.error_pct ?? 0} %`).join(", "), source: "db" });
    }
    const dead = h.dead ?? [];
    card.metrics.push({
      label: "Ohne Erfolg seit 7 Tagen",
      value: dead.length === 0 ? "keine" : dead.map(d => d.canton ?? "?").join(", "),
      source: "db",
      state: dead.length > 0 ? "warn" : "ok",
      hint: dead.length > 0 ? dead.map(d => `${d.canton ?? "?"}: zuletzt ${fmtDateTime(d.last_attempt)}`).join("; ") : undefined,
    });
    const geodata = h.geodata ?? [];
    if (geodata.length > 0) {
      card.metrics.push({ label: "Geodaten (24 h)", value: geodata.map(g => `${g.status}: ${fmtInt(g.n)}`).join(", "), source: "db" });
    }
    card.state = worstState(...card.metrics.map(m => m.state));
    return card;
  },
};
