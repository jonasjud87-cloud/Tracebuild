"use client";

import type { AnalysisRow } from "@/lib/admin-analyses/types";
import RowActions from "./RowActions";
import StatusBadge from "./StatusBadge";
import { formatAgo, formatCost, formatDateTime, isOrphaned, rowDuration, type ActionKind } from "./utils";

interface Props {
  items: AnalysisRow[];
  loading: boolean;
  error: string | null;
  now: number;
  orphanMinutes: number;
  expensiveUsd: number;
  selectedId: string | null;
  highlightOrphans: boolean;
  busyId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect: (row: AnalysisRow) => void;
  onAction: (kind: ActionKind, row: AnalysisRow) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

const TH = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#A7AFBA]";
const SHELL = "tba-glass tba-glass--flat overflow-hidden rounded-2xl";

function Skeleton() {
  return (
    <div className={`${SHELL} divide-y divide-[rgba(255,255,255,0.08)]`} aria-busy="true" aria-label="Lade Analysen">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-5 w-24 animate-pulse rounded-full bg-[rgba(240,201,154,0.15)]" />
          <div className="h-4 flex-1 animate-pulse rounded bg-[rgba(240,201,154,0.1)]" />
          <div className="h-4 w-16 animate-pulse rounded bg-[rgba(240,201,154,0.1)]" />
        </div>
      ))}
    </div>
  );
}

export default function AnalysesTable(p: Props) {
  if (p.loading && p.items.length === 0) return <Skeleton />;

  if (p.error && p.items.length === 0) {
    return (
      <div role="alert" className={`${SHELL} p-10 text-center`}>
        <p className="text-sm font-semibold text-[#EBA1A1]">Analysen konnten nicht geladen werden</p>
        <p className="mt-1 text-xs text-[#A7AFBA]">{p.error}</p>
        <button
          type="button"
          onClick={p.onRetry}
          className="mt-4 rounded-xl bg-[linear-gradient(135deg,#F0C99A,#B07D3E)] px-4 py-2 text-sm font-semibold text-[#07142B] hover:bg-[#C79B63] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (p.items.length === 0) {
    return (
      <div className={`${SHELL} p-12 text-center`}>
        <p className="text-sm font-medium text-[#A7AFBA]">Keine Analysen für diese Auswahl</p>
        <p className="mt-1 text-xs text-[#8E98A6]">Passe Ansicht, Organisation oder Zeitraum an.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {p.error && (
        <div role="alert" className="rounded-xl border border-[#D87979]/30 bg-[#D87979]/20 px-4 py-2.5 text-xs text-[#EBA1A1]">
          Aktualisierung fehlgeschlagen: {p.error}. Angezeigt werden die zuletzt geladenen Daten.
        </div>
      )}
      <div className={SHELL}>
        <div className="overflow-x-auto tba-scroll-x">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Analysen organisationsübergreifend</caption>
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.08)] bg-[rgba(17,27,43,0.5)]">
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Organisation / Projekt</th>
                <th scope="col" className={TH}>Erstellt</th>
                <th scope="col" className={`${TH} text-right`}>Dauer</th>
                <th scope="col" className={`${TH} text-right`}>Kosten</th>
                <th scope="col" className={`${TH} text-right`}>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((row) => {
                const orphaned = isOrphaned(row, p.now, p.orphanMinutes);
                const dur = rowDuration(row, p.now);
                const expensive = row.costUsd !== null && row.costUsd >= p.expensiveUsd;
                const selected = row.id === p.selectedId;
                return (
                  <tr
                    key={row.id}
                    onClick={() => p.onSelect(row)}
                    className={`cursor-pointer border-b border-[rgba(255,255,255,0.08)] transition-colors last:border-0 hover:bg-[#223247]/60 ${selected ? "bg-[#192638]" : p.highlightOrphans && orphaned ? "bg-[#D6A45F]/10 shadow-[inset_3px_0_0_0_#D6A45F]" : ""}`}
                  >
                    <td className="px-4 py-3 align-top"><StatusBadge status={row.status} orphaned={orphaned} /></td>
                    <td className="max-w-[22rem] px-4 py-3 align-top">
                      <button
                        type="button"
                        id={`analysis-open-${row.id}`}
                        aria-current={selected ? "true" : undefined}
                        onClick={(e) => { e.stopPropagation(); p.onSelect(row); }}
                        className="block max-w-full rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]"
                        aria-label={`Details öffnen: ${row.orgName}, ${row.projectName}`}
                      >
                        <span className="block truncate font-medium text-white">{row.orgName}</span>
                        <span className="block truncate text-xs text-[#A7AFBA]">{row.projectName}</span>
                      </button>
                      {row.errorText && (
                        <p className="mt-1 line-clamp-2 text-xs text-[#EBA1A1]">{row.errorText}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      <span className="block text-[#A7AFBA]">{formatAgo(row.createdAt, p.now)}</span>
                      <span className="block text-[11px] text-[#A7AFBA]">{formatDateTime(row.createdAt)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums text-[#A7AFBA]">
                      {dur.text}
                      {dur.live && <span className="block text-[11px] text-[#A7AFBA]">seit Start</span>}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right align-top tabular-nums ${expensive ? "font-semibold text-[#D6A45F]" : "text-[#A7AFBA]"}`}>
                      {formatCost(row.costChf)}
                      {expensive && <span className="block text-[11px] font-medium">teuer</span>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <RowActions row={row} now={p.now} orphanMinutes={p.orphanMinutes} busy={p.busyId === row.id} onAction={p.onAction} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {p.hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={p.onLoadMore}
            disabled={p.loadingMore}
            className="rounded-xl border border-[rgba(240,201,154,0.25)] px-5 py-2.5 text-sm font-semibold text-[#F0C99A] hover:bg-[#223247] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]"
          >
            {p.loadingMore ? "Lade …" : "Weitere laden"}
          </button>
        </div>
      )}
    </div>
  );
}
