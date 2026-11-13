"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmDialog from "@/components/admin/analyses/ConfirmDialog";
import Toast from "@/components/admin/Toast";
import AdminTabs, { adminPanelId, adminTabId } from "@/components/admin/shell/AdminTabs";
import PageHeader from "@/components/admin/shell/PageHeader";
import type { ToastMessage } from "@/components/admin/types";
import { rejectReasonLabel } from "@/components/geoportal-logic";
import { api } from "@/lib/api";
import { categorizeDocument, categoryGroup, type CategoryContext, type DocumentCategory } from "@/lib/oereb/rejection-category";
import OerebFlow from "./OerebFlow";
import OerebMappingSection from "./OerebMappingSection";
import { OEREB_TABS, oerebHashForTab, oerebTabFromHash, DEFAULT_OEREB_TAB, type OerebTab } from "./oereb-tabs";
import { summarizeCantons } from "./oereb-summary";
import {
  ACTION_BTN,
  CantonTable,
  CategorySummary,
  DECISION_DIALOG,
  DocumentRow,
  INPUT,
  PANEL,
  RulesPanel,
  STATUS,
  skippedBreakdown,
} from "./oereb-ui";
import type { AdminDocument, DecisionResponse, DocumentDecision, DocumentsResponse, OverviewResponse } from "./types";

const PAGE_SIZE = 100;
const PREFIX = "oereb";

