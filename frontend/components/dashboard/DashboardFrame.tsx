"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { jakarta as font } from "@/lib/fonts";
import { roleLabel } from "@/lib/roles";
import type { OrgInfo } from "@/lib/dashboardContext";
import AnnouncementBanner from "@/components/announcements/AnnouncementBanner";
import DashboardBackdrop from "@/components/dashboard/DashboardBackdrop";
import { BookIcon, CloseIcon, HomeIcon, LayersIcon, LogoutIcon, MenuIcon, UsersIcon } from "@/components/dashboard/icons";
import s from "@/app/dashboard/dashboard.module.css";

export interface DashboardFrameProps {
  pathname: string;
  email: string;
  userName: string;
  role: string;
  activeOrg: OrgInfo | null;
  isOrgAdmin: boolean;
  showAdminBanner: boolean;
  onLogout: () => void;
  children: React.ReactNode;
}

function initialsOf(userName: string, email: string): string {
  const parts = userName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] ?? email).trim().slice(0, 1).toUpperCase();
}

function NavItem({ href, active, icon, label, onNavigate }: { href: string; active: boolean; icon: React.ReactNode; label: string; onNavigate: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${s.navLink} ${active ? s.navActive : ""}`}>
      {icon}
      {label}
    </Link>
  );
}

function Brand({ onNavigate, className, priority }: { onNavigate: () => void; className?: string; priority?: boolean }) {
  return (
    <Link href="/dashboard" className={`${s.brand} ${className ?? ""}`} onClick={onNavigate} aria-label="TraceBuild Übersicht">
      <Image src="/landing/logo-mark.svg" alt="" width={28} height={40} className={s.brandMark} priority={priority} />
      <span className={s.wordmark} aria-hidden="true">Trace<span>Build</span></span>
    </Link>
  );
}

export default function DashboardFrame({ pathname, email, userName, role, activeOrg, isOrgAdmin, showAdminBanner, onLogout, children }: DashboardFrameProps) {
  const [open, setOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const orgName = activeOrg?.name ?? "Organisation";
  const isProjectsPage = pathname.startsWith("/dashboard/projects");
  const isProfilePage = pathname.startsWith("/dashboard/profile");
  const close = () => setOpen(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const onChange = () => { if (!mq.matches) setOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const main = mainRef.current;
    if (open) {
      if (main && mq.matches) main.inert = true;
      document.body.style.overflow = "hidden";
      sidebarRef.current?.querySelector<HTMLElement>("nav a")?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      if (mq.matches) menuBtnRef.current?.focus();
    }
    return () => {
      if (main) main.inert = false;
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`${font.variable} ${s.shell}`}>
      <div className={s.mobileBar}>
        <Brand onNavigate={close} />
        <button ref={menuBtnRef} type="button" className={s.menuBtn} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="dash-sidebar" aria-label={open ? "Menü schliessen" : "Menü öffnen"}>
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>
      {open && <button type="button" className={s.scrim} onClick={close} aria-label="Menü schliessen" tabIndex={-1} />}

      <aside id="dash-sidebar" ref={sidebarRef} aria-label="Seitenleiste" className={`${s.sidebar} ${open ? s.sidebarOpen : ""}`}>
        <Brand onNavigate={close} className={s.deskBrand} priority />

        {activeOrg && (
          <>
            <p className={s.orgCaption}>Organisation</p>
            <div className={s.orgBox}>
              <span>{orgName}</span>
            </div>
          </>
        )}

        <nav className={s.nav} aria-label="Hauptnavigation">
          <NavItem href="/dashboard" active={!isProjectsPage && !isProfilePage} icon={<HomeIcon />} label="Übersicht" onNavigate={close} />
          <NavItem href="/dashboard/projects" active={isProjectsPage} icon={<LayersIcon />} label="Projekte" onNavigate={close} />
          <NavItem href="/standards" active={false} icon={<BookIcon />} label="Normen-DB" onNavigate={close} />
          {isOrgAdmin && <NavItem href="/admin/org" active={false} icon={<UsersIcon />} label="Organisation" onNavigate={close} />}
        </nav>

        <div className={s.sideFoot}>
          <Link href="/dashboard/profile" title="Profil bearbeiten" onClick={close} aria-current={isProfilePage ? "page" : undefined} className={`${s.userBlock} ${isProfilePage ? s.userActive : ""}`}>
            <span className={s.avatar} aria-hidden="true">{initialsOf(userName, email)}</span>
            <span className={s.userText}>
              {userName && <span className={s.userName}>{userName}</span>}
              <span className={s.userMail}>{email}</span>
              {role && <span className={s.roleChip}>{roleLabel(role)}</span>}
            </span>
          </Link>
          <button type="button" className={s.logout} onClick={onLogout}>
            <LogoutIcon />
            Abmelden
          </button>
        </div>
      </aside>

      <div ref={mainRef} className={s.main}>
        <DashboardBackdrop />
        <div className={s.content}>
          {showAdminBanner && (
            <div className={s.banner}>
              <span className={s.bannerLeft}>
                <span className={s.bannerChip}>Admin</span>
                <span>Aktive Organisation: <span className={s.bannerOrg}>{orgName}</span></span>
              </span>
              <Link href="/admin" className={s.bannerLink}>← Zur Adminübersicht</Link>
            </div>
          )}
          <main className={s.pad}>
            <AnnouncementBanner />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
