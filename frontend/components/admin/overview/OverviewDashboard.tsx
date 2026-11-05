"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { OverviewData } from "@/lib/admin-overview/types";
import AnalysesChart from "./AnalysesChart";
import BudgetDonut from "./BudgetDonut";
import { Card, CardError, CardSkeleton, focusRing, type Resource } from "./CardFrame";
import KpiTile from "./KpiTile";
import LatestAnalysesTable from "./LatestAnalysesTable";
import SystemStatusCard, { type SystemStatusData } from "./SystemStatusCard";
import { formatInt, formatMoney, resolveCurrency } from "./format";

const OVERVIEW_URL = "/api/v1/admin/overview";
const STATUS_URL = "/api/v1/admin/system-status";

async function fetchEnvelope<T>(url: string, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("Keine Verbindung zum Server.");
  }
  let body: { data?: T | null; error?: string | null } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body || body.error || body.data === null || body.data === undefined) {
    throw new Error(body?.error && typeof body.error === "string" ? body.error : fallback);
  }
  return body.data;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isOverview(d: unknown): d is OverviewData {
  if (!isObj(d) || !isObj(d.kpis) || !isObj(d.budget) || !isObj(d.currency)) return false;
  const k = d.kpis;
  const b = d.budget;
  if (!isObj(k.analyses30d) || !isNum(k.analyses30d.value)) return false;
  if (!isObj(k.activeOrgs) || !isNum(k.activeOrgs.value)) return false;
  if (!isObj(k.activeUsers) || !isNum(k.activeUsers.value)) return false;
  if (!isObj(k.cost) || !isNum(k.cost.valueUsd)) return false;
  if (!isNum(b.usedUsd) || !isNum(b.budgetUsd) || !isNum(b.orgsWithBudget)) return false;
  if (b.percent !== null && !isNum(b.percent)) return false;
  if (!Array.isArray(d.series) || !d.series.every(p => isObj(p) && typeof p.date === "string" && isNum(p.count))) return false;
  if (!Array.isArray(d.latest) || !d.latest.every(r => isObj(r) && typeof r.id === "string")) return false;
  if (d.unavailable !== undefined && !Array.isArray(d.unavailable)) return false;
  return true;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const icons = {
  analyses: (
    <Icon>
      <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </Icon>
  ),
  orgs: (
    <Icon>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16 5a3 3 0 0 1 0 6M18 14c1.9.7 3 2.4 3 5" />
    </Icon>
  ),
  user: (
    <Icon>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </Icon>
  ),
  cost: (
    <Icon>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </Icon>
  ),
};

function useResource<T>(load: () => Promise<T>) {
  const [state, setState] = useState<Resource<T>>({ status: "loading" });
  const [busy, setBusy] = useState(true);
  const alive = useRef(true);
  const seq = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    setBusy(true);
    setState(prev => (prev.status === "ready" ? prev : { status: "loading" }));
    load().then(
      data => {
        if (alive.current && id === seq.current) {
          setState({ status: "ready", data });
          setBusy(false);
        }
      },
      (e: unknown) => {
        if (alive.current && id === seq.current) {
          setState({ status: "error", message: e instanceof Error ? e.message : "Unbekannter Fehler." });
          setBusy(false);
        }
      }
    );
  }, [load]);

  useEffect(() => {
    alive.current = true;
    run();
    return () => {
      alive.current = false;
    };
  }, [run]);

  return [state, run, busy] as const;
}

const loadOverview = async () => {
  const d = await fetchEnvelope<OverviewData>(OVERVIEW_URL, "Übersicht konnte nicht geladen werden.");
  if (!isOverview(d)) throw new Error("Unerwartete Antwort der Übersicht.");
  return d;
};

const loadStatus = () => fetchEnvelope<SystemStatusData>(STATUS_URL, "Systemstatus konnte nicht geladen werden.");

function NoData() {
  return <p className="py-8 text-center text-sm text-[#ABAEBB]">Keine Daten verfügbar.</p>;
}

function PlaceholderCard({ title, state, retry, skeleton }: { title: string; state: Resource<unknown>; retry?: () => void; skeleton: ReactNode }) {
  return (
    <Card title={title}>
      {state.status === "error" ? retry ? <CardError message={state.message} onRetry={retry} /> : <NoData /> : skeleton}
    </Card>
  );
}

