"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { inputCls } from "./admin-norm-types";

const OEREB_FEDERAL_THEMES: { code: string; label: string }[] = [
  { code: "ch.Nutzungsplanung", label: "Nutzungsplanung" },
  { code: "ch.ProjektierungszonenNationalstrassen", label: "Projektierungszonen Nationalstrassen" },
  { code: "ch.BaulinienNationalstrassen", label: "Baulinien Nationalstrassen" },
  { code: "ch.ProjektierungszonenEisenbahnanlagen", label: "Projektierungszonen Eisenbahnanlagen" },
  { code: "ch.BaulinienEisenbahnanlagen", label: "Baulinien Eisenbahnanlagen" },
  { code: "ch.ProjektierungszonenFlughafenanlagen", label: "Projektierungszonen Flughafenanlagen" },
  { code: "ch.BaulinienFlughafenanlagen", label: "Baulinien Flughafenanlagen" },
  { code: "ch.Sicherheitszonenplan", label: "Sicherheitszonenplan" },
  { code: "ch.BelasteteStandorte", label: "Belastete Standorte" },
  { code: "ch.BelasteteStandorteMilitaer", label: "Belastete Standorte Militär" },
  { code: "ch.BelasteteStandorteZivileFlugplaetze", label: "Belastete Standorte zivile Flugplätze" },
  { code: "ch.BelasteteStandorteOeffentlicherVerkehr", label: "Belastete Standorte öffentlicher Verkehr" },
  { code: "ch.Grundwasserschutzzonen", label: "Grundwasserschutzzonen" },
  { code: "ch.Grundwasserschutzareale", label: "Grundwasserschutzareale" },
  { code: "ch.Laermempfindlichkeitsstufen", label: "Lärmempfindlichkeitsstufen" },
  { code: "ch.StatischeWaldgrenzen", label: "Statische Waldgrenzen" },
  { code: "ch.Waldabstandslinien", label: "Waldabstandslinien" },
  { code: "ch.Waldreservate", label: "Waldreservate" },
];

interface OerebMapping {
  id: string;
  theme_code: string;
  category_pattern: string;
  org_id: string | null;
  active: boolean;
}

