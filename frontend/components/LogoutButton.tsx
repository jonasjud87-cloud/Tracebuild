"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton({ className }: { className?: string } = {}) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className={className ?? "rounded-md px-2 py-1 text-sm font-medium text-[#151414] transition-colors hover:bg-[#151414] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#151414]"}
    >
      Abmelden
    </button>
  );
}
