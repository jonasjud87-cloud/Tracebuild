"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AdminShell from "@/components/admin/shell/AdminShell";
import PageHeader from "@/components/admin/shell/PageHeader";
import { fetchEnvelope } from "@/components/admin/overview/resource";
import AdminNormLibrary from "@/components/admin/norms/AdminNormLibrary";
import DigestPanel from "@/components/admin/norms/DigestPanel";
import AdminOrgNorms from "@/components/admin/norms/AdminOrgNorms";
import NormWatchPanel from "@/components/admin/norms/NormWatchPanel";
import NormsTabs, { panelId, tabId } from "@/components/admin/norms/NormsTabs";
import { NORMS_PAGE_SIZE, type AdminNorm } from "@/components/admin/norms/admin-norm-types";
import { DEFAULT_TAB, OEREB_ZUORDNUNG_PATH, hashForTab, isLegacyOerebHash, tabFromHash, type NormsTab } from "@/components/admin/norms/norms-tabs";
import { api } from "@/lib/api";
import type { NormWatchOverview } from "@/lib/norm-watch/types";

function Stat({ label, value, loading }: { label: string; value: number | string; loading: boolean }) {
  return (
    <div>
      <p className="text-[13px] font-semibold uppercase tracking-wider text-white/70">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-white">{loading ? "–" : value}</p>
    </div>
  );
}

export default function AdminNormsPage() {
  const [userEmail, setUserEmail] = useState("");
  const [norms, setNorms] = useState<AdminNorm[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<NormsTab>(DEFAULT_TAB);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [watch, setWatch] = useState<NormWatchOverview | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (data.user) setUserEmail(data.user.email ?? "");
      });
  }, []);

  useEffect(() => {
    const sync = () => {
      if (isLegacyOerebHash(window.location.hash)) {
        window.location.replace(OEREB_ZUORDNUNG_PATH);
        return;
      }
      setTab(tabFromHash(window.location.hash));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const changeTab = useCallback((next: NormsTab) => {
    setTab(next);
    window.history.replaceState(null, "", hashForTab(next));
  }, []);

  const loadNorms = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ domain: "bau" });
      const all: AdminNorm[] = [];
      for (let offset = 0; ; offset += NORMS_PAGE_SIZE) {
        params.set("limit", String(NORMS_PAGE_SIZE));
        params.set("offset", String(offset));
        const page = (await api.get<AdminNorm[]>(`/admin/norms?${params}`)) ?? [];
        all.push(...page);
        if (page.length < NORMS_PAGE_SIZE) break;
      }
      setNorms(all);
    } catch {
      setNorms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWatch = useCallback(async () => {
    try {
      setWatch(await fetchEnvelope<NormWatchOverview>("/api/v1/admin/norm-watch", "Normabgleich nicht verfügbar"));
    } catch {
      setWatch(null);
    }
  }, []);

  useEffect(() => {
    loadNorms();
    loadWatch();
  }, [loadNorms, loadWatch]);

  async function handlePromote(id: string) {
    setPromotingId(id);
    try {
      const updated = await api.post<AdminNorm>(`/admin/norms/${id}/promote`, {});
      setNorms((prev) => prev.map((n) => (n.id === id ? { ...n, ...updated } : n)));
    } catch {
      setPromotingId(null);
    } finally {
      setPromotingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Diese Norm dauerhaft löschen?")) return;
    try {
      await api.delete(`/admin/norms/${id}`);
      setNorms((prev) => prev.filter((n) => n.id !== id));
    } catch {
      setPromotingId(null);
    }
  }

  const platformNorms = useMemo(() => norms.filter((n) => !n.org_id), [norms]);
  const orgNorms = useMemo(() => norms.filter((n) => !!n.org_id), [norms]);
  const watchedIds = useMemo(
    () => new Set((watch?.sources ?? []).map((s) => s.normId).filter((id): id is string => !!id)),
    [watch],
  );

  return (
    <AdminShell userEmail={userEmail}>
      <div className="space-y-6">
        <PageHeader
          variant="hero"
          photo="haus1"
          overlap={false}
          title="Normen"
          subtitle="Rechtsgrundlagen verwalten: Bibliothek, Aktualität der amtlichen Quellen und Normen der Organisationen."
        />

        <div className="tba-glass tba-glass--dark tba-card tba-card--static grid grid-cols-2 gap-4 rounded-[20px] p-5 sm:grid-cols-4">
          <Stat label="Plattformweit" value={platformNorms.length} loading={loading} />
          <Stat label="Von Organisationen" value={orgNorms.length} loading={loading} />
          <Stat label="Mit Abgleich" value={watchedIds.size} loading={loading || watch === null} />
          <Stat label="Zur Freigabe" value={watch?.summary.updateAvailable ?? 0} loading={watch === null} />
        </div>

        <p className="text-sm text-[#5f5f64]">
          Gemeinde-Reglemente aus den ÖREB-Auszügen und die Zuordnung von ÖREB-Themen zu Normen verwaltest du unter{" "}
          <Link href="/admin/oereb-imports" className="font-semibold text-[#151414] underline underline-offset-2">ÖREB-Importe</Link>.
        </p>

        <NormsTabs active={tab} onChange={changeTab} badges={{ quellen: watch?.summary.updateAvailable ?? 0 }} />

        <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="space-y-4">
          {tab === "bibliothek" && <DigestPanel />}
          {tab === "bibliothek" && (
            <AdminNormLibrary
              norms={platformNorms}
              loading={loading}
              watchedIds={watchedIds}
              onDelete={handleDelete}
              onUploaded={() => {
                loadNorms();
                loadWatch();
              }}
            />
          )}
          {tab === "quellen" && <NormWatchPanel />}
          {tab === "organisationen" && (
            <AdminOrgNorms norms={orgNorms} loading={loading} promotingId={promotingId} onPromote={handlePromote} onDelete={handleDelete} />
          )}
        </div>
      </div>
    </AdminShell>
  );
}
