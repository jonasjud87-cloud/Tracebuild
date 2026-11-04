"use client";

import { useEffect, useState } from "react";
import type { AnalysisView, OrgOption } from "@/lib/admin-analyses/types";
import { RANGE_OPTIONS, type RangeKey } from "./utils";

interface Props {
  view: AnalysisView;
  orgs: OrgOption[];
  org: string;
  range: RangeKey;
  minCost: string;
  expensiveUsd: number;
  dirty: boolean;
  onOrg: (v: string) => void;
  onRange: (v: RangeKey) => void;
  onMinCost: (v: string) => void;
  onReset: () => void;
}

const FIELD =
  "rounded-xl border border-[rgba(133,166,233,0.25)] bg-[rgba(23,37,64,0.6)] px-3 py-2 text-sm text-white focus:border-[#2862D7] focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40";

export default function AnalysesFilters({
  view, orgs, org, range, minCost, expensiveUsd, dirty, onOrg, onRange, onMinCost, onReset,
}: Props) {
  const [draftCost, setDraftCost] = useState(minCost);
  useEffect(() => setDraftCost(minCost), [minCost]);

  function commitCost() {
    const t = draftCost.trim();
    if (t !== "" && (!Number.isFinite(Number(t)) || Number(t) < 0)) {
      setDraftCost(minCost);
      return;
    }
    if (t !== minCost) onMinCost(t);
  }

  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filter">
      <label className="flex min-w-[11rem] flex-1 flex-col gap-1 sm:flex-none">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#7B8299]">Organisation</span>
        <select value={org} onChange={(e) => onOrg(e.target.value)} className={FIELD}>
          <option value="">Alle Organisationen</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[11rem] flex-1 flex-col gap-1 sm:flex-none">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#7B8299]">Zeitraum</span>
        <select value={range} onChange={(e) => onRange(e.target.value as RangeKey)} className={FIELD}>
          {RANGE_OPTIONS.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </label>
      {view === "expensive" && (
        <label className="flex w-36 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#7B8299]">Mindestkosten (USD)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={draftCost}
            placeholder={expensiveUsd.toFixed(2)}
            onChange={(e) => setDraftCost(e.target.value)}
            onBlur={commitCost}
            onKeyDown={(e) => { if (e.key === "Enter") commitCost(); }}
            className={FIELD}
          />
        </label>
      )}
      {dirty && (
        <button
          type="button"
          onClick={onReset}
          className="rounded-xl px-3 py-2 text-sm font-medium text-[#85A6E9] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]"
        >
          Filter zurücksetzen
        </button>
      )}
    </div>
  );
}
