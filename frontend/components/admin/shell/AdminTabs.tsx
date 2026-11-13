"use client";

import { useRef } from "react";
import { nextTab, type TabDef } from "@/lib/admin-tabs";

interface Props<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (tab: T) => void;
  prefix: string;
  label: string;
  badges?: Partial<Record<T, number>>;
}

export function adminTabId(prefix: string, tab: string): string {
  return `${prefix}-tab-${tab}`;
}

export function adminPanelId(prefix: string, tab: string): string {
  return `${prefix}-panel-${tab}`;
}

export default function AdminTabs<T extends string>({ tabs, active, onChange, prefix, label, badges = {} }: Props<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (direction: 1 | -1) => {
    const next = nextTab(tabs, active, direction);
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2 border-b border-[rgba(21,20,20,.12)] pb-3">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const badge = badges[tab.id] ?? 0;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            id={adminTabId(prefix, tab.id)}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={adminPanelId(prefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            title={tab.hint}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                move(-1);
              }
            }}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151414] ${
              selected ? "bg-[#151414] text-white" : "border border-[#8c8b8e] bg-white text-[#151414] hover:border-[#151414]"
            }`}
          >
            {tab.label}
            {badge > 0 && (
              <span
                className={`min-w-[20px] rounded-full px-1.5 text-center text-[13px] font-bold leading-5 ${
                  selected ? "bg-[#D6A45F] text-[#151414]" : "bg-[#D6A45F]/30 text-[#7a4f00]"
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
