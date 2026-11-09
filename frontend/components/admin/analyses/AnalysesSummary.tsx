"use client";

import type { AnalysesSummary as Summary, AnalysisView } from "@/lib/admin-analyses/types";
import { formatCostTotal } from "./utils";

interface TileProps {
  label: string;
  value: string;
  note?: string;
  tone?: "default" | "warn" | "danger" | "accent" | "dark";
  onSelect?: () => void;
  loading: boolean;
}

const TONE_VALUE: Record<NonNullable<TileProps["tone"]>, string> = {
  default: "text-[#151414]",
  warn: "text-[#7a4f00]",
  danger: "text-[#a3201a]",
  accent: "text-[#6b6153]",
  dark: "text-white",
};

function Tile({ label, value, note, tone = "default", onSelect, loading }: TileProps) {
  const body = (
    <>
      <span className={`text-[13px] font-semibold uppercase tracking-widest ${tone === "dark" ? "text-white/80" : "text-[#46464a]"}`}>{label}</span>
      {loading ? (
        <span className="mt-2 h-7 w-16 animate-pulse rounded bg-[rgba(21,20,20,.06)]" aria-hidden="true" />
      ) : (
        <span className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${TONE_VALUE[tone]}`}>{value}</span>
      )}
      {note && <span className={`mt-1 text-[13px] ${tone === "dark" ? "text-white/80" : "text-[#46464a]"}`}>{note}</span>}
    </>
  );
  const cls = `flex flex-col items-start rounded-2xl border p-4 text-left ${tone === "dark" ? "border-[#151414] bg-[#151414]" : "border-[rgba(21,20,20,.08)] bg-white"}`;
  if (!onSelect) return <div className={cls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${cls} transition-colors ${tone === "dark" ? "hover:border-[#cbbfae] focus-visible:ring-[#cbbfae]" : "hover:border-[#9c8f7b] focus-visible:ring-[#151414]"} focus:outline-none focus-visible:ring-2`}
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
    <p className="text-[13px] text-[#5f5f64]">
      Kennzahlen gesamt, ohne Filter
      {failed && <span className="ml-2 text-[#7a4f00]" role="status">Kennzahlen konnten nicht aktualisiert werden</span>}
    </p>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <Tile label="Laufend" value={v(summary?.running)} tone="dark" loading={pending} onSelect={() => onSelectView("running")} />
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
