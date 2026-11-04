"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AlertBell from "@/components/admin/AlertBell";
import GlobalSearch from "@/components/admin/GlobalSearch";
import SidebarNav from "@/components/admin/shell/SidebarNav";

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
    <div className="min-h-screen">
      <a
        href="#admin-main"
        onClick={e => {
          e.preventDefault();
          mainRef.current?.focus();
          mainRef.current?.scrollIntoView();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-[#2862D7] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:outline-none focus:ring-2 focus:ring-[#85A6E9]"
      >
        Zum Inhalt springen
      </a>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        ref={asideRef}
        id="admin-sidebar"
        onKeyDown={trapTab}
        role={open ? "dialog" : undefined}
        aria-modal={open ? "true" : undefined}
        aria-label={open ? "Admin-Navigation" : undefined}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#0E111B] border-r border-[rgba(60,63,68,0.5)] transition-transform duration-200 motion-reduce:transition-none lg:visible lg:translate-x-0 ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex h-16 flex-shrink-0 items-center justify-between gap-2 px-4">
          <Link
            href="/admin"
            onClick={close}
            aria-label="Zum Admin-Dashboard"
            className="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]"
          >
            <Image
              src="/Logo-new.png"
              alt="TraceBuild"
              width={533}
              height={400}
              className="h-8 w-auto object-contain"
              priority
            />
            <span className="inline-flex items-center rounded-md bg-[#2862D7]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#85A6E9]">
              Admin
            </span>
          </Link>
          <button
            type="button"
            onClick={close}
            aria-label="Navigation schliessen"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#ABAEBB] hover:bg-[#172540] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9] lg:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <Suspense fallback={<nav aria-label="Admin-Navigation" />}>
            <SidebarNav onNavigate={close} />
          </Suspense>
        </div>
      </aside>

      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-30 lg:z-50 flex h-16 items-center justify-between gap-2 border-b border-[rgba(60,63,68,0.5)] bg-[#0E111B] px-4 sm:px-6">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-label="Navigation öffnen"
            aria-expanded={open}
            aria-controls="admin-sidebar"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[rgba(60,63,68,0.5)] text-[#ABAEBB] hover:bg-[#172540] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9] lg:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <GlobalSearch />
            <AlertBell />

            <div className="hidden h-5 w-px bg-[rgba(60,63,68,0.6)] sm:block" />

            {userEmail && (
              <Link
                href="/dashboard/profile"
                title="Profil bearbeiten"
                aria-label="Profil bearbeiten"
                className="flex items-center gap-2 rounded-xl px-1 py-1 transition-colors hover:bg-[#1E2D4A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9] sm:px-2"
              >
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#2862D7]/15">
                  <span className="text-[10px] font-bold text-[#85A6E9]">
                    {userEmail.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="hidden max-w-[12rem] truncate text-sm text-[#ABAEBB] sm:inline">{userEmail}</span>
              </Link>
            )}

            <button
              type="button"
              onClick={handleLogout}
              aria-label="Abmelden"
              className="flex items-center gap-1.5 rounded-xl border border-[rgba(60,63,68,0.5)] px-2.5 py-2 text-sm text-[#ABAEBB] transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9] sm:px-3.5"
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

        <main id="admin-main" ref={mainRef} tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 focus:outline-none sm:px-6">{children}</main>
      </div>
    </div>
  );
}