export default function OerebMappingSection() {
  const [mappings, setMappings] = useState<OerebMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [themeCode, setThemeCode] = useState(OEREB_FEDERAL_THEMES[0].code);
  const [pattern, setPattern] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<OerebMapping[]>("/admin/oereb-mappings");
      setMappings(data ?? []);
      setLoadError(null);
    } catch (e: unknown) {
      setMappings([]);
      setLoadError(e instanceof Error ? e.message : "Zuordnungen konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const p = pattern.trim().toLowerCase();
    if (!p) {
      setFormError("Bitte ein Kategorie-Muster eingeben.");
      return;
    }
    setFormError(null);
    setAdding(true);
    try {
      const created = await api.post<OerebMapping>("/admin/oereb-mappings", { theme_code: themeCode, category_pattern: p });
      setMappings((prev) =>
        [...prev, created].sort((a, b) => a.theme_code.localeCompare(b.theme_code) || a.category_pattern.localeCompare(b.category_pattern)),
      );
      setPattern("");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(m: OerebMapping) {
    setBusyId(m.id);
    try {
      const updated = await api.patch<OerebMapping>("/admin/oereb-mappings", { id: m.id, active: !m.active });
      setMappings((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...updated } : x)));
    } catch {
      setBusyId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(m: OerebMapping) {
    if (!confirm(`Zuordnung ${m.theme_code} → «${m.category_pattern}» löschen?`)) return;
    setBusyId(m.id);
    try {
      await api.delete("/admin/oereb-mappings", { id: m.id });
      setMappings((prev) => prev.filter((x) => x.id !== m.id));
    } catch {
      setBusyId(null);
    } finally {
      setBusyId(null);
    }
  }

  const themeLabel = (code: string) => OEREB_FEDERAL_THEMES.find((t) => t.code === code)?.label ?? code;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-[#5f5f64]">
          Verknüpft Bundes-Pflichtthemen des ÖREB-Katasters mit Normen: Betrifft ein Thema die Parzelle, werden alle Normen zugewiesen, deren Kategorie das
          Muster enthält (Teilstring, Gross-/Kleinschreibung egal).
        </p>
        <Link
          href="/admin/oereb-imports"
          className="rounded-xl border border-[#8c8b8e] bg-white px-3 py-1.5 text-sm font-semibold text-[#151414] hover:border-[#151414]"
        >
          ÖREB-Importe verwalten
        </Link>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 lg:w-72">
          <h3 className="mb-3 text-sm font-semibold text-[#151414]">Zeile hinzufügen</h3>
          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[#5f5f64]">ÖREB-Thema</label>
              <select value={themeCode} onChange={(e) => setThemeCode(e.target.value)} className={`${inputCls} appearance-none`}>
                {OEREB_FEDERAL_THEMES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 font-mono text-[13px] text-[#46464a]">{themeCode}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#5f5f64]">
                Kategorie-Muster <span className="text-[#a3201a]">*</span>
              </label>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="z. B. gewässer, lärm, wald"
                className={inputCls}
              />
            </div>
            {formError && (
              <p className="rounded-lg border border-[#D87979]/20 bg-[#fde7e5] px-3 py-2 text-sm text-[#a3201a]">{formError}</p>
            )}
            <button
              type="submit"
              disabled={adding || !pattern.trim()}
              className="w-full rounded-lg bg-[#151414] py-2 text-sm font-medium text-white transition-colors hover:bg-[#2e2e30] disabled:opacity-50"
            >
              {adding ? "Wird gespeichert…" : "Zuordnung hinzufügen"}
            </button>
          </form>
        </div>

        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="animate-pulse rounded-xl border border-[rgba(21,20,20,0.08)] bg-white p-4">
              <div className="mb-2 h-3 w-1/3 rounded bg-[rgba(21,20,20,0.08)]" />
              <div className="h-3 w-2/3 rounded bg-[rgba(21,20,20,0.08)]" />
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-[rgba(21,20,20,0.08)] bg-white p-6 text-sm text-[#46464a]">
              {loadError}
              <p className="mt-1 text-sm text-[#5f5f64]">Ist die Migration 20260902000001_oereb.sql eingespielt?</p>
            </div>
          ) : mappings.length === 0 ? (
            <div className="rounded-xl border border-[rgba(21,20,20,0.08)] bg-white p-10 text-center text-sm text-[#46464a]">
              Noch keine Zuordnungen vorhanden.
            </div>
          ) : (
            <div className="tba-glass tba-glass--flat tba-scroll-x overflow-x-auto rounded-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[rgba(21,20,20,0.08)] bg-[#f6f3ee] text-left text-[13px] uppercase tracking-wider text-[#46464a]">
                    <th className="px-4 py-3 font-semibold">Thema</th>
                    <th className="px-4 py-3 font-semibold">Kategorie-Muster</th>
                    <th className="px-4 py-3 font-semibold">Geltung</th>
                    <th className="px-4 py-3 font-semibold">Aktiv</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id} className={`tba-row border-b border-[rgba(21,20,20,0.08)] transition-colors last:border-0 ${m.active ? "" : "opacity-50"}`}>
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium text-[#151414]">{themeLabel(m.theme_code)}</p>
                        <p className="font-mono text-[13px] text-[#46464a]">{m.theme_code}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          title={m.category_pattern}
                          className="inline-block max-w-[260px] truncate rounded-full bg-[rgba(21,20,20,0.08)] px-2 py-0.5 align-middle font-mono text-[13px] text-[#46464a]"
                        >
                          {m.category_pattern}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {m.org_id ? (
                          <span className="rounded-full bg-[rgba(21,20,20,0.08)] px-2 py-0.5 text-[13px] font-semibold text-[#46464a]">Organisation</span>
                        ) : (
                          <span className="rounded-full bg-[#cbbfae]/30 px-2 py-0.5 text-[13px] font-semibold text-[#46464a]">Plattformweit</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <button
                          type="button"
                          onClick={() => handleToggle(m)}
                          disabled={busyId === m.id}
                          title={m.active ? "Deaktivieren" : "Aktivieren"}
                          aria-label={m.active ? "Deaktivieren" : "Aktivieren"}
                          aria-pressed={m.active}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${m.active ? "bg-[#151414]" : "bg-[#8c8b8e]"}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${m.active ? "translate-x-4" : "translate-x-0.5"}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right align-top">
                        <button
                          type="button"
                          onClick={() => handleDelete(m)}
                          disabled={busyId === m.id}
                          className="px-1 text-lg leading-none text-[#5f5f64] transition-colors hover:text-[#a3201a] disabled:opacity-40"
                          title="Löschen"
                          aria-label="Löschen"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
