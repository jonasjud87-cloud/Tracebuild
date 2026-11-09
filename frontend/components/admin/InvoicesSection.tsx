"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Invoice } from "@/lib/admin-billing";
import type { ToastMessage } from "./types";

interface Props { onToast: (msg: string, type: ToastMessage["type"]) => void }

type Format = "csv" | "pdf";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const CARD = "tba-glass rounded-2xl";
const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#cbbfae]";
const SMALL_BTN = `text-sm font-semibold text-[#cbbfae] bg-[#cbbfae]/10 hover:bg-[#cbbfae] hover:text-[#151414] px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${FOCUS}`;

function chf(n: number): string {
  return `CHF ${n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function chfUnit(n: number): string {
  return `CHF ${n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-CH", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")?.value ?? "0000";
  const m = parts.find(p => p.type === "month")?.value ?? "00";
  return `${y}-${m}`;
}

function fileNameFrom(res: Response, fallback: string): string {
  const header = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (!match) return fallback;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const cls = status === "final"
    ? "bg-[#65A88A]/10 text-[#65A88A] border-[#65A88A]/30"
    : "bg-[#D6A45F]/10 text-[#D6A45F] border-[#D6A45F]/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[13px] font-semibold ${cls}`}>
      {status === "final" ? "Final" : "Laufend"}
    </span>
  );
}

