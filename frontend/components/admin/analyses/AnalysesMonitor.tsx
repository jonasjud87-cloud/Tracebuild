"use client";

import { useCallback, useMemo, useState } from "react";
import Toast from "@/components/admin/Toast";
import type { ToastMessage } from "@/components/admin/types";
import type { AnalysisRow, AnalysisView, CancelResponse } from "@/lib/admin-analyses/types";
import AnalysesFilters from "./AnalysesFilters";
import AnalysesSummary from "./AnalysesSummary";
import AnalysesTable from "./AnalysesTable";
import AnalysesTabs from "./AnalysesTabs";
import AnalysisDetail from "./AnalysisDetail";
import ConfirmDialog from "./ConfirmDialog";
import { AUTO_REFRESH_MS, useAnalysesMonitor, useNow, type MonitorFilters } from "./useAnalysesMonitor";
import { formatAgo, isOrphaned, requestJson, type ActionKind, type RangeKey } from "./utils";

const DEFAULT_FILTERS: MonitorFilters = { view: "running", org: "", range: "default", minCost: "" };

interface Pending {
  kind: ActionKind;
  row: AnalysisRow;
}

export default function AnalysesMonitor({ embedded = false }: { embedded?: boolean }) {
  const Title = embedded ? "h2" : "h1";
  const [filters, setFilters] = useState<MonitorFilters>(DEFAULT_FILTERS);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [highlightOrphans, setHighlightOrphans] = useState(false);
  const [selected, setSelected] = useState<AnalysisRow | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const m = useAnalysesMonitor(filters, autoRefresh);
  const hasRunning = m.items.some((r) => r.status === "running") || selected?.status === "running";
  const now = useNow(hasRunning ? 1000 : 30_000, true);

  const addToast = useCallback((message: string, type: ToastMessage["type"]) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const current = useMemo(() => {
    if (!selected) return null;
    const live = m.items.find((r) => r.id === selected.id);
    return { row: live ?? selected, stale: !live && !m.loading };
  }, [selected, m.items, m.loading]);

  const patch = useCallback((p: Partial<MonitorFilters>) => {
    if (p.view) setHighlightOrphans(false);
    setFilters((f) => ({ ...f, ...p }));
  }, []);
  const selectOrphans = useCallback(() => {
    setHighlightOrphans(true);
    setFilters((f) => ({ ...f, view: "running" }));
  }, []);
  const dirty = filters.org !== "" || filters.range !== "default" || filters.minCost !== "";

  function handleAction(kind: ActionKind, row: AnalysisRow) {
    setPending({ kind, row });
  }

  async function confirmAction() {
    if (!pending) return;
    const { row } = pending;
    setBusyId(row.id);
    const result = await requestJson<CancelResponse>(`/api/v1/admin/analyses/${encodeURIComponent(row.id)}/cancel`, {
      method: "POST",
    });
    setBusyId(null);
    setPending(null);
    if ("error" in result) {
      addToast(result.error, "error");
    } else {
      addToast(
        result.data.outcome === "timed_out"
          ? "Verwaiste Analyse als Zeitüberschreitung beendet."
          : "Analyse abgebrochen.",
        "success",
      );
    }
    await m.refresh();
  }

  const pendingOrphan = pending ? isOrphaned(pending.row, now, m.thresholds.orphanMinutes) : false;

  return (
    <>
      <Toast toasts={toasts} onRemove={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      <div className="space-y-6">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <Title className={embedded ? "text-base font-semibold text-white" : "text-2xl font-bold text-white"}>{embedded ? "Analysen im Überblick" : "Analysen-Monitor"}</Title>
            <p className="mt-1 text-[13px] text-[#ABABAB]" aria-live="polite">
              {m.lastUpdated ? `Zuletzt aktualisiert ${formatAgo(new Date(m.lastUpdated).toISOString(), now)}` : "Wird geladen …"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-[#D5D5D5]">
              <input
                type="checkbox"
                role="switch"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-4 w-4 accent-[#CBBFAE]"
              />
              Auto-Refresh ({AUTO_REFRESH_MS / 1000} s)
            </label>
            <button
              type="button"
              onClick={() => void m.refresh()}
              disabled={m.refreshing}
              className="flex items-center gap-2 rounded-xl tba-btn bg-[linear-gradient(135deg,#CBBFAE,#B5A893)] px-4 py-2.5 text-sm font-semibold text-[#151414] shadow-sm shadow-[#CBBFAE]/25 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CBBFAE]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={m.refreshing ? "animate-spin" : ""}>
                <path d="M12 7a5 5 0 1 1-1.6-3.7M12 2v3H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Aktualisieren
            </button>
          </div>
        </header>

        <AnalysesSummary
          summary={m.summary}
          loading={m.loading}
          failed={m.summaryFailed}
          expensiveChf={m.thresholds.expensiveChf}
          orphanMinutes={m.thresholds.orphanMinutes}
          onSelectView={(view: AnalysisView) => patch({ view })}
          onSelectOrphans={selectOrphans}
        />

        <section className="space-y-4" aria-label="Analysen">
          <AnalysesTabs view={filters.view} summary={m.summary} showCounts={!dirty} onChange={(view) => patch({ view })} />
          <AnalysesFilters
            view={filters.view}
            orgs={m.orgs}
            org={filters.org}
            range={filters.range}
            minCost={filters.minCost}
            expensiveChf={m.thresholds.expensiveChf}
            dirty={dirty}
            onOrg={(org) => patch({ org })}
            onRange={(range: RangeKey) => patch({ range })}
            onMinCost={(minCost) => patch({ minCost })}
            onReset={() => patch({ org: "", range: "default", minCost: "" })}
          />
          {highlightOrphans && filters.view === "running" && (
            <div className="flex items-center gap-2 text-[13px] text-[#D6A45F]">
              <span className="rounded-full border border-[#D6A45F]/30 bg-[#D6A45F]/10 px-2.5 py-1 font-semibold">
                Verwaiste Analysen sind orange hervorgehoben
              </span>
              <button
                type="button"
                onClick={() => setHighlightOrphans(false)}
                className="rounded px-1.5 py-1 text-[#D5D5D5] underline hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CBBFAE]"
              >
                Hervorhebung entfernen
              </button>
            </div>
          )}
          {autoRefresh && m.autoPaused && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-[#D6A45F]/30 bg-[#D6A45F]/20 px-4 py-2.5 text-[13px] text-[#E8C48A]">
              <span>Auto-Aktualisierung pausiert, weil weitere Seiten geladen sind.</span>
              <button
                type="button"
                onClick={() => void m.refresh()}
                className="rounded-lg border border-[#D6A45F]/40 px-2.5 py-1 font-semibold hover:bg-[#D6A45F]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CBBFAE]"
              >
                Zurücksetzen und neu laden
              </button>
            </div>
          )}
          <div id="analyses-panel" role="tabpanel" aria-labelledby={`analyses-tab-${filters.view}`}>
            <AnalysesTable
              items={m.items}
              loading={m.loading}
              error={m.error}
              now={now}
              orphanMinutes={m.thresholds.orphanMinutes}
              expensiveUsd={m.thresholds.expensiveUsd}
              selectedId={selected?.id ?? null}
              highlightOrphans={highlightOrphans}
              busyId={busyId}
              hasMore={m.nextCursor !== null}
              loadingMore={m.loadingMore}
              onSelect={setSelected}
              onAction={handleAction}
              onLoadMore={() => void m.loadMore()}
              onRetry={() => void m.refresh()}
            />
          </div>
        </section>
      </div>

      {current && (
        <AnalysisDetail
          row={current.row}
          stale={current.stale}
          now={now}
          orphanMinutes={m.thresholds.orphanMinutes}
          busy={busyId === current.row.id}
          escapeEnabled={!pending}
          onAction={handleAction}
          onClose={() => setSelected(null)}
        />
      )}

      {pending && (
        <ConfirmDialog
          title={pendingOrphan ? "Verwaiste Analyse beenden?" : "Analyse abbrechen?"}
          description={
            pendingOrphan
              ? `Die Analyse für „${pending.row.projectName}" läuft seit über ${m.thresholds.orphanMinutes} Minuten und gilt als verwaist. Sie wird als Zeitüberschreitung (Fehler) markiert.`
              : `Die laufende Analyse für „${pending.row.projectName}" (${pending.row.orgName}) wird abgebrochen. Bereits angefallene Kosten bleiben bestehen.`
          }
          confirmLabel={pendingOrphan ? "Beenden" : "Abbrechen"}
          busy={busyId === pending.row.id}
          onConfirm={() => void confirmAction()}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
