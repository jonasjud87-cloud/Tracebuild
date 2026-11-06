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

const TH = "py-3.5 px-4 text-[11px] font-semibold text-[#A7AFBA] uppercase tracking-wider text-left whitespace-nowrap";

export default function AuditTable({ items }: { items: AuditItem[] }) {
  return (
    <div className="tba-glass tba-glass--flat rounded-2xl overflow-hidden">
      <div className="overflow-x-auto tba-scroll-x">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.08)] bg-[rgba(17,27,43,0.5)]">
              <th className={TH}>Zeit</th>
              <th className={TH}>Akteur</th>
              <th className={TH}>Aktion</th>
              <th className={TH}>Ziel</th>
              <th className={TH}>Organisation</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className="hover:bg-[#223247]/60 transition-colors border-b border-[rgba(255,255,255,0.08)] last:border-0">
                <td className="px-4 py-3 text-[#A7AFBA] whitespace-nowrap tabular-nums">{fmtTime(it.createdAt)}</td>
                <td className="px-4 py-3 text-white break-all">{it.actorEmail}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F0C99A]/10 text-[#F0C99A]" title={it.action}>
                    {actionLabel(it.action, it.meta)}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#A7AFBA] break-all">{it.targetEmail ?? "—"}</td>
                <td className="px-4 py-3 text-[#A7AFBA]">{it.orgId ? it.orgName ?? "Unbekannt" : "Plattform"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
