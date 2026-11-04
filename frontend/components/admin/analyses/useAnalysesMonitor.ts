"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysesListResponse, AnalysesSummary, AnalysisRow, AnalysisView, OrgOption } from "@/lib/admin-analyses/types";
import { rangeToFrom, requestJson, type RangeKey } from "./utils";

export interface MonitorFilters {
  view: AnalysisView;
  org: string;
  range: RangeKey;
  minCost: string;
}

export const AUTO_REFRESH_MS = 15_000;
const PAGE_SIZE = 50;

function buildQuery(f: MonitorFilters, cursor: string | null): string {
  const sp = new URLSearchParams();
  sp.set("view", f.view);
  sp.set("limit", String(PAGE_SIZE));
  if (f.org) sp.set("org", f.org);
  const from = rangeToFrom(f.range, Date.now());
  if (from) sp.set("from", from);
  if (f.view === "expensive" && f.minCost.trim() !== "") sp.set("minCost", f.minCost.trim());
  if (cursor) sp.set("cursor", cursor);
  return sp.toString();
}

export function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, active]);
  return now;
}

export function useAnalysesMonitor(filters: MonitorFilters, autoRefresh: boolean) {
  const [items, setItems] = useState<AnalysisRow[]>([]);
  const [summary, setSummary] = useState<AnalysesSummary | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [thresholds, setThresholds] = useState<AnalysesListResponse["thresholds"]>({ expensiveUsd: 1, orphanMinutes: 6 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [extraPages, setExtraPages] = useState(false);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const requestId = useRef(0);
  const busy = useRef(false);
  const pagesLoaded = useRef(1);
  const cursorRef = useRef<string | null>(null);

  const loadFirst = useCallback(async (mode: "initial" | "manual" | "silent") => {
    const id = ++requestId.current;
    busy.current = true;
    if (mode === "initial") setLoading(true);
    if (mode === "manual") setRefreshing(true);

    const result = await requestJson<AnalysesListResponse>(
      `/api/v1/admin/analyses?${buildQuery(filtersRef.current, null)}`,
      { cache: "no-store" },
    );
    if (id !== requestId.current) return;
    busy.current = false;

    if ("error" in result) {
      setError(result.error);
    } else {
      const d = result.data;
      setItems(d.items);
      setNextCursor(d.nextCursor);
      cursorRef.current = d.nextCursor;
      pagesLoaded.current = 1;
      setThresholds(d.thresholds);
      if (d.summary) setSummary(d.summary);
      setSummaryFailed(!d.summary);
      setExtraPages(false);
      if (d.orgs) setOrgs(d.orgs);
      setError(null);
      setLastUpdated(Date.now());
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const filterKey = `${filters.view}|${filters.org}|${filters.range}|${filters.minCost}`;
  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void loadFirst("initial");
  }, [filterKey, loadFirst]);

  const refresh = useCallback(() => loadFirst("manual"), [loadFirst]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor || busy.current) return;
    const id = requestId.current;
    busy.current = true;
    setLoadingMore(true);
    const result = await requestJson<AnalysesListResponse>(
      `/api/v1/admin/analyses?${buildQuery(filtersRef.current, cursor)}`,
      { cache: "no-store" },
    );
    if (id === requestId.current) busy.current = false;
    setLoadingMore(false);
    if (id !== requestId.current) return;
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const seen = new Set<string>();
    setItems((prev) => {
      prev.forEach((r) => seen.add(r.id));
      return [...prev, ...result.data.items.filter((r) => !seen.has(r.id))];
    });
    setNextCursor(result.data.nextCursor);
    cursorRef.current = result.data.nextCursor;
    pagesLoaded.current += 1;
    setExtraPages(true);
    setError(null);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const tick = () => {
      if (document.visibilityState !== "visible" || busy.current || pagesLoaded.current > 1) return;
      void loadFirst("silent");
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [autoRefresh, loadFirst]);

  return { items, summary, summaryFailed, autoPaused: extraPages, orgs, thresholds, nextCursor, loading, refreshing, loadingMore, error, lastUpdated, refresh, loadMore };
}
