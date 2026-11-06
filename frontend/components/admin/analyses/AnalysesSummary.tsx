"use client";

import type { AnalysesSummary as Summary, AnalysisView } from "@/lib/admin-analyses/types";
import { formatCostTotal } from "./utils";

interface TileProps {
  label: string;
  value: string;
  note?: string;
  tone?: "default" | "warn" | "danger" | "accent";
  onSelect?: () => void;
  loading: boolean;
}

const TONE_VALUE: Record<NonNullable<TileProps["tone"]>, string> = {
  default: "text-white",
  warn: "text-[#D6A45F]",
  danger: "text-[#EBA1A1]",
  accent: "text-[#F0C99A]",
};

function Tile({ label, value, note, tone = "default", onSelect, loading }: TileProps) {
  const body = (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-widest text-[#A7AFBA]">{label}</span>
      {loading ? (
        <span className="mt-2 h-7 w-16 animate-pulse rounded bg-[rgba(240,201,154,0.15)]" aria-hidden="true" />
      ) : (
        <span className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${TONE_VALUE[tone]}`}>{value}</span>
      )}
      {note && <span className="mt-1 text-[11px] text-[#A7AFBA]">{note}</span>}
    </>
  );
  const cls = "flex flex-col items-start rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#111B2B] p-4 text-left";
  if (!onSelect) return <div className={cls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${cls} transition-colors hover:border-[#F0C99A]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]`}
    >
      {body}
    </button>
  );
}

interface Props {
  summary: Summary | null;
  loading: boolean;
  failed: boolean;
  expensiveChf: number;
  orphanMinutes: number;
  onSelectView: (view: AnalysisView) => void;
  onSelectOrphans: () => void;
}

export default function AnalysesSummary({ summary, loading, failed, expensiveChf, orphanMinutes, onSelectView, onSelectOrphans }: Props) {
  const pending = loading && !summary;
  const v = (n: number | undefined) => (summary && n !== undefined ? String(n) : "—");
  return (
    <section aria-label="Zusammenfassung" className="space-y-2">
    <p className="text-xs text-[#8E98A6]">
      Kennzahlen gesamt, ohne Filter
      {failed && <span className="ml-2 text-[#D6A45F]" role="status">Kennzahlen konnten nicht aktualisiert werden</span>}
    </p>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <Tile label="Laufend" value={v(summary?.running)} tone="accent" loading={pending} onSelect={() => onSelectView("running")} />
      <Tile
        label="Verwaist"
        value={v(summary?.orphaned)}
        note={`laufend, älter als ${orphanMinutes} Min.`}
        tone={summary && summary.orphaned > 0 ? "warn" : "default"}
        loading={pending}
        onSelect={onSelectOrphans}
      />
      <Tile
        label="Fehlgeschlagen"
        value={v(summary?.failed24h)}
        note="letzte 24 Stunden"
        tone={summary && summary.failed24h > 0 ? "danger" : "default"}
        loading={pending}
        onSelect={() => onSelectView("failed")}
      />
      <Tile
        label="Teuer"
        value={v(summary?.expensive30d)}
        note={`ab CHF ${expensiveChf.toFixed(2)}, 30 Tage`}
        loading={pending}
        onSelect={() => onSelectView("expensive")}
      />
      <Tile
        label="Kosten heute"
        value={summary ? formatCostTotal(summary.costTodayChf) : "—"}
        note={summary ? `30 Tage: ${formatCostTotal(summary.cost30dChf)}${summary.costTruncated ? "+" : ""}` : undefined}
        tone="accent"
        loading={pending}
      />
    </div>
    </section>
  );
}
