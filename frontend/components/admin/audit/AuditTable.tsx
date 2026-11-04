"use client";

import { ACTION_LABELS } from "./types";
import type { AuditItem } from "./types";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("de-CH", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const TH = "py-3.5 px-4 text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider text-left whitespace-nowrap";

export default function AuditTable({ items }: { items: AuditItem[] }) {
  return (
    <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-[rgba(60,63,68,0.4)] bg-[rgba(23,37,64,0.5)]">
              <th className={TH}>Zeit</th>
              <th className={TH}>Akteur</th>
              <th className={TH}>Aktion</th>
              <th className={TH}>Ziel</th>
              <th className={TH}>Organisation</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className="hover:bg-[#1E2D4A]/60 transition-colors border-b border-[rgba(60,63,68,0.3)] last:border-0">
                <td className="px-4 py-3 text-[#ABAEBB] whitespace-nowrap tabular-nums">{fmtTime(it.createdAt)}</td>
                <td className="px-4 py-3 text-white break-all">{it.actorEmail}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#2862D7]/10 text-[#85A6E9]" title={it.action}>
                    {ACTION_LABELS[it.action] ?? it.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#ABAEBB] break-all">{it.targetEmail ?? "—"}</td>
                <td className="px-4 py-3 text-[#ABAEBB]">{it.orgId ? it.orgName ?? "Unbekannt" : "Plattform"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
