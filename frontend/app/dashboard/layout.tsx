"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import DashboardFrame from "@/components/dashboard/DashboardFrame";
import { DashboardContext, type Activity, type OrgInfo, type Project } from "@/lib/dashboardContext";

interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  org_id: string;
  role: string;
  org: OrgInfo | null;
}

const LIVIO_JONAS_EMAILS = new Set([
  "livio.thoma07@gmail.com",
  "jonasjud87@gmail.com",
]);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [email, setEmail]           = useState("");
  const [userName, setUserName]     = useState("");
  const [role, setRole]             = useState("");
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [activeOrg, setActiveOrg]   = useState<OrgInfo | null>(null);

  const [projects, setProjects]               = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading]  = useState(true);
  const [analysesCount, setAnalysesCount]      = useState<number | null>(null);
  const [failCount, setFailCount]              = useState<number | null>(null);
  const [okPct, setOkPct]                      = useState<number | null>(null);
  const [activities, setActivities]            = useState<Activity[]>([]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function reloadProjects() {
    try {
      const data = await api.get<Project[]>("/projects");
      setProjects(data ?? []);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadStats() {
    try {
      const res = await fetch("/api/v1/dashboard/stats");
      if (!res.ok) return;
      const json = await res.json();
      const s = json.data;
      setAnalysesCount(s.analyses_count);
      setFailCount(s.fail_count);
      setOkPct(s.ok_pct);
      setActivities(s.activities ?? []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.push("/login"); return; }
      const emailVal = data.user.email ?? "";
      setEmail(emailVal);

      const res = await fetch("/api/v1/auth/me");
      if (res.ok) {
        const json = await res.json() as { data: MeResponse };
        const me = json.data;
        setUserName(me.name ?? "");
        setRole(me.role);
        setActiveOrg(me.org);
        setIsSuperAdmin(me.role === "super_admin");
        setIsOrgAdmin(me.role === "super_admin" || me.role === "org_admin");
      }
    });
    reloadProjects();
    loadStats();
  }, [router]);

  return (
    <DashboardContext.Provider value={{
      email, userName, setUserName, activeOrg, isOrgAdmin, isSuperAdmin, role,
      projects, projectsLoading, reloadProjects,
      analysesCount, failCount, okPct, activities,
    }}>
      <DashboardFrame
        pathname={pathname ?? ""}
        email={email}
        userName={userName}
        role={role}
        activeOrg={activeOrg}
        isOrgAdmin={isOrgAdmin}
        showAdminBanner={isSuperAdmin && !!activeOrg && LIVIO_JONAS_EMAILS.has(email)}
        onLogout={handleLogout}
      >
        {children}
      </DashboardFrame>
    </DashboardContext.Provider>
  );
}
