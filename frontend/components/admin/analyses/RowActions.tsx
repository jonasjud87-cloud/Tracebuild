"use client";

import type { AnalysisRow } from "@/lib/admin-analyses/types";
import { canCancel, isOrphaned, type ActionKind } from "./utils";

interface Props {
  row: AnalysisRow;
  now: number;
  orphanMinutes: number;
  busy: boolean;
  size?: "sm" | "md";
  onAction: (kind: ActionKind, row: AnalysisRow) => void;
}

export default function RowActions({ row, now, orphanMinutes, busy, size = "sm", onAction }: Props) {
  if (!canCancel(row)) return <span className="text-[13px] text-[#5f5f64]">—</span>;

  const pad = size === "md" ? "px-3.5 py-2 text-sm" : "px-2.5 py-1 text-[13px]";
  const orphaned = isOrphaned(row, now, orphanMinutes);

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); onAction("cancel", row); }}
        className={`rounded-lg border border-[#D87979]/40 font-semibold whitespace-nowrap text-[#a3201a] transition-colors hover:bg-[#D87979]/10 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414] ${pad}`}
      >
        {orphaned ? "Beenden" : "Abbrechen"}
      </button>
    </div>
  );
}
