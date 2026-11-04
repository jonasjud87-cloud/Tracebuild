"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AlertBell from "@/components/admin/AlertBell";
import GlobalSearch from "@/components/admin/GlobalSearch";

export default function AdminNav({ userEmail }: { userEmail: string }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 bg-[#0E111B] border-b border-[rgba(60,63,68,0.5)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-2">

        {/* Logo + Admin badge */}
        <Link
          href="/admin"
          aria-label="Zum Admin-Dashboard"
          className="flex items-center gap-2 sm:gap-3 min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#85A6E9]"
        >
          <Image
            src="/Logo-new.png"
            alt="TraceBuild"
            width={533}
            height={400}
            className="h-8 w-auto object-contain"
            priority
          />
          <div className="h-4 w-px bg-[rgba(60,63,68,0.6)]" />
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#2862D7]/10 text-[10px] font-bold text-[#85A6E9] uppercase tracking-widest">
            Admin
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <GlobalSearch />
          <AlertBell />

          <div className="h-5 w-px bg-[rgba(60,63,68,0.6)] hidden sm:block" />

          {userEmail && (
            <Link
              href="/dashboard/profile"
              title="Profil bearbeiten"
              className="hidden sm:flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-[#1E2D4A] transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-[#2862D7]/15 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-[#85A6E9]">
                  {userEmail.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-sm text-[#ABAEBB] max-w-[12rem] truncate">{userEmail}</span>
            </Link>
          )}

          <button
            onClick={handleLogout}
            aria-label="Abmelden"
            className="flex items-center gap-1.5 text-sm text-[#ABAEBB] border border-[rgba(60,63,68,0.5)] rounded-xl px-2.5 sm:px-3.5 py-2 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
      </div>
    </header>
  );
}
