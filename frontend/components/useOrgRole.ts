"use client";

import { useEffect, useState } from "react";

/** PATCH /projects/{id} ist Organisations-Admins vorbehalten; das UI bietet es nur ihnen an. */
export function useOrgRole() {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/auth/me")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { data?: { role?: string } };
        if (!cancelled) setRole(json.data?.role ?? null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { role, loading, isAdmin: role === "org_admin" || role === "super_admin" };
}
