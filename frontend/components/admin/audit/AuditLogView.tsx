"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AuditFilters from "./AuditFilters";
import AuditTable from "./AuditTable";
import { EMPTY_FILTERS, buildAuditParams } from "./types";
import type { AuditFilterState, AuditItem, OrgOption } from "./types";

interface PageResponse {
  data: { items: AuditItem[]; nextCursor: string | null } | null;
  error: string | null;
}

const CARD = "bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl";

export default function AuditLogView() {
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/organizations")
      .then(res => (res.ok ? res.json() : null))
      .then((json: { data?: { id: string; name: string }[] } | { id: string; name: string }[] | null) => {
        if (!alive || !json) return;
        const list = Array.isArray(json) ? json : json.data;
        if (!Array.isArray(list)) return;
        setOrgs(list.filter(o => o && typeof o.id === "string" && typeof o.name === "string").map(o => ({ id: o.id, name: o.name })));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), filters.q !== applied.q || filters.actor !== applied.actor ? 350 : 0);
    return () => clearTimeout(t);
  }, [filters, applied.q, applied.actor]);

  const load = useCallback(async (f: AuditFilterState, cursor: string | null) => {
    const id = ++requestId.current;
    const params = buildAuditParams(f);
    if (cursor) params.set("cursor", cursor);
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/audit-log?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as PageResponse | null;
      if (id !== requestId.current) return;
      if (!res.ok || !json || json.error || !json.data) {
        setError(json?.error ?? "Audit-Log konnte nicht geladen werden.");
        return;
      }
      const page = json.data;
      setItems(prev => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch {
      if (id === requestId.current) setError("Netzwerkfehler beim Laden des Audit-Logs.");
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    setNotice(null);
    load(applied, null);
  }, [applied, load]);

  async function exportCsv() {
    setExporting(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/audit-log?${buildAuditParams(applied).toString()}&format=csv`);
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setNotice(json?.error ?? "Export fehlgeschlagen.");
        return;
      }
      const truncated = res.headers.get("X-Export-Truncated") === "true";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "audit-log.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (truncated) setNotice("Export auf die neuesten 10'000 Einträge begrenzt. Bitte Filter weiter einschränken.");
    } catch {
      setNotice("Export fehlgeschlagen.");
    } finally {
      setExporting(false);
    }
  }

  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="space-y-4">
      <AuditFilters
        value={filters}
        orgs={orgs}
        exporting={exporting}
        canExport={!loading && !error && items.length > 0}
        onChange={setFilters}
        onExport={exportCsv}
      />

      {notice && (
        <div role="status" className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm rounded-xl px-4 py-3">
          {notice}
        </div>
      )}

      {loading ? (
        <div className={`${CARD} h-64 animate-pulse`} aria-busy="true" />
      ) : error && items.length === 0 ? (
        <div className={`${CARD} p-12 text-center`} role="alert">
          <svg className="mx-auto mb-3 text-red-400" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 7.5V13M12 16.2V16.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <p className="text-[#ABAEBB] text-sm font-medium">{error}</p>
          <button onClick={() => load(applied, null)} className="mt-3 text-sm text-[#85A6E9] hover:underline">
            Erneut versuchen
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className={`${CARD} p-12 text-center`}>
          <p className="text-[#ABAEBB] text-sm font-medium">
            {filtered ? "Keine Einträge für diese Filter gefunden" : "Noch keine Einträge protokolliert"}
          </p>
          {filtered && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="mt-2 text-sm text-[#85A6E9] hover:underline">
              Filter zurücksetzen
            </button>
          )}
        </div>
      ) : (
        <>
          <AuditTable items={items} />
          {error && (
            <p role="alert" className="text-sm text-red-400 text-center">{error}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[#7B8299]">{items.length} Einträge geladen</p>
            {nextCursor && (
              <button
                onClick={() => load(applied, nextCursor)}
                disabled={loadingMore}
                className="text-sm font-semibold text-[#85A6E9] hover:text-white bg-[#2862D7]/10 hover:bg-[#2862D7] px-4 py-2.5 rounded-xl transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
              >
                {loadingMore ? "Lade..." : "Mehr laden"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
