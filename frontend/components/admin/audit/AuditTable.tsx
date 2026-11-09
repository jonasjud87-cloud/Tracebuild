"use client";

import { actionLabel } from "./types";
import type { AuditItem } from "./types";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("de-CH", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const TH = "py-3.5 px-4 text-sm font-semibold text-[#46464a] uppercase tracking-wider text-left whitespace-nowrap";

export default function AuditTable({ items }: { items: AuditItem[] }) {
  return (
    <div className="tba-glass tba-glass--flat rounded-2xl overflow-hidden">
      <div className="overflow-x-auto tba-scroll-x">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(21,20,20,.08)] bg-[#f6f3ee]">
              <th className={TH}>Zeit</th>
              <th className={TH}>Akteur</th>
              <th className={TH}>Aktion</th>
              <th className={TH}>Ziel</th>
              <th className={TH}>Organisation</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className="tba-row border-b border-[rgba(21,20,20,.08)] last:border-0">
                <td className="px-4 py-3 text-[#46464a] whitespace-nowrap tabular-nums">{fmtTime(it.createdAt)}</td>
                <td className="px-3 py-3 text-[#151414] max-w-[200px] truncate" title={it.actorEmail}>{it.actorEmail}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-block text-[13px] font-semibold px-2 py-0.5 rounded-full bg-[#CBBFAE]/10 text-[#6b6153]" title={it.action}>
                    {actionLabel(it.action, it.meta)}
                  </span>
                </td>
                <td className="px-3 py-3 text-[#46464a] max-w-[200px] truncate" title={it.targetEmail ?? undefined}>{it.targetEmail ?? "—"}</td>
                <td className="px-3 py-3 text-[#46464a] max-w-[160px] truncate">{it.orgId ? it.orgName ?? "Unbekannt" : "Plattform"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
