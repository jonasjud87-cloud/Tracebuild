"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { roleLabel } from "@/lib/roles";
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

function NavLink({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      style={active
        ? { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, background: "linear-gradient(90deg,#2862D7,#3470E8)", color: "#fff", fontSize: 14, fontWeight: 600, textDecoration: "none" }
        : { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, color: "#7B8299", fontSize: 14, fontWeight: 500, textDecoration: "none", transition: "all .15s" }
      }
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.08)"; (e.currentTarget as HTMLElement).style.color = "#fff"; } }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = "#7B8299"; } }}
    >
      {icon}
      {label}
    </Link>
  );
}

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

  const orgName = activeOrg?.name ?? "Organisation";
  const userInitial = (userName || email).charAt(0).toUpperCase();
  const isProjectsPage = pathname?.startsWith("/dashboard/projects") ?? false;
  const isProfilePage = pathname?.startsWith("/dashboard/profile") ?? false;

  return (
    <DashboardContext.Provider value={{
      email, userName, setUserName, activeOrg, isOrgAdmin, isSuperAdmin, role,
      projects, projectsLoading, reloadProjects,
      analysesCount, failCount, okPct, activities,
    }}>
      <div style={{ minHeight: "100vh", background: "radial-gradient(120% 90% at 50% -10%,#182541 0%,#0A0E17 55%)", display: "flex", fontFamily: "'Inter',Arial,Helvetica,sans-serif", color: "#ABAEBB" }}>

        {/* Sidebar */}
        <aside style={{ width: 232, flexShrink: 0, background: "rgba(14,17,27,0.85)", borderRight: "1px solid rgba(133,166,233,0.12)", display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0 }}>
          <Link href="/dashboard" style={{ padding: "22px 20px 18px", borderBottom: "1px solid rgba(133,166,233,0.1)", display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
            <Image src="/Logo-new.png" alt="TraceBuild" width={533} height={400} style={{ height: 30, width: "auto", objectFit: "contain" }} />
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em", color: "#fff" }}>
              Trace<span style={{ color: "#2862D7" }}>Build</span>
            </span>
          </Link>

          {activeOrg && (
            <div style={{ margin: "16px 16px 8px", padding: "14px 16px", borderRadius: 14, background: "rgba(40,98,215,0.08)", border: "1px solid rgba(133,166,233,0.15)" }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: "#85A6E9", textTransform: "uppercase", letterSpacing: "0.12em", margin: 0 }}>Organisation</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "3px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{orgName}</p>
            </div>
          )}

          <nav style={{ flex: 1, padding: "8px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
            <NavLink
              href="/dashboard"
              active={!isProjectsPage && !isProfilePage}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h4v8H3v-8zm7-9h4v17h-4V4zm7 5h4v12h-4V9z" /></svg>}
              label="Übersicht"
            />
            <NavLink
              href="/dashboard/projects"
              active={isProjectsPage}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7h18M3 12h18M3 17h18" /></svg>}
              label="Projekte"
            />
            <NavLink
              href="/standards"
              active={false}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
              label="Normen-DB"
            />

            {isOrgAdmin && (
              <Link href="/admin/org" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, color: "#7B8299", fontSize: 14, fontWeight: 500, textDecoration: "none", marginTop: 10, borderTop: "1px solid rgba(133,166,233,0.1)", paddingTop: 16, transition: "all .15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.08)"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = "#7B8299"; }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                Organisation
              </Link>
            )}
          </nav>

          <div style={{ padding: 16, borderTop: "1px solid rgba(133,166,233,0.1)" }}>
            <Link href="/dashboard/profile" title="Profil bearbeiten"
              style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "8px 10px", borderRadius: 10, textDecoration: "none", background: isProfilePage ? "rgba(133,166,233,0.1)" : "none", transition: "background .15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.08)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isProfilePage ? "rgba(133,166,233,0.1)" : "none"; }}
            >
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(40,98,215,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#85A6E9" }}>{userInitial}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                {userName && <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0, overflowWrap: "anywhere" }}>{userName}</p>}
                <p style={{ fontSize: 12, color: "#7B8299", margin: 0, overflowWrap: "anywhere" }}>{email}</p>
                {role && (
                  <span style={{ display: "inline-block", marginTop: 5, fontSize: 10, fontWeight: 700, color: "#85A6E9", background: "rgba(40,98,215,0.12)", padding: "2px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {roleLabel(role)}
                  </span>
                )}
              </div>
            </Link>
            <button onClick={handleLogout} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, color: "#7B8299", fontSize: 13, fontWeight: 500, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", transition: "background .15s, color .15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.08)"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = "#7B8299"; }}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              Abmelden
            </button>
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, overflow: "auto", position: "relative" }}>

          {/* Admin banner */}
          {isSuperAdmin && activeOrg && LIVIO_JONAS_EMAILS.has(email) && (
            <div style={{ background: "rgba(23,37,64,0.5)", color: "#7B8299", padding: "10px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, fontWeight: 500, borderBottom: "1px solid rgba(133,166,233,0.12)", position: "relative", zIndex: 1 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#85A6E9", background: "rgba(40,98,215,0.12)", padding: "2px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Admin</span>
                <span>Aktive Organisation: <span style={{ color: "#fff", fontWeight: 700 }}>{orgName}</span></span>
              </span>
              <Link href="/admin" style={{ color: "#85A6E9", fontSize: 12, fontWeight: 600, textDecoration: "none", transition: "color .15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#fff"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#85A6E9"; }}
              >
                ← Zur Adminübersicht
              </Link>
            </div>
          )}

          {/* Decorative starfield glow */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 480, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
            <div style={{ position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)", width: 820, height: 480, background: "radial-gradient(closest-side,rgba(56,189,248,0.14),transparent 70%)" }} />
            <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(133,166,233,0.35) 1px,transparent 1px)", backgroundSize: "34px 34px", opacity: 0.25, maskImage: "radial-gradient(closest-side,black,transparent 75%)", WebkitMaskImage: "radial-gradient(closest-side,black,transparent 75%)" }} />
          </div>

          <div style={{ padding: "40px 48px 64px", maxWidth: 1080, position: "relative", zIndex: 1 }}>
            {children}
          </div>
        </main>
      </div>
    </DashboardContext.Provider>
  );
}
