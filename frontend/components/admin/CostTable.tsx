"use client";

import type { OrgCost } from "./types";
import { fmtMonth } from "./mockCosts";

const statusCfg = {
  laufend: { label: "Laufend", dot: "bg-[#b97a0c]",   text: "text-[#7a4f00]"   },
  final:   { label: "Final",   dot: "bg-[#2f8a5b]", text: "text-[#136a40]" },
} as const;

function chf(n: number): string { return `CHF ${n.toFixed(2)}`; }

interface Props { costs: OrgCost[] }

export default function CostTable({ costs }: Props) {
  if (costs.length === 0) {
    return (
      <div className="tba-glass rounded-2xl p-10 text-center">
        <p className="text-[#46464a] text-sm">Keine Kostendaten für diesen Zeitraum</p>
      </div>
    );
  }

  const totals = {
    analyseCount: costs.reduce((s, c) => s + c.analyseCount, 0),
    analyseCost:  costs.reduce((s, c) => s + c.analyseCost, 0),
    chatCost:     costs.reduce((s, c) => s + c.chatCost, 0),
    normCost:     costs.reduce((s, c) => s + c.normCost, 0),
    total:        costs.reduce((s, c) => s + c.totalCost, 0),
  };

  return (
    <div className="tba-glass tba-glass--flat rounded-2xl overflow-hidden">
      <div className="overflow-x-auto tba-scroll-x">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(21,20,20,0.08)] bg-[#f6f3ee]">
              <th className="px-5 py-3.5 text-left  text-[13px] font-semibold text-[#46464a] uppercase tracking-wider">Organisation</th>
              <th className="hidden 2xl:table-cell px-3 py-3.5 text-right text-[13px] font-semibold text-[#46464a] uppercase tracking-wider">Analysen</th>
              <th className="px-4 py-3.5 text-right text-[13px] font-semibold text-[#46464a] uppercase tracking-wider">Analyse-Kosten</th>
              <th className="hidden xl:table-cell px-3 py-3.5 text-right text-[13px] font-semibold text-[#46464a] uppercase tracking-wider">Chat-Kosten</th>
              <th className="hidden 2xl:table-cell px-3 py-3.5 text-right text-[13px] font-semibold text-[#46464a] uppercase tracking-wider">Normen-Kosten</th>
              <th className="px-4 py-3.5 text-right text-[13px] font-semibold text-[#46464a] uppercase tracking-wider">Gesamtkosten</th>
              <th className="px-4 py-3.5 text-left  text-[13px] font-semibold text-[#46464a] uppercase tracking-wider">Monat</th>
              <th className="px-5 py-3.5 text-left  text-[13px] font-semibold text-[#46464a] uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((c, idx) => {
              const initials = c.orgName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
              const { label, dot, text } = statusCfg[c.status];
              return (
                <tr
                  key={`${c.orgId}-${c.month}`}
                  className={`tba-row transition-colors ${idx < costs.length - 1 ? "border-b border-[rgba(21,20,20,0.08)]" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-[#cbbfae]/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-[13px] font-bold text-[#6b6153]">{initials}</span>
                      </div>
                      <span className="font-medium text-[#151414] truncate max-w-[220px]" title={c.orgName}>{c.orgName}</span>
                    </div>
                  </td>
                  <td className="hidden 2xl:table-cell px-3 py-3 text-[#46464a] text-right tabular-nums">{c.analyseCount}</td>
                  <td className="px-3 py-3 text-[#46464a] text-right tabular-nums">{chf(c.analyseCost)}</td>
                  <td className="hidden xl:table-cell px-3 py-3 text-[#46464a] text-right tabular-nums">{chf(c.chatCost)}</td>
                  <td className="hidden 2xl:table-cell px-3 py-3 text-[#46464a] text-right tabular-nums">{chf(c.normCost)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className="font-semibold text-[#151414]">{chf(c.totalCost)}</span>
                  </td>
                  <td className="px-3 py-3 text-[#5f5f64] tabular-nums">{fmtMonth(c.month)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                      {label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {costs.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-[rgba(21,20,20,0.08)] bg-white">
                <td className="px-5 py-3.5 text-sm font-bold text-[#5f5f64] uppercase tracking-wider">Total</td>
                <td className="hidden 2xl:table-cell px-3 py-3.5 text-right tabular-nums font-semibold text-[#151414]">{totals.analyseCount}</td>
                <td className="px-4 py-3.5 text-right tabular-nums font-semibold text-[#151414]">{chf(totals.analyseCost)}</td>
                <td className="hidden xl:table-cell px-3 py-3.5 text-right tabular-nums font-semibold text-[#151414]">{chf(totals.chatCost)}</td>
                <td className="hidden 2xl:table-cell px-3 py-3.5 text-right tabular-nums font-semibold text-[#151414]">{chf(totals.normCost)}</td>
                <td className="px-4 py-3.5 text-right tabular-nums">
                  <span className="font-bold text-[#151414]">{chf(totals.total)}</span>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