function CantonPicker({ cantons, value, onChange }: { cantons: { canton: string; total: number }[]; value: string; onChange: (canton: string) => void }) {
  return (
    <label className="text-sm text-[#5f5f64]">
      <span className="mb-1 block">Kanton</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
        {cantons.map((c) => (
          <option key={c.canton} value={c.canton}>
            {c.canton}
            {c.total > 0 ? ` (${c.total} Dokumente)` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Dokumente je Kanton und Gemeinde, Filterregeln und Themen-Zuordnung, mit Entscheiden des Plattform-Admins. */
export default function OerebImportsManager() {
  const [tab, setTab] = useState<OerebTab>(DEFAULT_OEREB_TAB);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [canton, setCanton] = useState("");
  const [mappingCount, setMappingCount] = useState<number | null>(null);

  const [docs, setDocs] = useState<DocumentsResponse | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [bfs, setBfs] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const [pending, setPending] = useState<{ doc: AdminDocument; decision: DocumentDecision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((type: ToastMessage["type"], message: string) => {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, message }]);
  }, []);
  const removeToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  useEffect(() => {
    const sync = () => setTab(oerebTabFromHash(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const changeTab = useCallback((next: OerebTab) => {
    setTab(next);
    window.history.replaceState(null, "", oerebHashForTab(next));
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      const data = await api.get<OverviewResponse>("/admin/oereb-imports");
      setOverview(data);
      setCanton((current) => current || data.cantons.find((c) => c.total > 0)?.canton || data.cantons[0]?.canton || "");
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : "Der Überblick konnte nicht geladen werden.");
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    api
      .get<{ active: boolean }[]>("/admin/oereb-mappings")
      .then((rows) => setMappingCount((rows ?? []).filter((r) => r.active).length))
      .catch(() => setMappingCount(null));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const documentsPath = useCallback((offset: number) => {
    const params = new URLSearchParams({ canton, limit: String(PAGE_SIZE), offset: String(offset) });
    if (status) params.set("status", status);
    if (reason) params.set("reason", reason);
    if (bfs) params.set("bfs", bfs);
    if (query) params.set("q", query);
    return `/admin/oereb-imports/documents?${params}`;
  }, [canton, status, reason, bfs, query]);

  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    if (!canton) return;
    let active = true;
    setLoading(true);
    setDocsError(null);
    api.get<DocumentsResponse>(documentsPath(0))
      .then((data) => { if (active) setDocs(data); })
      .catch((e) => { if (active) setDocsError(e instanceof Error ? e.message : "Die Dokumente konnten nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canton, documentsPath, reloadTick]);

  async function loadMore() {
    if (!docs) return;
    setLoadingMore(true);
    try {
      const next = await api.get<DocumentsResponse>(documentsPath(docs.documents.length));
      setDocs({ ...next, documents: [...docs.documents, ...next.documents] });
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Weitere Dokumente konnten nicht geladen werden.");
    } finally {
      setLoadingMore(false);
    }
  }

  function selectCanton(next: string) {
    setCanton(next);
    setBfs("");
    setReason("");
  }

  function openCanton(next: string) {
    selectCanton(next);
    changeTab("dokumente");
  }

  async function confirmDecision() {
    if (!pending) return;
    setBusy(true);
    try {
      await api.post<DecisionResponse>(`/admin/oereb-imports/${pending.doc.id}/decision`, { decision: pending.decision });
      pushToast("success", DECISION_DIALOG[pending.decision].done);
      setPending(null);
      setReloadTick((t) => t + 1);
      void loadOverview();
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Der Entscheid konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  const selected = overview?.cantons.find((c) => c.canton === canton);
  const released = docs?.available ? docs.rules.doc_types.length > 0 : selected ? selected.release.released : null;
  const summary = useMemo(() => summarizeCantons(overview?.cantons ?? []), [overview]);

  const groups = useMemo(() => {
    const ctx: CategoryContext = { cantonReleased: released };
    type Entry = { doc: AdminDocument; category: DocumentCategory };
    const out: { key: number; name: string; shown: Entry[]; skipped: Entry[] }[] = [];
    for (const doc of docs?.documents ?? []) {
      const entry: Entry = { doc, category: categorizeDocument(doc, ctx) };
      let last = out[out.length - 1];
      if (last?.key !== doc.bfs_number) {
        last = { key: doc.bfs_number, name: doc.municipality, shown: [], skipped: [] };
        out.push(last);
      }
      (categoryGroup(entry.category) === "skipped" ? last.skipped : last.shown).push(entry);
    }
    return out;
  }, [docs, released]);

  const ready = !!overview?.available;

  return (
    <div className="mx-auto max-w-[1680px] space-y-6">
      <PageHeader
        variant="hero"
        photo="haus2"
        overlap={false}
        title="ÖREB-Importe"
        subtitle="Reglemente aus den ÖREB-Auszügen je Kanton und Gemeinde, die Regeln dazu und die Zuordnung der ÖREB-Themen zu Normen."
      />

      {overviewError && (
        <div role="alert" className="rounded-xl border border-[#D87979]/30 bg-[#fde7e5] px-4 py-3 text-sm text-[#a3201a]">
          {overviewError}{" "}
          <button type="button" onClick={() => void loadOverview()} className="underline underline-offset-2 hover:text-[#151414]">Erneut versuchen</button>
        </div>
      )}
      {overview && !overview.available && (
        <p className={`${PANEL} px-4 py-6 text-center text-sm text-[#46464a]`}>Der automatische Import ist noch nicht aktiv: Die Datenbank-Migration fehlt.</p>
      )}

      <AdminTabs
        tabs={OEREB_TABS}
        active={tab}
        onChange={changeTab}
        prefix={PREFIX}
        label="ÖREB-Bereiche"
        badges={{ dokumente: summary.attention }}
      />

      <div role="tabpanel" id={adminPanelId(PREFIX, tab)} aria-labelledby={adminTabId(PREFIX, tab)} className="space-y-6">
        {tab === "uebersicht" && (
          <>
            {!overview && !overviewError && (
              <div aria-busy="true" aria-label="Überblick wird geladen" className="h-64 animate-pulse rounded-2xl border border-[rgba(21,20,20,0.08)] bg-white" />
            )}
            {ready && (
              <>
                <OerebFlow summary={summary} mappingCount={mappingCount} onGo={changeTab} />

                {summary.attention > 0 && (
                  <section aria-label="Braucht deinen Entscheid" className="rounded-2xl border border-[#D6A45F]/40 bg-[#fff1d6] px-4 py-3">
                    <p className="text-sm font-semibold text-[#7a4f00]">
                      {summary.attention} {summary.attention === 1 ? "Dokument braucht" : "Dokumente brauchen"} deinen Entscheid
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {summary.attentionCantons.map((c) => (
                        <button key={c.canton} type="button" onClick={() => openCanton(c.canton)} className={ACTION_BTN}>
                          {c.canton}: {c.count}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {overview.truncated && <p className="text-sm text-[#7a4f00]">Es gibt mehr Dokumente, als gezählt wurden. Die Zahlen sind Untergrenzen.</p>}
                <div>
                  <h2 className="mb-2 text-base font-bold text-[#151414]">Stand je Kanton</h2>
                  <CantonTable cantons={overview.cantons} selected={canton} onSelect={openCanton} />
                  <p className="mt-2 text-sm text-[#5f5f64]">
                    «Aktiv» heisst, dass der Import für den Kanton läuft. Ein Klick auf den Kanton öffnet seine Dokumente.
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {tab === "dokumente" && ready && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <CantonPicker cantons={overview.cantons} value={canton} onChange={selectCanton} />
              {selected && (
                <p className="pb-2 text-sm text-[#5f5f64]">
                  {selected.total} Dokumente, {selected.imported} importiert, {selected.pending} offen
                  {selected.review + selected.failed > 0 ? `, ${selected.review + selected.failed} zur Prüfung` : ""}
                </p>
              )}
            </div>

            {selected && !selected.release.released && (
              <p className="rounded-xl border border-[#D6A45F]/30 bg-[#fff1d6] px-4 py-3 text-sm text-[#7a4f00]">
                Import für {canton} gestoppt: Die Filterregeln lassen keine Dokumentart zu.
              </p>
            )}

            {docs?.available && docs.categories.length > 0 && <CategorySummary categories={docs.categories} truncated={docs.truncated} />}

            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-[#5f5f64]">
                <span className="mb-1 block">Gemeinde</span>
                <select value={bfs} onChange={(e) => setBfs(e.target.value)} className={INPUT}>
                  <option value="">Alle Gemeinden</option>
                  {docs?.municipalities.map((m) => <option key={m.bfs_number} value={m.bfs_number}>{m.municipality} ({m.count})</option>)}
                </select>
              </label>
              <label className="text-sm text-[#5f5f64]">
                <span className="mb-1 block">Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT}>
                  <option value="">Alle Status</option>
                  {Object.entries(STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-sm text-[#5f5f64]">
                <span className="mb-1 block">Grund</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT}>
                  <option value="">Alle Gründe</option>
                  {docs?.reasons.map((r) => <option key={r.reason} value={r.reason}>{rejectReasonLabel(r.reason)} ({r.count})</option>)}
                </select>
              </label>
              <label className="min-w-[200px] flex-1 text-sm text-[#5f5f64]">
                <span className="mb-1 block">Titel</span>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="z. B. Baureglement" className={`${INPUT} w-full`} />
              </label>
            </div>

            {docsError && <div role="alert" className="rounded-xl border border-[#D87979]/30 bg-[#fde7e5] px-4 py-3 text-sm text-[#a3201a]">{docsError}</div>}

            <div aria-busy={loading} className={loading ? "opacity-60" : ""}>
              {docs?.available && docs.documents.length === 0 && !loading && (
                <p className={`${PANEL} px-4 py-10 text-center text-sm text-[#5f5f64]`}>Keine Dokumente für diese Auswahl.</p>
              )}
              <div className="space-y-4">
                {groups.map((group) => (
                  <section key={group.key} aria-label={`Gemeinde ${group.name}`} className={PANEL}>
                    <h2 className="border-b border-[rgba(21,20,20,0.08)] px-4 py-2 text-sm font-semibold text-[#151414]">
                      {group.name} <span className="font-normal text-[#5f5f64]">BFS {group.key}</span>
                    </h2>
                    {group.shown.length > 0 && (
                      <ul className="divide-y divide-[rgba(21,20,20,0.08)]">
                        {group.shown.map(({ doc, category }) => (
                          <DocumentRow key={doc.id} doc={doc} category={category} busy={busy} onDecide={(d, decision) => setPending({ doc: d, decision })} />
                        ))}
                      </ul>
                    )}
                    {group.skipped.length > 0 && (
                      <details className={group.shown.length > 0 ? "border-t border-[rgba(21,20,20,0.08)]" : ""}>
                        <summary className="cursor-pointer px-4 py-2 text-sm text-[#5f5f64] hover:text-[#151414] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]">
                          {group.skipped.length} bewusst ausgelassen ({skippedBreakdown(group.skipped.map((e) => e.category))})
                        </summary>
                        <ul className="divide-y divide-[rgba(21,20,20,0.08)] border-t border-[rgba(21,20,20,0.08)]">
                          {group.skipped.map(({ doc, category }) => (
                            <DocumentRow key={doc.id} doc={doc} category={category} busy={busy} onDecide={(d, decision) => setPending({ doc: d, decision })} />
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                ))}
              </div>
              {docs && docs.documents.length < docs.total && (
                <div className="mt-4 text-center">
                  <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={ACTION_BTN}>
                    {loadingMore ? "Wird geladen…" : `Weitere laden (${docs.documents.length} von ${docs.total})`}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {tab === "regeln" && ready && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <CantonPicker cantons={overview.cantons} value={canton} onChange={selectCanton} />
              <p className="max-w-2xl pb-2 text-sm text-[#5f5f64]">
                Diese Regeln entscheiden ohne KI, welche verlinkten Dokumente als Reglement importiert werden. Wirksam sind der Standard im Code, darüber die Zeile
                «default», darüber die Zeile des Kantons.
              </p>
            </div>
            {selected && !selected.release.released && (
              <p className="rounded-xl border border-[#D6A45F]/30 bg-[#fff1d6] px-4 py-3 text-sm text-[#7a4f00]">
                Import für {canton} gestoppt: Die Filterregeln lassen keine Dokumentart zu.
              </p>
            )}
            {docs?.available ? (
              <RulesPanel canton={canton} rules={docs.rules} filters={overview.filters} open />
            ) : (
              <p className="text-sm text-[#5f5f64]">Regeln werden geladen…</p>
            )}
          </>
        )}

        {tab === "zuordnung" && <OerebMappingSection />}
      </div>

      {pending && (
        <ConfirmDialog
          title={DECISION_DIALOG[pending.decision].title}
          description={`«${pending.doc.title}»: ${DECISION_DIALOG[pending.decision].text}`}
          confirmLabel={DECISION_DIALOG[pending.decision].confirm}
          tone={DECISION_DIALOG[pending.decision].tone}
          busy={busy}
          onConfirm={() => void confirmDecision()}
          onClose={() => { if (!busy) setPending(null); }}
        />
      )}

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
