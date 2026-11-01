"use client";

import { createContext, useContext } from "react";

export interface Project {
  id: string;
  name: string;
  domain: string;
  location: { canton: string; municipality: string };
  status: string;
  created_at: string;
}

export interface OrgInfo { id: string; name: string; slug: string }

export interface Activity { text: string; time: string; status: string }

export interface DashboardContextValue {
  email: string;
  userName: string;
  setUserName: (name: string) => void;
  activeOrg: OrgInfo | null;
  isOrgAdmin: boolean;
  isSuperAdmin: boolean;
  projects: Project[];
  projectsLoading: boolean;
  reloadProjects: () => Promise<void>;
  analysesCount: number | null;
  failCount: number | null;
  okPct: number | null;
  activities: Activity[];
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within the dashboard layout");
  return ctx;
}
