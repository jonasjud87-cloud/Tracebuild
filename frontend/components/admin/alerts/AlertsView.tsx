"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Severity = "critical" | "warning" | "info";
type View = "open" | "archived";
type Action = "archive" | "delete" | "restore";

interface AlertItem {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  orgName: string | null;
  href: string;
  createdAt: string;
}

interface Payload {
  alerts: AlertItem[];
  archived: AlertItem[];
}

const SEVERITIES: Severity[] = ["critical", "warning", "info"];
const SEVERITY_LABEL: Record<Severity, string> = { critical: "Kritisch", warning: "Warnung", info: "Info" };
const SEVERITY_DOT: Record<Severity, string> = { critical: "bg-[#c0463d]", warning: "bg-[#b97a0c]", info: "bg-[#8f836f]" };

const CARD = "tba-glass rounded-2xl";
const BTN = "rounded-full border border-[#8c8b8e] bg-white px-3.5 py-1.5 text-sm font-medium text-[#151414] transition-colors hover:bg-[#f6f3ee] disabled:opacity-40 disabled:hover:bg-white";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parse(json: unknown): Payload | null {
  const root = json as { data?: Partial<Payload> | null } | null;
  const d = root?.data;
  if (!d || !Array.isArray(d.alerts) || !Array.isArray(d.archived)) return null;
  return { alerts: d.alerts, archived: d.archived };
}

export default function AlertsView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("open");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/alerts", { cache: "no-store" });
      const parsed = res.ok ? parse(await res.json()) : null;
      if (!parsed) throw new Error("bad");
      setData(parsed);
      setError(null);
    } catch {
      setError("Meldungen konnten nicht geladen werden.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const source = view === "open" ? data?.alerts ?? [] : data?.archived ?? [];
    return source.filter(a => severity === "all" || a.severity === severity);
  }, [data, view, severity]);

  const visibleSelected = list.filter(a => selected.has(a.id));
  const allSelected = list.length > 0 && visibleSelected.length === list.length;

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(list.map(a => a.id)));
  }

  function switchView(next: View) {
    setView(next);
    setSelected(new Set());
    setNotice(null);
  }

  async function run(action: Action, ids: string[]) {
    if (!ids.length || busy) return;
    if (action === "delete") {
      const text = ids.length === 1 ? "Diese Meldung löschen?" : `${ids.length} Meldungen löschen?`;
      if (!window.confirm(`${text} Sie erscheint erst wieder, wenn sich ihr Inhalt oder ihre Dringlichkeit ändert.`)) return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/alerts/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string | null } | null;
      if (!res.ok) throw new Error(json?.error ?? "Aktion fehlgeschlagen");
      setSelected(new Set());
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Aktion fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const openCount = data?.alerts.length ?? 0;
  const archivedCount = data?.archived.length ?? 0;
  const selectedIds = visibleSelected.map(a => a.id);

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 p-3`}>
        <div role="tablist" aria-label="Ansicht" className="flex gap-1.5">
          {([["open", `Offen (${openCount})`], ["archived", `Archiv (${archivedCount})`]] as [View, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => switchView(key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${view === key ? "bg-[#151414] text-white" : "text-[#46464a] hover:bg-[#f6f3ee]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-[#46464a]">
          Dringlichkeit
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as Severity | "all")}
            className="rounded-lg border border-[#8c8b8e] bg-white px-2 py-1 text-sm text-[#151414]"
          >
            <option value="all" className="text-black">Alle</option>
            {SEVERITIES.map(s => <option key={s} value={s} className="text-black">{SEVERITY_LABEL[s]}</option>)}
          </select>
        </label>
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 px-1">
          <label className="flex items-center gap-2 text-sm text-[#46464a]">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Alle auswählen
          </label>
          {view === "open" ? (
            <button type="button" className={BTN} disabled={busy || !selectedIds.length} onClick={() => run("archive", selectedIds)}>
              Archivieren
            </button>
          ) : (
            <button type="button" className={BTN} disabled={busy || !selectedIds.length} onClick={() => run("restore", selectedIds)}>
              Wiederherstellen
            </button>
          )}
          <button type="button" className={BTN} disabled={busy || !selectedIds.length} onClick={() => run("delete", selectedIds)}>
            Löschen
          </button>
        </div>
      )}

      {notice && <p role="alert" className="px-1 text-sm text-[#c0463d]">{notice}</p>}
      {error && <p role="alert" className="px-1 text-sm text-[#c0463d]">{error}</p>}
      {!data && !error && <p className="px-1 text-sm text-[#46464a]">Wird geladen…</p>}
      {data && list.length === 0 && (
        <div className={`${CARD} p-8 text-center text-sm text-[#46464a]`}>
          {view === "open" ? "Keine offenen Meldungen." : "Das Archiv ist leer."}
        </div>
      )}

      {list.length > 0 && (
        <ul className={`${CARD} divide-y divide-[rgba(21,20,20,.08)] overflow-hidden`}>
          {list.map(a => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
              <input
                type="checkbox"
                className="mt-1.5"
                checked={selected.has(a.id)}
                onChange={() => toggle(a.id)}
                aria-label={`${a.title} auswählen`}
              />
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[a.severity]}`} title={SEVERITY_LABEL[a.severity]} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#151414]">{a.title}</p>
                <p className="mt-0.5 text-sm text-[#46464a]">{a.message}</p>
                <p className="mt-1 text-[13px] text-[#5f5f64]">
                  {a.orgName ? `${a.orgName} · ` : ""}{SEVERITY_LABEL[a.severity]} · {formatDate(a.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                <Link href={a.href} className={BTN}>Öffnen</Link>
                {view === "open" ? (
                  <button type="button" className={BTN} disabled={busy} onClick={() => run("archive", [a.id])}>Archivieren</button>
                ) : (
                  <button type="button" className={BTN} disabled={busy} onClick={() => run("restore", [a.id])}>Wiederherstellen</button>
                )}
                <button type="button" className={BTN} disabled={busy} onClick={() => run("delete", [a.id])}>Löschen</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