export default function InvoicesSection({ onToast }: Props) {
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => String(thisYear - i)), [thisYear]);
  const [year, setYear] = useState(String(thisYear));
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/invoices?year=${year}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { data: Invoice[] | null; error?: string | null } | null;
      if (id !== requestId.current) return;
      if (!res.ok || !json || json.error || !Array.isArray(json.data)) {
        setError(json?.error ?? `Laden fehlgeschlagen (HTTP ${res.status})`);
        setInvoices([]);
      } else {
        setInvoices(json.data);
      }
    } catch {
      if (id !== requestId.current) return;
      setError("Netzwerkfehler. Bitte Verbindung prüfen.");
      setInvoices([]);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const inv of invoices) {
      const list = map.get(inv.month);
      if (list) list.push(inv); else map.set(inv.month, [inv]);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, rows]) => ({
        month,
        rows: [...rows].sort((a, b) => a.orgName.localeCompare(b.orgName)),
        total: rows.reduce((s, r) => s + r.amountChf, 0),
      }));
  }, [invoices]);

  const rate = invoices[0]?.usdToChf;

  async function download(format: Format, period: string) {
    if (busy) return;
    setBusy(`${format}:${period}`);
    try {
      const res = await fetch(`/api/v1/admin/reports/export?format=${format}&period=${period}`, { cache: "no-store" });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string | null } | null;
        onToast(json?.error ?? `Export fehlgeschlagen (HTTP ${res.status})`, "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameFrom(res, `tracebuild-kosten-${period}.${format}`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      onToast("Export fehlgeschlagen. Bitte Verbindung prüfen.", "error");
    } finally {
      setBusy(null);
    }
  }

  function toggle(id: string) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const isBusy = (format: Format, period: string) => busy === `${format}:${period}`;
  const month = currentMonth();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className={`lg:col-span-2 ${CARD} overflow-hidden`}>
        <div className="px-5 py-4 border-b border-[rgba(255,255,255,0.10)] flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Monatliche Kostenberichte</h3>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="invoice-year">Jahr</label>
            <select
              id="invoice-year"
              value={year}
              onChange={e => setYear(e.target.value)}
              className={`rounded-lg border border-[rgba(203,191,174,0.55)] bg-[rgba(28,27,27,0.6)] px-2.5 py-1.5 text-sm text-white ${FOCUS}`}
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              type="button"
              onClick={() => void download("csv", year)}
              disabled={busy !== null || loading || invoices.length === 0}
              className={`text-sm font-semibold text-[#cbbfae] bg-[#cbbfae]/10 hover:bg-[#cbbfae] hover:text-[#151414] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${FOCUS}`}
            >
              {isBusy("csv", year) ? "Wird exportiert …" : "Alle exportieren"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-[rgba(255,255,255,0.10)]" aria-busy="true" aria-label="Lade Kostenberichte">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                <div className="h-3 w-28 rounded bg-[rgba(255,255,255,0.10)]" />
                <div className="h-3 flex-1 rounded bg-[rgba(255,255,255,0.10)]" />
                <div className="h-3 w-20 rounded bg-[rgba(255,255,255,0.10)]" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col items-center justify-center py-14 px-6 text-center">
            <p className="text-sm font-medium text-white mb-1">Kostenberichte konnten nicht geladen werden</p>
            <p className="text-sm text-[#adacab] mb-4">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className={`text-sm font-semibold text-[#151414] bg-[linear-gradient(135deg,#cbbfae,#b5a893)] hover:brightness-110 px-4 py-2 rounded-xl transition-colors ${FOCUS}`}
            >
              Erneut versuchen
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-[#cbbfae]/10 flex items-center justify-center mb-3">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-[#cbbfae]" aria-hidden="true">
                <path d="M4 14V4a1 1 0 011-1h6l3 3v8a1 1 0 01-1 1H5a1 1 0 01-1-1Z" stroke="currentColor" strokeWidth="1.3" />
                <path d="M11 3v3h3M7 9h4M7 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-medium text-white mb-1">Keine Kostenberichte für {year}</p>
            <p className="text-sm text-[#adacab]">Berichte erscheinen hier, sobald Nutzungskosten anfallen.</p>
          </div>
        ) : (
          <div className="overflow-x-auto tba-scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.10)] text-left text-[13px] font-semibold uppercase tracking-widest text-[#d6d5d4]">
                  <th scope="col" className="px-4 py-3">Beleg-Nr.</th>
                  <th scope="col" className="px-4 py-3">Organisation</th>
                  <th scope="col" className="px-4 py-3 text-right">Analysen</th>
                  <th scope="col" className="px-4 py-3 text-right">Betrag</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Datum</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <Fragment key={g.month}>
                    <tr className="bg-[#242324]/50 border-y border-[rgba(255,255,255,0.10)]">
                      <th scope="colgroup" colSpan={3} className="px-4 py-2.5 text-left text-sm font-semibold text-white">
                        {monthLabel(g.month)}
                        <span className="ml-3 font-normal text-[#adacab] tabular-nums">{chf(g.total)}</span>
                      </th>
                      <td colSpan={3} className="px-4 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <button type="button" className={SMALL_BTN} disabled={busy !== null} onClick={() => void download("csv", g.month)} aria-label={`${monthLabel(g.month)} als CSV exportieren`}>
                            {isBusy("csv", g.month) ? "…" : "CSV"}
                          </button>
                          <button type="button" className={SMALL_BTN} disabled={busy !== null} onClick={() => void download("pdf", g.month)} aria-label={`${monthLabel(g.month)} als PDF exportieren`}>
                            {isBusy("pdf", g.month) ? "…" : "PDF"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {g.rows.map(inv => {
                      const expanded = open.has(inv.id);
                      return (
                        <Fragment key={inv.id}>
                          <tr className="border-b border-[rgba(255,255,255,0.10)] tba-row transition-colors">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => toggle(inv.id)}
                                aria-expanded={expanded}
                                aria-controls={`inv-lines-${inv.id}`}
                                className={`flex items-center gap-2 rounded text-left font-mono text-sm text-white ${FOCUS}`}
                              >
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className={`text-[#adacab] transition-transform ${expanded ? "rotate-90" : ""}`}>
                                  <path d="M3 1.5 6.5 5 3 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                {inv.id}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-[#d6d5d4] max-w-[240px] truncate" title={inv.orgName}>{inv.orgName}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#d6d5d4]">{inv.analyseCount}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold text-white whitespace-nowrap">{chf(inv.amountChf)}</td>
                            <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                            <td className="px-4 py-3 text-[#d6d5d4] whitespace-nowrap tabular-nums">{formatDate(inv.issuedAt)}</td>
                          </tr>
                          {expanded && (
                            <tr id={`inv-lines-${inv.id}`} className="border-b border-[rgba(255,255,255,0.10)] bg-[#151414]/40">
                              <td colSpan={6} className="px-4 py-3">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-[13px] font-semibold uppercase tracking-widest text-[#d6d5d4]">
                                      <th scope="col" className="py-1.5 pr-3 font-semibold">Position</th>
                                      <th scope="col" className="py-1.5 px-3 text-right font-semibold">Menge</th>
                                      <th scope="col" className="py-1.5 px-3 text-right font-semibold">Einzelpreis</th>
                                      <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {inv.lines.map((l, i) => (
                                      <tr key={i} className="text-[#d6d5d4]">
                                        <td className="py-1.5 pr-3">{l.description}</td>
                                        <td className="py-1.5 px-3 text-right tabular-nums">{l.quantity}</td>
                                        <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{chfUnit(l.unitChf)}</td>
                                        <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap text-white">{chf(l.totalChf)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className={`${CARD} p-5`}>
          <h4 className="text-sm font-semibold text-white mb-4">Schnellexport</h4>
          <div className="space-y-2">
            {([
              { label: "Aktueller Monat — PDF", format: "pdf", period: month },
              { label: `Jahresdaten ${year} — CSV`, format: "csv", period: year },
              { label: `Jahresdaten ${year} — PDF`, format: "pdf", period: year },
            ] as const).map(({ label, format, period }) => (
              <button
                key={label}
                type="button"
                onClick={() => void download(format, period)}
                disabled={busy !== null}
                className={`w-full text-left text-sm font-medium text-[#d6d5d4] hover:text-white hover:bg-[#2e2e30]/60 py-2.5 px-3.5 rounded-xl border border-[rgba(255,255,255,0.10)] transition-colors disabled:opacity-50 disabled:pointer-events-none ${FOCUS}`}
              >
                {isBusy(format, period) ? "Wird exportiert …" : label}
              </button>
            ))}
          </div>
        </div>

        <div className={`${CARD} p-5`}>
          <h4 className="text-sm font-semibold text-white mb-2">Hinweis</h4>
          <p className="text-sm text-[#adacab] leading-relaxed">
            Die Beträge sind aus den Nutzungskosten der Analysen abgeleitet und keine steuerlich gültigen Rechnungen.
            {rate !== undefined && ` Umrechnung in CHF zum aktuellen Kurs ${rate.toLocaleString("de-CH", { maximumFractionDigits: 4 })} (USD/CHF), nicht historisiert.`}
            {" "}Monate mit Status «Laufend» sind vorläufig und können sich noch ändern.
          </p>
        </div>
      </div>
    </div>
  );
}
