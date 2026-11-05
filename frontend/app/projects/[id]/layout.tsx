"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import TraceBuildLogo from "@/components/landing/TraceBuildLogo";
import { OerebSyncProvider, OerebSyncStatus } from "@/components/useOerebDocumentSync";

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const pathname = usePathname();

  const tabs = [
    { href: `/projects/${params.id}/analysis`,  label: "Plan-Analyse" },
    { href: `/projects/${params.id}/norms`,      label: "Normen" },
    { href: `/projects/${params.id}/chat`,       label: "KI Chat" },
    { href: `/projects/${params.id}/settings`,   label: "Einstellungen" },
    { href: `/projects/${params.id}/normenblatt`, label: "Normenblatt" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(120% 90% at 50% -10%,#182541 0%,#0A0E17 55%)", fontFamily: "inherit" }}>
      <header style={{
        background: "rgba(10,14,23,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(133,166,233,0.12)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 14, paddingBottom: 6 }}>
            <Link
              href="/dashboard/projects"
              style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", opacity: 1, transition: "opacity .15s" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.7"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}
            >
              <TraceBuildLogo size="sm" />
              <span style={{ fontSize: 13, color: "#7B8299" }}>← Projekte</span>
            </Link>
          </div>
          <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
            {tabs.map((tab) => {
              const active = pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  style={{
                    padding: "10px 16px",
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    color: active ? "#85A6E9" : "#7B8299",
                    borderBottom: `2px solid ${active ? "#2862D7" : "transparent"}`,
                    transition: "color .15s, border-color .15s",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#ABAEBB"; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#7B8299"; }}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>
      </header>
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 24px" }}>
        {/* Im Layout, damit der Import pro Projekt nur einmal läuft und Reiterwechsel überlebt. */}
        <OerebSyncProvider projectId={params.id}>
          <OerebSyncStatus projectId={params.id} />
          {children}
        </OerebSyncProvider>
      </main>
    </div>
  );
}
