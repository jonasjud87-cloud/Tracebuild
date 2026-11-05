"use client";

import type { OrgCost } from "./types";
import { fmtMonth } from "./mockCosts";

const statusCfg = {
  laufend: { label: "Laufend", dot: "bg-amber-400",   text: "text-amber-400"   },
  final:   { label: "Final",   dot: "bg-emerald-500", text: "text-emerald-400" },
} as const;

function chf(n: number): string { return `CHF ${n.toFixed(2)}`; }

interface Props { costs: OrgCost[] }

export default function CostTable({ costs }: Props) {
  if (costs.length === 0) {
    return (
      <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl p-10 text-center">
        <p className="text-[#ABAEBB] text-sm">Keine Kostendaten für diesen Zeitraum</p>
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
    <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[780px]">
          <thead>
            <tr className="border-b border-[rgba(60,63,68,0.4)] bg-[rgba(23,37,64,0.5)]">
              <th className="px-5 py-3.5 text-left  text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider">Organisation</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider">Analysen</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider">Analyse-Kosten</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider">Chat-Kosten</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider">Normen-Kosten</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider">Gesamtkosten</th>
              <th className="px-4 py-3.5 text-left  text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider">Monat</th>
              <th className="px-5 py-3.5 text-left  text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((c, idx) => {
              const initials = c.orgName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
              const { label, dot, text } = statusCfg[c.status];
              return (
                <tr
                  key={`${c.orgId}-${c.month}`}
                  className={`hover:bg-[#1E2D4A]/60 transition-colors ${idx < costs.length - 1 ? "border-b border-[rgba(60,63,68,0.3)]" : ""}`}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-[#2862D7]/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-[#85A6E9]">{initials}</span>
                      </div>
                      <span className="font-medium text-white">{c.orgName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-[#ABAEBB] text-right tabular-nums">{c.analyseCount}</td>
                  <td className="px-4 py-4 text-[#ABAEBB] text-right tabular-nums">{chf(c.analyseCost)}</td>
                  <td className="px-4 py-4 text-[#ABAEBB] text-right tabular-nums">{chf(c.chatCost)}</td>
                  <td className="px-4 py-4 text-[#ABAEBB] text-right tabular-nums">{chf(c.normCost)}</td>
                  <td className="px-4 py-4 text-right tabular-nums">
                    <span className="font-semibold text-white">{chf(c.totalCost)}</span>
                  </td>
                  <td className="px-4 py-4 text-[#7B8299] tabular-nums">{fmtMonth(c.month)}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${text}`}>
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
              <tr className="border-t-2 border-[rgba(60,63,68,0.5)] bg-[rgba(23,37,64,0.5)]">
                <td className="px-5 py-3.5 text-xs font-bold text-[#7B8299] uppercase tracking-wider">Total</td>
                <td className="px-4 py-3.5 text-right tabular-nums font-semibold text-white">{totals.analyseCount}</td>
                <td className="px-4 py-3.5 text-right tabular-nums font-semibold text-white">{chf(totals.analyseCost)}</td>
                <td className="px-4 py-3.5 text-right tabular-nums font-semibold text-white">{chf(totals.chatCost)}</td>
                <td className="px-4 py-3.5 text-right tabular-nums font-semibold text-white">{chf(totals.normCost)}</td>
                <td className="px-4 py-3.5 text-right tabular-nums">
                  <span className="font-bold text-white">{chf(totals.total)}</span>
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
