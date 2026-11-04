"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

export type DashboardView = "Alle" | "Betrieb" | "Finanzen" | "Support";

export const DASHBOARD_VIEWS: DashboardView[] = ["Alle", "Betrieb", "Finanzen", "Support"];
export const DEFAULT_VIEW: DashboardView = "Betrieb";
export const VIEW_STORAGE_KEY = "tb_admin_view";

export type DashboardItem =
  | "kpi-orgs" | "kpi-active" | "kpi-projects" | "kpi-users"
  | "kpi-analyses" | "kpi-cost" | "kpi-avg" | "kpi-storage" | "kpi-invites"
  | "quick" | "quick-invite" | "costoverview" | "orgs" | "users" | "costs"
  | "activity" | "status" | "invoices";

const VIEW_ITEMS: Record<Exclude<DashboardView, "Alle">, DashboardItem[]> = {
  Betrieb: ["kpi-orgs", "kpi-active", "kpi-projects", "kpi-users", "quick", "orgs", "users", "status", "activity"],
  Finanzen: ["kpi-analyses", "kpi-cost", "kpi-avg", "kpi-storage", "costoverview", "costs", "invoices"],
  Support: ["kpi-users", "kpi-invites", "kpi-active", "quick-invite", "users", "activity"],
};

const SUPPORT_ONLY: DashboardItem[] = ["kpi-invites", "quick-invite"];

export function isDashboardView(v: unknown): v is DashboardView {
  return typeof v === "string" && (DASHBOARD_VIEWS as string[]).includes(v);
}

export function isVisible(view: DashboardView, item: DashboardItem): boolean {
  if (view === "Alle") return !SUPPORT_ONLY.includes(item);
  return VIEW_ITEMS[view].includes(item);
}

export function viewShowing(item: DashboardItem): DashboardView {
  return DASHBOARD_VIEWS.find(v => v !== "Alle" && isVisible(v, item)) ?? "Alle";
}

export default function DashboardViewTabs({
  view, onChange,
}: {
  view: DashboardView;
  onChange: (v: DashboardView) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % DASHBOARD_VIEWS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + DASHBOARD_VIEWS.length) % DASHBOARD_VIEWS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = DASHBOARD_VIEWS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = DASHBOARD_VIEWS[next];
    onChange(target);
    refs.current[target]?.focus();
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div
        role="tablist"
        aria-label="Dashboard-Ansicht"
        className="inline-flex gap-1 bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl p-1 min-w-max"
      >
        {DASHBOARD_VIEWS.map((v, i) => {
          const selected = v === view;
          return (
            <button
              key={v}
              ref={el => { refs.current[v] = el; }}
              type="button"
              role="tab"
              id={`tb-view-tab-${v}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(v)}
              onKeyDown={e => onKeyDown(e, i)}
              className={`px-4 py-2 text-sm font-semibold rounded-xl whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9] ${
                selected
                  ? "bg-[#2862D7] text-white shadow-sm shadow-[#2862D7]/25"
                  : "text-[#7B8299] hover:text-white hover:bg-[#1E2D4A]"
              }`}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}
