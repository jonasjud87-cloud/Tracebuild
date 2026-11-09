"use client";

import { useState, useRef, useEffect } from "react";
import type { Organization, PlanTier } from "./types";

interface Props {
  orgs: Organization[];
  lastActivityMap: Record<string, string | undefined>;
  costMap?: Record<string, number | undefined>;
  onOpen: (org: Organization) => void;
  onEdit: (org: Organization) => void;
  onDelete: (org: Organization) => void;
  onPause: (org: Organization) => void;
  onClose: (org: Organization) => void;
  onArchive: (org: Organization) => void;
  onDetail?: (org: Organization) => void;
}

type KnownPlan = PlanTier | "free" | "pro";

const planMeta: Record<KnownPlan, { label: string; cls: string }> = {
  starter:    { label: "Starter",    cls: "bg-[rgba(21,20,20,0.08)] text-[#46464a]"  },
  free:       { label: "Starter",    cls: "bg-[rgba(21,20,20,0.08)] text-[#46464a]"  },
  business:   { label: "Business",   cls: "bg-[#cbbfae]/30 text-[#46464a]"               },
  pro:        { label: "Business",   cls: "bg-[#cbbfae]/30 text-[#46464a]"               },
  enterprise: { label: "Enterprise", cls: "bg-[#cbbfae]/30 text-[#6b6153]"          },
};

type StatusCfg = { dot: string; label: string; textCls: string };
const statusMeta: Record<string, StatusCfg> = {
  active:   { dot: "bg-[#2f8a5b]", label: "Aktiv",       textCls: "text-[#136a40]" },
  paused:   { dot: "bg-[#b97a0c]",   label: "Pausiert",    textCls: "text-[#7a4f00]"   },
  closed:   { dot: "bg-[#8a8a8a]",   label: "Geschlossen", textCls: "text-[#46464a]"   },
  archived: { dot: "bg-[#5f5e5e]",   label: "Archiviert",  textCls: "text-[#5f5f64]"   },
  inactive: { dot: "bg-[#8a8a8a]",   label: "Inaktiv",     textCls: "text-[#46464a]"   },
};

function getPlanMeta(tier: string): { label: string; cls: string } {
  return planMeta[tier as KnownPlan] ?? planMeta.starter;
}

function formatGB(n: number): string {
  if (n < 1) return `${(n * 1000).toFixed(0)} MB`;
  return `${n.toFixed(1)} GB`;
}

interface MenuPos { top: number; right: number }

