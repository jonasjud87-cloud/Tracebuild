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
  expensiveChf: number;
  dirty: boolean;
  onOrg: (v: string) => void;
  onRange: (v: RangeKey) => void;
  onMinCost: (v: string) => void;
  onReset: () => void;
}

const FIELD =
  "rounded-xl border border-[#8c8b8e] bg-white px-3 py-2 text-sm text-[#151414] focus:border-[#151414] focus:outline-none focus:ring-2 focus:ring-[rgba(203,191,174,.55)]";

export default function AnalysesFilters({
  view, orgs, org, range, minCost, expensiveChf, dirty, onOrg, onRange, onMinCost, onReset,
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
        <span className="text-[13px] font-semibold uppercase tracking-widest text-[#46464a]">Organisation</span>
        <select value={org} onChange={(e) => onOrg(e.target.value)} className={FIELD}>
          <option value="">Alle Organisationen</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[11rem] flex-1 flex-col gap-1 sm:flex-none">
        <span className="text-[13px] font-semibold uppercase tracking-widest text-[#46464a]">Zeitraum</span>
        <select value={range} onChange={(e) => onRange(e.target.value as RangeKey)} className={FIELD}>
          {RANGE_OPTIONS.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </label>
      {view === "expensive" && (
        <label className="flex w-36 flex-col gap-1">
          <span className="text-[13px] font-semibold uppercase tracking-widest text-[#46464a]">Mindestkosten (CHF)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={draftCost}
            placeholder={expensiveChf.toFixed(2)}
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
          className="rounded-xl px-3 py-2 text-sm font-medium text-[#6b6153] hover:text-[#151414] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]"
        >
          Filter zurücksetzen
        </button>
      )}
    </div>
  );
}
