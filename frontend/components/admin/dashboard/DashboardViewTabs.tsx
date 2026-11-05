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
