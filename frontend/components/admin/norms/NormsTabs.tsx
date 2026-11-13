"use client";

import AdminTabs, { adminPanelId, adminTabId } from "@/components/admin/shell/AdminTabs";
import { NORMS_TABS, type NormsTab } from "./norms-tabs";

interface Props {
  active: NormsTab;
  onChange: (tab: NormsTab) => void;
  badges?: Partial<Record<NormsTab, number>>;
}

export function tabId(tab: NormsTab): string {
  return adminTabId("norms", tab);
}

export function panelId(tab: NormsTab): string {
  return adminPanelId("norms", tab);
}

export default function NormsTabs({ active, onChange, badges }: Props) {
  return <AdminTabs tabs={NORMS_TABS} active={active} onChange={onChange} prefix="norms" label="Normen-Bereiche" badges={badges} />;
}
