"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AnalysisRow } from "@/lib/admin-analyses/types";
import RowActions from "./RowActions";
import StatusBadge from "./StatusBadge";
import { canRestart, formatCost, formatDateTime, isOrphaned, RESTART_UNAVAILABLE_HINT, rowDuration, type ActionKind } from "./utils";

interface Props {
  row: AnalysisRow;
  stale: boolean;
  now: number;
  orphanMinutes: number;
  busy: boolean;
  escapeEnabled: boolean;
  onAction: (kind: ActionKind, row: AnalysisRow) => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[#7B8299]">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[rgba(60,63,68,0.3)] py-2 last:border-0">
      <dt className="text-xs text-[#7B8299]">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-white">{children}</dd>
    </div>
  );
}

function IdField({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <Field label={label}>—</Field>;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value as string);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Field label={label}>
      <button
        type="button"
        onClick={copy}
        title="In die Zwischenablage kopieren"
        className="max-w-full break-all rounded text-right font-mono text-xs text-[#85A6E9] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]"
      >
        {copied ? "Kopiert" : value}
      </button>
    </Field>
  );
}

export default function AnalysisDetail({ row, stale, now, orphanMinutes, busy, escapeEnabled, onAction, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const rowId = useRef(row.id);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const orphaned = isOrphaned(row, now, orphanMinutes);
  const dur = rowDuration(row, now);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const openId = rowId.current;
    return () => {
      const usable = previous && previous !== document.body && document.contains(previous) ? previous : null;
      (usable ?? document.getElementById(`analysis-open-${openId}`))?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (!escapeEnabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [escapeEnabled]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 lg:bg-black/20" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-detail-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[rgba(60,63,68,0.5)] bg-[#0E111B] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[rgba(60,63,68,0.5)] p-5">
          <div className="min-w-0 space-y-2">
            <StatusBadge status={row.status} orphaned={orphaned} />
            <h2 id="analysis-detail-title" className="truncate text-base font-bold text-white">{row.projectName}</h2>
            <p className="truncate text-xs text-[#ABAEBB]">{row.orgName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Details schliessen"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-[#7B8299] hover:bg-[#172540] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2 12 12M12 2 2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {stale && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
              Dieser Eintrag ist nicht mehr in der aktuellen Liste. Angezeigt wird der letzte bekannte Stand.
            </p>
          )}

          <Section title="Fehlertext">
            {row.errorText ? (
              <p className="whitespace-pre-wrap break-words rounded-xl border border-red-500/20 bg-red-900/15 p-3 text-sm text-red-200">
                {row.errorText}
              </p>
            ) : (
              <p className="text-sm text-[#7B8299]">Kein Fehlertext hinterlegt.</p>
            )}
          </Section>

          <Section title="Zeiten und Kosten">
            <dl>
              <Field label="Erstellt">{formatDateTime(row.createdAt)}</Field>
              <Field label={dur.live ? "Laufzeit bisher" : "Dauer"}>{dur.text}</Field>
              <Field label="Kosten">{formatCost(row.costUsd)}</Field>
            </dl>
          </Section>

          <Section title="Zuordnung">
            <dl>
              <Field label="Organisation">{row.orgName}</Field>
              <Field label="Projekt">{row.projectName}</Field>
              <Field label="Dokumenttyp">{row.docType ?? "—"}</Field>
            </dl>
          </Section>

          <Section title="Kennungen">
            <dl>
              <IdField label="Analyse" value={row.id} />
              <IdField label="Lauf (run_id)" value={row.runId} />
              <IdField label="Dokument" value={row.documentId} />
              <IdField label="Projekt" value={row.projectId} />
              <IdField label="Organisation" value={row.orgId} />
            </dl>
          </Section>
        </div>

        <footer className="space-y-3 border-t border-[rgba(60,63,68,0.5)] p-5">
          {canRestart(row, now, orphanMinutes) && (
            <div className="rounded-xl border border-[rgba(60,63,68,0.5)] bg-[#172540] px-3 py-2.5">
              <p className="text-sm font-semibold text-[#ABAEBB]">{RESTART_UNAVAILABLE_HINT}</p>
              <p className="mt-0.5 text-xs text-[#ABAEBB]">
                Fehlgeschlagene, abgebrochene oder verwaiste Analysen können aus dem Monitor noch nicht erneut gestartet werden.
              </p>
            </div>
          )}
          <RowActions row={row} now={now} orphanMinutes={orphanMinutes} busy={busy} size="md" onAction={onAction} />
        </footer>
      </aside>
    </>
  );
}
