import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { jakarta as font } from "@/lib/fonts";
import p from "@/app/projects/project.module.css";

const BACKDROP_PHOTO = "/landing/dashboard-building.jpg";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  analysis: <Svg><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M3.5 10h8.5v10.5M12 13.5h8.5" /></Svg>,
  norms: <Svg><rect x="5" y="3.5" width="14" height="17" rx="3" /><circle cx="12" cy="10" r="2.2" /><path d="M8.5 16c.6-1.5 1.8-2.2 3.5-2.2s2.9.7 3.5 2.2" /></Svg>,
  chat: <Svg><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" /><path d="M8.5 10h.01M12 10h.01M15.5 10h.01" /></Svg>,
  settings: <Svg><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /></Svg>,
  normenblatt: <Svg><rect x="4.5" y="3.5" width="15" height="17" rx="3" /><path d="M8 9h8M8 13h8M8 17h4" /></Svg>,
};

export function projectTabs(id: string) {
  return [
    { key: "analysis", href: `/projects/${id}/analysis`, label: "Plan-Analyse" },
    { key: "norms", href: `/projects/${id}/norms`, label: "Normen" },
    { key: "chat", href: `/projects/${id}/chat`, label: "KI Chat" },
    { key: "settings", href: `/projects/${id}/settings`, label: "Einstellungen" },
    { key: "normenblatt", href: `/projects/${id}/normenblatt`, label: "Normenblatt" },
  ];
}

export interface ProjectFrameProps {
  projectId: string;
  pathname: string;
  announcements?: ReactNode;
  children: ReactNode;
}

export default function ProjectFrame({ projectId, pathname, announcements, children }: ProjectFrameProps) {
  const tabs = projectTabs(projectId);
  return (
    <div className={`${font.variable} ${p.shell}`}>
      <div className={p.backdrop} aria-hidden="true">
        <div className={p.glowA} />
        <div className={p.glowB} />
        <div className={p.glowC} />
        <div className={p.arch}>
          <div className={p.photo} style={{ backgroundImage: `url(${BACKDROP_PHOTO})` }} />
        </div>
      </div>

      <header className={p.topbar}>
        <Link href="/dashboard" className={p.logoLink} aria-label="TraceBuild Übersicht">
          <Image src="/landing/logo-tb.svg" alt="" width={24} height={34} className={p.logoMark} priority />
          <span className={p.wordmark} aria-hidden="true">TraceBuild</span>
        </Link>
        <Link href="/dashboard/projects" className={p.backLink}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          Projekte
        </Link>
        <span className={p.topSpacer} />
        <Link href="/dashboard/profile" className={p.avatar} aria-label="Profil">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></svg>
        </Link>
      </header>

      <nav className={p.tabs} aria-label="Projektbereiche">
        <div className={p.tabList}>
          {tabs.map((tab) => {
            const active = pathname.startsWith(tab.href);
            return (
              <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} className={`${p.tab} ${active ? p.tabActive : ""}`}>
                {ICONS[tab.key]}
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className={p.content}>
        {announcements}
        {children}
      </main>
    </div>
  );
}
