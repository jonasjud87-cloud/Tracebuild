"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Severity = "critical" | "warning" | "info";

interface AlertItem {
  id: string;
  rule: string;
  severity: Severity;
  title: string;
  message: string;
  orgId: string | null;
  orgName: string | null;
  href: string;
  createdAt: string;
}

interface AlertsData {
  alerts: AlertItem[];
  counts: { critical: number; warning: number; info: number; total: number };
  generatedAt: string;
}

type Status = "loading" | "ready" | "error" | "hidden";

const REFRESH_MS = 120_000;

const SEVERITY_META: Record<Severity, { label: string; dot: string; badge: string }> = {
  critical: { label: "Kritisch", dot: "bg-[#c0463d]", badge: "bg-[#D87979]" },
  warning: { label: "Warnung", dot: "bg-[#b97a0c]", badge: "bg-[#D6A45F]" },
  info: { label: "Info", dot: "bg-[#8f836f]", badge: "bg-[#CBBFAE]" },
};

const SEVERITIES: Severity[] = ["critical", "warning", "info"];

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
}

function parse(json: unknown): AlertsData | null {
  const root = json as { data?: unknown } | null;
  const d = (root && typeof root === "object" && "data" in root && root.data ? root.data : json) as Partial<AlertsData> | null;
  if (!d || !Array.isArray(d.alerts)) return null;
  const alerts = d.alerts.filter(
    (a): a is AlertItem => !!a && typeof a.id === "string" && SEVERITIES.includes(a.severity),
  );
  const counts = { critical: 0, warning: 0, info: 0, total: alerts.length };
  for (const a of alerts) counts[a.severity] += 1;
  return { alerts, counts, generatedAt: typeof d.generatedAt === "string" ? d.generatedAt : new Date().toISOString() };
}

export default function AlertBell() {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<AlertsData | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef(false);

  const load = useCallback(async () => {
    if (hiddenRef.current) return;
    try {
      const res = await fetch("/api/v1/admin/alerts", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        hiddenRef.current = true;
        setStatus("hidden");
        return;
      }
      if (!res.ok) throw new Error("bad status");
      const parsed = parse(await res.json());
      if (!parsed) throw new Error("bad payload");
      setData(parsed);
      setStatus("ready");
    } catch {
      setStatus(prev => (prev === "ready" ? prev : "error"));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    load();
    panelRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointer(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, load]);

  if (status === "hidden") return null;

  const counts = data?.counts ?? { critical: 0, warning: 0, info: 0, total: 0 };
  const total = status === "ready" ? counts.total : 0;
  const topSeverity: Severity | null = counts.critical ? "critical" : counts.warning ? "warning" : counts.info ? "info" : null;
  const showBadge = status === "ready" && total > 0 && topSeverity !== null;

  const label = status === "ready"
    ? total > 0 ? `Benachrichtigungen, ${total} ${total === 1 ? "offene Meldung" : "offene Meldungen"}` : "Benachrichtigungen, keine offenen Meldungen"
    : "Benachrichtigungen";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        title="Benachrichtigungen"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.5A5 5 0 0 0 3 6.5v3L2 11h12l-1-1.5v-3A5 5 0 0 0 8 1.5ZM6 12a2 2 0 0 0 4 0"
            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        {showBadge && topSeverity && (
          <span
            aria-hidden="true"
            className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[13px] font-bold leading-4 text-[#151414] text-center ${SEVERITY_META[topSeverity].badge}`}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Benachrichtigungen"
          tabIndex={-1}
          className="tba-pop tba-light fixed left-3 right-3 top-[68px] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px] z-50 rounded-2xl border border-[var(--tba-border,#8c8b8e)] bg-[var(--tba-slate,#ffffff)] shadow-2xl outline-none overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--tba-line,rgba(21,20,20,.08))]">
            <span className="text-sm font-semibold text-[var(--tba-text,#151414)]">Benachrichtigungen</span>
            {status === "ready" && total > 0 && (
              <span className="flex items-center gap-2.5 text-[13px] text-[var(--tba-text-2,#46464a)]">
                {SEVERITIES.filter(s => counts[s] > 0).map(s => (
                  <span key={s} className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_META[s].dot}`} />
                    {counts[s]}
                  </span>
                ))}
              </span>
            )}
          </div>

          <div className="max-h-[min(70vh,420px)] overflow-y-auto">
            {status === "loading" && (
              <p className="px-4 py-8 text-center text-sm text-[var(--tba-text-2,#46464a)]">Wird geladen…</p>
            )}
            {status === "error" && (
              <p className="px-4 py-8 text-center text-sm text-[var(--tba-text-2,#46464a)]">Alerts nicht verfügbar</p>
            )}
            {status === "ready" && total === 0 && (
              <p className="px-4 py-8 text-center text-sm text-[var(--tba-text-2,#46464a)]">Alles in Ordnung</p>
            )}
            {status === "ready" && total > 0 && data && SEVERITIES.map(sev => {
              const items = data.alerts.filter(a => a.severity === sev);
              if (!items.length) return null;
              return (
                <div key={sev} className="py-1">
                  <div className="flex items-center gap-2 px-4 pt-2 pb-1">
                    <span className={`w-2 h-2 rounded-full ${SEVERITY_META[sev].dot}`} />
                    <span className="text-[13px] font-bold uppercase tracking-widest text-[var(--tba-text-2,#46464a)]">
                      {SEVERITY_META[sev].label}
                    </span>
                  </div>
                  <ul>
                    {items.map(a => (
                      <li key={a.id}>
                        <Link
                          href={a.href}
                          onClick={() => setOpen(false)}
                          className="block px-4 py-2.5 hover:bg-[var(--tba-hover,#f6f3ee)] focus:bg-[var(--tba-hover,#f6f3ee)] outline-none transition-colors"
                        >
                          <span className="block text-sm font-medium text-[var(--tba-text,#151414)]">{a.title}</span>
                          <span className="block text-[13px] text-[var(--tba-text-2,#46464a)] mt-0.5">{a.message}</span>
                          <span className="flex items-center gap-1.5 mt-1 text-[13px] text-[var(--tba-text-2,#46464a)]">
                            {a.orgName && <span className="truncate max-w-[200px]">{a.orgName}</span>}
                            {a.orgName && <span aria-hidden="true">·</span>}
                            <span>{relativeTime(a.createdAt)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="border-t border-[var(--tba-line,rgba(21,20,20,.08))] px-4 py-2.5 text-center">
            <Link
              href="/admin/alerts"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-[var(--tba-text,#151414)] underline underline-offset-2"
            >
              Alle Meldungen verwalten
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
