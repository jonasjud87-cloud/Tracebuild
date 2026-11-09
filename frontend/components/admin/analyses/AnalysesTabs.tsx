"use client";

import type { KeyboardEvent } from "react";
import type { AnalysesSummary, AnalysisView } from "@/lib/admin-analyses/types";
import { VIEW_LABELS, VIEW_ORDER } from "./utils";

interface Props {
  view: AnalysisView;
  summary: AnalysesSummary | null;
  showCounts: boolean;
  onChange: (view: AnalysisView) => void;
}

function countFor(view: AnalysisView, s: AnalysesSummary | null, show: boolean): number | null {
  if (!s || !show) return null;
  if (view === "running") return s.running;
  if (view === "failed") return s.failed24h;
  if (view === "expensive") return s.expensive30d;
  return null;
}

export default function AnalysesTabs({ view, summary, showCounts, onChange }: Props) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const idx = VIEW_ORDER.indexOf(view);
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % VIEW_ORDER.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = VIEW_ORDER.length - 1;
    else return;
    e.preventDefault();
    onChange(VIEW_ORDER[next]);
    requestAnimationFrame(() => document.getElementById(`analyses-tab-${VIEW_ORDER[next]}`)?.focus());
  }

  return (
    <div role="tablist" aria-label="Ansicht" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-[rgba(21,20,20,.08)]">
      {VIEW_ORDER.map((v) => {
        const active = v === view;
        const count = countFor(v, summary, showCounts);
        return (
          <button
            key={v}
            id={`analyses-tab-${v}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls="analyses-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(v)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414] ${
              active ? "border-[#151414] text-[#151414]" : "border-transparent text-[#5f5f64] hover:text-[#46464a]"
            }`}
          >
            {VIEW_LABELS[v]}
            {count !== null && (
              <span className={`rounded-full px-1.5 py-0.5 text-[13px] font-bold tabular-nums ${active ? "bg-[#CBBFAE]/15 text-[#6b6153]" : "bg-[rgba(21,20,20,.07)] text-[#46464a]"}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