function OrgMenu({
  org, pos, onClose: closeMenu,
  onOpen, onEdit, onDelete, onPause, onCloseOrg, onArchive,
}: {
  org: Organization;
  pos: MenuPos;
  onClose: () => void;
  onOpen: (o: Organization) => void;
  onEdit: (o: Organization) => void;
  onDelete: (o: Organization) => void;
  onPause: (o: Organization) => void;
  onCloseOrg: (o: Organization) => void;
  onArchive: (o: Organization) => void;
}) {
  const status = org.status ?? "active";
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vh = window.innerHeight;
    if (rect.bottom > vh - 8) {
      ref.current.style.top = `${pos.top - rect.height}px`;
      ref.current.style.bottom = "auto";
    }
  }, [pos]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
      className="bg-white border border-[rgba(21,20,20,0.08)] rounded-xl shadow-2xl py-1.5 min-w-[172px]"
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={() => { closeMenu(); onOpen(org); }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#151414] hover:bg-[#f6f3ee] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M2 6.5H11M7.5 3L11 6.5L7.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Öffnen
      </button>

      <div className="my-1 h-px bg-[rgba(21,20,20,0.08)]" />

      <button
        onClick={() => { closeMenu(); onEdit(org); }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#151414] hover:bg-[#f6f3ee] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M9 1.5L11.5 4L4.5 11H2V8.5L9 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        Bearbeiten
      </button>

      {status === "active" && (
        <button
          onClick={() => { closeMenu(); onPause(org); }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#7a4f00] hover:bg-[#fff1d6] transition-colors text-left"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="2.5" y="2.5" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="7.5" y="2.5" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          Pausieren
        </button>
      )}

      {status === "paused" && (
        <button
          onClick={() => { closeMenu(); onPause(org); }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#136a40] hover:bg-[#e4f3ea] transition-colors text-left"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M3 2.5L10.5 6.5L3 10.5V2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Reaktivieren
        </button>
      )}

      {status !== "closed" && status !== "archived" && (
        <button
          onClick={() => { closeMenu(); onCloseOrg(org); }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#7a4f00] hover:bg-[#fff1d6] transition-colors text-left"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4.5 4.5L8.5 8.5M8.5 4.5L4.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Schließen
        </button>
      )}

      {status !== "archived" && (
        <button
          onClick={() => { closeMenu(); onArchive(org); }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#46464a] hover:bg-[#f6f3ee] transition-colors text-left"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 4.5H11M2 4.5V10.5H11V4.5M2 4.5V3A.5.5 0 0 1 2.5 2.5H10.5A.5.5 0 0 1 11 3V4.5M5.5 7H7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="italic">Archivieren</span>
        </button>
      )}

      {!org.isDefault && (
        <>
          <div className="my-1 h-px bg-[rgba(21,20,20,0.08)]" />
          <button
            onClick={() => { closeMenu(); onDelete(org); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#a3201a] hover:bg-[#fde7e5] transition-colors text-left"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 3.5H11M4.5 3.5V2.5H8.5V3.5M4 3.5L4.5 11H8.5L9 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Löschen
          </button>
        </>
      )}
    </div>
  );
}

export default function OrgTable({
  orgs, lastActivityMap, costMap,
  onOpen, onEdit, onDelete, onPause, onClose, onArchive, onDetail,
}: Props) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos>({ top: 0, right: 0 });

  function openMenu(id: string, btn: HTMLButtonElement) {
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpenMenuId(id);
  }

  const headers = [
    "Organisation", "Status", "Tarif", "Projekte", "Benutzer",
    "Analysen", "Speicher", "Kosten / Mo.", "Erstellt", "Akt. Aktivität", "",
  ];
  const hideCls = ["", "", "hidden lg:table-cell", "", "", "hidden 2xl:table-cell", "hidden 2xl:table-cell", "", "hidden 2xl:table-cell", "hidden xl:table-cell", ""];

  return (
    <div className="tba-glass tba-glass--flat rounded-2xl overflow-hidden">
      {openMenuId && (
        <div className="fixed inset-0 z-[9998]" onClick={() => setOpenMenuId(null)} />
      )}

      <div className="overflow-x-auto tba-scroll-x">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(21,20,20,0.08)] bg-[#f6f3ee]">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={`py-3.5 text-[13px] font-semibold text-[#46464a] uppercase tracking-wider whitespace-nowrap
                    ${hideCls[i]} ${i === 0 ? "px-4 text-left" : i === headers.length - 1 ? "px-4 w-10" : "px-2.5 text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.map((org, idx) => {
              const initials = org.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
              const { label: planLabel, cls: planCls } = getPlanMeta(org.planTier);
              const status = (org.status ?? "active") as string;
              const sMeta = statusMeta[status] ?? statusMeta["active"];
              const lastAct = lastActivityMap[org.name];
              const created = new Date(org.createdAt).toLocaleDateString("de-CH");
              const isArchived = status === "archived";

              return (
                <tr
                  key={org.id}
                  className={`tba-row transition-colors ${idx < orgs.length - 1 ? "border-b border-[rgba(21,20,20,0.08)]" : ""} ${isArchived ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3 max-w-0 w-[34%]">
                    <button
                      type="button"
                      onClick={() => onDetail?.(org)}
                      className="flex items-center gap-3 text-left w-full group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#cbbfae]/30 flex items-center justify-center flex-shrink-0 group-hover:bg-[#cbbfae]/45 transition-colors">
                        <span className="text-sm font-bold text-[#6b6153]">{initials}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span title={org.name} className={`truncate font-semibold text-[#151414] group-hover:text-[#6b6153] transition-colors ${isArchived ? "line-through" : ""}`}>
                            {org.name}
                          </span>
                          {org.isDefault && (
                            <span className="text-[13px] font-bold text-[#6b6153] bg-[#cbbfae]/30 px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0">
                              Default
                            </span>
                          )}
                        </div>
                        {org.description && (
                          <p className="text-[13px] text-[#46464a] mt-0.5 truncate">
                            {org.description}
                          </p>
                        )}
                      </div>
                    </button>
                  </td>

                  <td className="px-2.5 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap ${sMeta.textCls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sMeta.dot}`} />
                      {sMeta.label}
                    </span>
                  </td>

                  <td className="hidden lg:table-cell px-2.5 py-3 text-right">
                    <span className={`inline-block text-[13px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${planCls}`}>
                      {planLabel}
                    </span>
                  </td>

                  <td className="px-2.5 py-3 text-[#46464a] text-right tabular-nums">
                    {org.projectCount ?? <span className="text-[#5f5f64]">—</span>}
                  </td>

                  <td className="px-2.5 py-3 text-[#46464a] text-right tabular-nums">
                    {org.userCount ?? <span className="text-[#5f5f64]">—</span>}
                  </td>

                  <td className="hidden 2xl:table-cell px-2.5 py-3 text-[#46464a] text-right tabular-nums">
                    {org.analyseCount ?? <span className="text-[#5f5f64]">—</span>}
                  </td>

                  <td className="hidden 2xl:table-cell px-2.5 py-3 text-[#46464a] text-right tabular-nums whitespace-nowrap">
                    {org.storageGB !== undefined ? formatGB(org.storageGB) : <span className="text-[#5f5f64]">—</span>}
                  </td>

                  <td className="px-2.5 py-3 text-right tabular-nums">
                    {costMap?.[org.id] !== undefined
                      ? <span className="font-medium text-[#151414]">CHF {(costMap[org.id] as number).toFixed(2)}</span>
                      : <span className="text-[#5f5f64]">—</span>}
                  </td>

                  <td className="hidden 2xl:table-cell px-2.5 py-3 text-[#46464a] tabular-nums whitespace-nowrap">{created}</td>

                  <td className="hidden xl:table-cell px-2.5 py-3 text-[#46464a] whitespace-nowrap">
                    {lastAct ?? created}
                  </td>

                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (openMenuId === org.id) { setOpenMenuId(null); }
                        else { openMenu(org.id, e.currentTarget as HTMLButtonElement); }
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-[#5f5f64] hover:text-[#151414] hover:bg-[#f6f3ee] transition-colors"
                      title="Aktionen"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="2.5"  r="1.2" fill="currentColor" />
                        <circle cx="7" cy="7"    r="1.2" fill="currentColor" />
                        <circle cx="7" cy="11.5" r="1.2" fill="currentColor" />
                      </svg>
                    </button>

                    {openMenuId === org.id && (
                      <OrgMenu
                        org={org}
                        pos={menuPos}
                        onClose={() => setOpenMenuId(null)}
                        onOpen={onOpen}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onPause={onPause}
                        onCloseOrg={onClose}
                        onArchive={onArchive}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
