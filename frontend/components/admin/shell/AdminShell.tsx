"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AlertBell from "@/components/admin/AlertBell";
import GlobalSearch from "@/components/admin/GlobalSearch";
import SidebarNav from "@/components/admin/shell/SidebarNav";
import LogoMark from "@/components/admin/shell/LogoMark";
import "@/components/admin/shell/admin-theme.css";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AdminShell({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const skipRestore = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      asideRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      if (skipRestore.current) skipRestore.current = false;
      else menuButtonRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    function onChange(e: MediaQueryListEvent) {
      if (e.matches) {
        if (wasOpen.current) skipRestore.current = true;
        setOpen(false);
      }
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function trapTab(e: KeyboardEvent<HTMLElement>) {
    if (!open || e.key !== "Tab" || !asideRef.current) return;
    const items = Array.from(asideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="tba tba-canvas">
      <a
        href="#admin-main"
        onClick={e => {
          e.preventDefault();
          mainRef.current?.focus();
          mainRef.current?.scrollIntoView();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-[#151414] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Zum Inhalt springen
      </a>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-[rgba(21,20,20,.55)] backdrop-blur-[2px] lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <header className="tba-topbar tba-onblack fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b border-[rgba(255,255,255,.1)] px-3 sm:px-5">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label="Navigation öffnen"
          aria-expanded={open}
          aria-controls="admin-sidebar"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/30 text-white/90 hover:bg-white/10 hover:text-white lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <Link
          href="/admin"
          onClick={close}
          aria-label="Zum Admin-Dashboard"
          className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 lg:ml-1"
        >
          <LogoMark className="h-8 w-[23px] flex-shrink-0" />
          <span className="tba-brand truncate">TraceBuild</span>
          <span className="tba-admin-pill hidden items-center rounded-full px-2.5 py-0.5 text-[13px] font-bold uppercase tracking-wider sm:inline-flex">
            Admin
          </span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
          <GlobalSearch />
          <AlertBell />

          {userEmail && (
            <Link
              href="/dashboard/profile"
              title="Profil bearbeiten"
              aria-label="Profil bearbeiten"
              className="flex items-center gap-2 rounded-full p-0.5 tba-profile-link transition-colors sm:pr-2"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#cbbfae] text-[13px] font-bold text-[#151414]">
                {userEmail.charAt(0).toUpperCase()}
              </span>
              <span className="hidden max-w-[12rem] truncate text-sm text-white md:inline">{userEmail}</span>
            </Link>
          )}

          <button
            type="button"
            onClick={handleLogout}
            aria-label="Abmelden"
            className="flex h-9 items-center gap-1.5 rounded-full border border-white/40 px-2.5 text-sm text-white transition-colors hover:border-[#cbbfae] hover:bg-white/10 sm:px-3.5"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path
                d="M5 2H2.5A1 1 0 0 0 1.5 3v7a1 1 0 0 0 1 1H5M8.5 9.5L11.5 6.5M11.5 6.5L8.5 3.5M11.5 6.5H5"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
            <span className="hidden sm:inline">Abmelden</span>
          </button>
        </div>
      </header>

      <aside
        ref={asideRef}
        id="admin-sidebar"
        onKeyDown={trapTab}
        role={open ? "dialog" : undefined}
        aria-modal={open ? "true" : undefined}
        aria-label={open ? "Admin-Navigation" : undefined}
        className={`tba-onblack fixed bottom-0 left-0 top-0 z-[55] flex w-[270px] max-w-[85vw] flex-col border-r border-white/10 bg-[#151414] transition-transform duration-200 motion-reduce:transition-none lg:top-14 lg:z-40 lg:visible lg:translate-x-0 lg:border-r-0 ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex h-14 flex-shrink-0 items-center justify-between gap-2 px-4 lg:hidden">
          <span className="text-sm font-semibold text-white">Navigation</span>
          <button
            type="button"
            onClick={close}
            aria-label="Navigation schliessen"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/85 hover:bg-white/10 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 lg:pt-5">
          <Suspense fallback={<nav aria-label="Admin-Navigation" />}>
            <SidebarNav onNavigate={close} />
          </Suspense>
        </div>
      </aside>

      <div className="min-w-0 pt-14 lg:pl-[270px]">
        <main
          id="admin-main"
          ref={mainRef}
          tabIndex={-1}
          className="tba-panel min-h-[calc(100vh-3.5rem)] px-[clamp(16px,3vw,40px)] py-6 focus:outline-none lg:py-6"
        >
          <div className="mx-auto w-full max-w-[1680px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