export default function OverviewDashboard() {
  const [overview, reloadOverview, overviewBusy] = useResource(loadOverview);
  const [status, reloadStatus, statusBusy] = useResource(loadStatus);

  const loading = overviewBusy || statusBusy;
  const refresh = () => {
    if (loading) return;
    reloadOverview();
    reloadStatus();
  };

  const data = overview.status === "ready" ? overview.data : null;
  const cur = resolveCurrency(data?.currency);
  const missing = new Set<string>(data && Array.isArray(data.unavailable) ? data.unavailable : []);
  const lacks = (...keys: string[]) => keys.some(k => missing.has(k));
  const noAnalyses = lacks("analysesCount");
  const noOrgs = lacks("orgs", "analyses");
  const noUsers = lacks("activeUsers", "orgs");
  const noCost = lacks("analyses", "chat", "norms");
  const noSeries = lacks("analyses");
  const noBudget = lacks("orgs", "analyses", "chat", "norms");
  const noLatest = lacks("latest");

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-[rgba(60,63,68,0.5)] bg-[#172540] px-5 py-6 sm:px-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(40,98,215,0.28)_0%,rgba(133,166,233,0.10)_45%,rgba(23,37,64,0)_80%)]"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white sm:text-3xl">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-[#ABAEBB]">Systemübersicht, Nutzung und Verwaltung</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            aria-busy={loading}
            className={`inline-flex items-center gap-2 rounded-lg border border-[rgba(133,166,233,0.4)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 ${loading ? "cursor-progress opacity-70" : ""} ${focusRing}`}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={loading ? "motion-safe:animate-spin" : ""}>
              <path d="M10.5 6A4.5 4.5 0 1 1 9.16 2.84M10.5 1.5v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Aktualisieren
          </button>
        </div>
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {loading ? "Daten werden geladen" : ""}
      </p>

      {data && (missing.size > 0 || data.truncated) && (
        <div className="space-y-1 rounded-xl border border-[rgba(60,63,68,0.5)] bg-[#172540] px-4 py-3 text-sm text-[#ABAEBB]">
          {missing.size > 0 && <p>Einige Kennzahlen konnten nicht geladen werden.</p>}
          {data.truncated && <p>Sehr viele Analysen: ältere Werte können ungenau sein.</p>}
        </div>
      )}

      {data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile label="Analysen (30 Tage)" value={noAnalyses ? "–" : formatInt(data.kpis.analyses30d.value)} icon={icons.analyses} changePct={data.kpis.analyses30d.changePct} hideTrend={noAnalyses} />
          <KpiTile label="Aktive Organisationen" value={noOrgs ? "–" : formatInt(data.kpis.activeOrgs.value)} icon={icons.orgs} changePct={data.kpis.activeOrgs.changePct} hideTrend={noOrgs} />
          <KpiTile label="Aktive Nutzer" value={noUsers ? "–" : formatInt(data.kpis.activeUsers.value)} icon={icons.user} hideTrend />
          <KpiTile
            label="API-Kosten (Monat)"
            value={noCost ? "–" : formatMoney(data.kpis.cost.valueUsd, cur)}
            icon={icons.cost}
            changePct={data.kpis.cost.changePct}
            hideTrend={noCost}
            lowerIsBetter
          />
        </div>
      ) : overview.status === "error" ? (
        <CardError message={overview.message} onRetry={reloadOverview} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-[106px] animate-pulse rounded-2xl border border-[rgba(60,63,68,0.5)] bg-[#172540] motion-reduce:animate-none" />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {data && noSeries ? (
            <Card title="Analysen im Zeitverlauf"><NoData /></Card>
          ) : data ? (
            <AnalysesChart series={data.series} />
          ) : (
            <PlaceholderCard title="Analysen im Zeitverlauf" state={overview} skeleton={<CardSkeleton rows={1} height="h-[250px]" />} />
          )}
        </div>
        <div className="min-w-0">
          {data && noBudget ? (
            <Card title="Nutzung (Monat)"><NoData /></Card>
          ) : data ? (
            <BudgetDonut budget={data.budget} currency={cur} />
          ) : (
            <PlaceholderCard title="Nutzung (Monat)" state={overview} skeleton={<CardSkeleton rows={1} height="h-[250px]" />} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {data && noLatest ? (
            <Card title="Letzte Analysen"><NoData /></Card>
          ) : data ? (
            <LatestAnalysesTable rows={data.latest} />
          ) : (
            <PlaceholderCard title="Letzte Analysen" state={overview} skeleton={<CardSkeleton rows={4} />} />
          )}
        </div>
        <div className="min-w-0">
          {status.status === "ready" ? (
            <SystemStatusCard data={status.data} />
          ) : (
            <PlaceholderCard title="Systemstatus" state={status} retry={reloadStatus} skeleton={<CardSkeleton rows={4} />} />
          )}
        </div>
      </div>
    </div>
  );
}
