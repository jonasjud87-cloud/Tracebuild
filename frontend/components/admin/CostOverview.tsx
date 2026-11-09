"use client";

import type { OrgCost } from "./types";

interface Props {
  costs: OrgCost[];
  monthlyTotals: { month: string; total: number }[];
  currentMonth: string;
  prevMonthTotal: number;
  monthlyBudget: number;
  fmtMonth: (m: string) => string;
}

function chf(n: number, decimals = 2): string { return `CHF ${n.toFixed(decimals)}`; }

function pctChange(current: number, prev: number): { pct: string; positive: boolean } | null {
  if (prev === 0) return null;
  const diff = ((current - prev) / prev) * 100;
  return { pct: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} %`, positive: diff <= 0 };
}

export default function CostOverview({
  costs, monthlyTotals, currentMonth, prevMonthTotal, monthlyBudget, fmtMonth,
}: Props) {
  const totalThisMonth    = costs.reduce((s, c) => s + c.totalCost,    0);
  const totalAnalyse      = costs.reduce((s, c) => s + c.analyseCost,  0);
  const totalChat         = costs.reduce((s, c) => s + c.chatCost,     0);
  const totalNorm         = costs.reduce((s, c) => s + c.normCost,     0);
  const totalAnalyseCount = costs.reduce((s, c) => s + c.analyseCount, 0);
  const avgPerAnalyse     = totalAnalyseCount > 0 ? totalThisMonth / totalAnalyseCount : 0;
  const budgetRemaining   = monthlyBudget - totalThisMonth;
  const budgetPct         = Math.min((totalThisMonth / monthlyBudget) * 100, 100);
  const change            = pctChange(totalThisMonth, prevMonthTotal);
  const maxTotal          = Math.max(...monthlyTotals.map(m => m.total), 1);
  const maxOrgCost        = Math.max(...costs.map(c => c.totalCost), 1);

  const breakdownCards = [
    { label: "Analysen", value: totalAnalyse, key: "ai"   },
    { label: "Chat",     value: totalChat,    key: "chat" },
    { label: "Normen",   value: totalNorm,    key: "norm" },
  ];

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="tba-card bg-[#1c1b1b] border border-[#cbbfae]/30 rounded-2xl p-5 sm:col-span-1">
          <p className="text-[13px] font-semibold text-[#d6d5d4] uppercase tracking-widest mb-1">
            Gesamtkosten — {fmtMonth(currentMonth)}
          </p>
          <p className="text-3xl font-bold text-[#cbbfae] tabular-nums">{chf(totalThisMonth)}</p>
          {change && (
            <p className={`text-sm font-medium mt-1 ${change.positive ? "text-[#65A88A]" : "text-[#EBA1A1]"}`}>
              {change.pct} vs. Vormonat
            </p>
          )}
          <p className="text-[13px] text-[#d6d5d4] mt-1 tabular-nums">
            {totalAnalyseCount} Analysen · Ø {chf(avgPerAnalyse)}/Analyse
          </p>
        </div>

        <div className="tba-glass rounded-2xl p-5">
          <p className="text-[13px] font-semibold text-[#d6d5d4] uppercase tracking-widest mb-1">Budget verbleibend</p>
          <p className={`text-2xl font-bold tabular-nums ${budgetRemaining < 0 ? "text-[#EBA1A1]" : "text-white"}`}>
            {chf(Math.max(budgetRemaining, 0))}
          </p>
          <div className="mt-2.5 h-2 bg-[#cbbfae]/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${budgetPct >= 90 ? "bg-[#D87979]" : budgetPct >= 70 ? "bg-[#D6A45F]" : "bg-[#cbbfae]"}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <p className="text-[13px] text-[#d6d5d4] mt-1 tabular-nums">
            {chf(totalThisMonth)} von {chf(monthlyBudget)} ({budgetPct.toFixed(0)} %)
          </p>
        </div>

        <div className="tba-glass rounded-2xl p-5">
          <p className="text-[13px] font-semibold text-[#d6d5d4] uppercase tracking-widest mb-1">Vormonat</p>
          <p className="text-2xl font-bold text-white tabular-nums">{chf(prevMonthTotal)}</p>
          <p className="text-[13px] text-[#d6d5d4] mt-1">abgeschlossen (Final)</p>
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className={`text-[13px] font-semibold px-2 py-0.5 rounded-full ${
              change
                ? change.positive ? "bg-[#65A88A]/15 text-[#8FD0B1]" : "bg-[#D87979]/15 text-[#EBA1A1]"
                : "bg-[rgba(255,255,255,0.10)] text-[#adacab]"
            }`}>
              {change ? change.pct : "—"}
            </span>
            <span className="text-[13px] text-[#d6d5d4]">Änderung MoM</span>
          </div>
        </div>
      </div>

      {/* Breakdown cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {breakdownCards.map(card => (
          <div key={card.key} className="bg-[#1c1b1b] border border-[rgba(255,255,255,0.10)] rounded-xl p-4">
            <p className="text-[13px] font-semibold text-[#d6d5d4] uppercase tracking-widest mb-1">{card.label}</p>
            <p className="text-base font-bold text-white tabular-nums">{chf(card.value)}</p>
            <p className="text-[13px] text-[#d6d5d4] mt-0.5 tabular-nums">
              {totalThisMonth > 0 ? ((card.value / totalThisMonth) * 100).toFixed(0) : "0"} %
            </p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 tba-glass rounded-2xl p-5">
          <h4 className="text-sm font-semibold text-white mb-4">6-Monats-Verlauf</h4>
          <div className="space-y-2.5">
            {monthlyTotals.map(mt => {
              const isCurrent = mt.month === currentMonth;
              const barPct = maxTotal > 0 ? (mt.total / maxTotal) * 100 : 0;
              return (
                <div key={mt.month} className="flex items-center gap-3">
                  <span className="text-[13px] text-[#d6d5d4] w-16 flex-shrink-0 tabular-nums">
                    {fmtMonth(mt.month)}
                  </span>
                  <div className="flex-1 h-5 bg-[#cbbfae]/[0.08] rounded-md overflow-hidden">
                    <div
                      className="h-full rounded-md transition-all"
                      style={{
                        width: `${barPct}%`,
                        backgroundColor: isCurrent ? "#cbbfae" : "rgba(203,191,174,0.35)",
                      }}
                    />
                  </div>
                  <span className={`text-[13px] font-medium tabular-nums w-20 text-right flex-shrink-0 ${
                    isCurrent ? "text-[#cbbfae]" : "text-[#d6d5d4]"
                  }`}>
                    {chf(mt.total)}
                    {isCurrent && <span className="text-[13px] text-[#d6d5d4] ml-1">*</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[13px] text-[#d6d5d4] mt-3">* Laufender Monat (Teildaten)</p>
        </div>

        <div className="lg:col-span-2 tba-glass rounded-2xl p-5">
          <h4 className="text-sm font-semibold text-white mb-4">Kosten pro Organisation</h4>
          {costs.length === 0 ? (
            <p className="text-sm text-[#d6d5d4] text-center py-4">Keine Daten</p>
          ) : (
            <div className="space-y-3">
              {[...costs].sort((a, b) => b.totalCost - a.totalCost).map(c => {
                const barPct = maxOrgCost > 0 ? (c.totalCost / maxOrgCost) * 100 : 0;
                const initials = c.orgName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={c.orgId} className="space-y-1">
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-5 h-5 rounded-md bg-[#cbbfae]/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-[8px] font-bold text-[#cbbfae]">{initials}</span>
                        </div>
                        <span className="text-sm font-medium text-white truncate">{c.orgName}</span>
                      </div>
                      <span className="text-sm font-semibold text-white tabular-nums flex-shrink-0">{chf(c.totalCost)}</span>
                    </div>
                    <div className="h-1.5 bg-[#cbbfae]/10 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: "#cbbfae" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
