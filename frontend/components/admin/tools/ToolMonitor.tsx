"use client";

import { useCallback, useState } from "react";
import type { ProviderInfo } from "@/lib/tool-monitoring/types";
import { CardError, CardSkeleton, focusRing } from "../overview/CardFrame";
import { fetchEnvelope, useResource } from "../overview/resource";
import PageHeader from "../shell/PageHeader";
import ToolCard, { CARD_URL } from "./ToolCard";

interface ListData {
  providers: ProviderInfo[];
}

const loadList = async (): Promise<ListData> => {
  const d = await fetchEnvelope<ListData>(CARD_URL, "Dienste konnten nicht geladen werden.");
  if (!d || !Array.isArray(d.providers)) throw new Error("Unerwartete Antwort.");
  return d;
};

export default function ToolMonitor() {
  const [list, reloadList, listBusy] = useResource(loadList);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const onBusy = useCallback((key: string, b: boolean) => {
    setBusy(prev => (prev[key] === b ? prev : { ...prev, [key]: b }));
  }, []);

  const loading = listBusy || Object.values(busy).some(Boolean);
  const refresh = () => {
    if (loading) return;
    // Jede Karte lädt neu mit ?fresh=1; der Server lässt das höchstens alle 30 s je Dienst durch.
    setRefreshNonce(n => n + 1);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        variant="hero"
        photo="hero"
        overlap={false}
        title="Tools & Dienste"
        subtitle="Zustand, Nutzung, Kontingente und Kosten der externen Dienste"
        actions={
          <button type="button" onClick={refresh} aria-busy={loading} className={`tba-pill-btn ${loading ? "cursor-progress opacity-70" : ""} ${focusRing}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={loading ? "motion-safe:animate-spin" : ""}>
              <path d="M20 12a8 8 0 1 1-2.6-5.9" />
              <path d="M20 4v5h-5" />
            </svg>
            Aktualisieren
          </button>
        }
      />

      <p className="sr-only" role="status" aria-live="polite">
        {loading ? "Daten werden geladen" : ""}
      </p>

      {list.status === "ready" ? (
        <div className="grid grid-cols-1 items-start gap-4 min-[701px]:grid-cols-2 min-[1101px]:grid-cols-3">
          {list.data.providers.map(p => (
            <div key={p.key} className="min-w-0">
              <ToolCard info={p} refreshNonce={refreshNonce} onBusy={onBusy} />
            </div>
          ))}
        </div>
      ) : list.status === "error" ? (
        <CardError message={list.message} onRetry={reloadList} />
      ) : (
        <CardSkeleton rows={4} height="h-24" />
      )}
    </div>
  );
}
