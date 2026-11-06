"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmDialog from "@/components/admin/analyses/ConfirmDialog";
import Toast from "@/components/admin/Toast";
import type { ToastMessage } from "@/components/admin/types";
import { REVIEW_LABEL, formatDate, rejectReasonLabel, safeExternalUrl } from "@/components/geoportal-logic";
import { AI_READ_LABEL } from "@/lib/oereb/ai-read-label";
import { api } from "@/lib/api";
import type { ImportFilterRules } from "@/lib/oereb/import-filter";
import type {
  AdminDocument,
  CantonOverview,
  CantonRelease,
  DecisionResponse,
  DocumentDecision,
  DocumentsResponse,
  FilterRow,
  OverviewResponse,
} from "./types";

const PAGE_SIZE = 100;

const STATUS: Record<string, { label: string; cls: string }> = {
  imported: { label: "Importiert", cls: "border-[#65A88A]/30 bg-[#65A88A]/10 text-[#65A88A]" },
  pending: { label: "Offen", cls: "border-[#83A9D0]/30 bg-[#83A9D0]/10 text-[#83A9D0]" },
  rejected: { label: "Abgelehnt", cls: "border-[rgba(240,201,154,0.3)] bg-white/5 text-[#A7AFBA]" },
  failed: { label: "Fehler", cls: "border-[#D87979]/40 bg-[#D87979]/10 text-[#EBA1A1]" },
  duplicate_manual: { label: "Von Hand erfasst", cls: "border-[rgba(240,201,154,0.3)] bg-white/5 text-[#A7AFBA]" },
  removed: { label: "Entfernt", cls: "border-[#304052] bg-white/5 text-[#8E98A6]" },
  review: { label: REVIEW_LABEL, cls: "border-[#83A9D0]/30 bg-[#83A9D0]/10 text-[#83A9D0]" },
};
const SCAN_STATUS = { label: "Scan", cls: "border-[#D6A45F]/30 bg-[#D6A45F]/10 text-[#D6A45F]" };

const DECISION_BADGE: Record<DocumentDecision, string> = {
  force_import: "Admin: trotzdem importieren",
  exclude: "Admin: ausgeschlossen",
  recheck: "Admin: neu prüfen",
};

const DECISION_DIALOG: Record<DocumentDecision, { title: string; text: string; confirm: string; tone: "danger" | "primary"; done: string }> = {
  force_import: {
    title: "Trotzdem importieren?",
    text: "Das Dokument wird trotz Ablehnung übernommen und gilt in den Analysen der betroffenen Projekte. Der Entscheid bleibt auch bei späteren Abrufen bestehen.",
    confirm: "Trotzdem importieren",
    tone: "primary",
    done: "Das Dokument wird trotzdem importiert.",
  },
  exclude: {
    title: "Dokument ausschliessen?",
    text: "Das Dokument wird nicht mehr importiert und zählt nicht in den Analysen. Der Entscheid bleibt auch bei späteren Abrufen bestehen.",
    confirm: "Ausschliessen",
    tone: "danger",
    done: "Das Dokument ist ausgeschlossen.",
  },
  recheck: {
    title: "Dokument neu prüfen?",
    text: "Das Dokument wird beim nächsten Abruf erneut gegen die Filterregeln geprüft.",
    confirm: "Neu prüfen",
    tone: "primary",
    done: "Das Dokument wird neu geprüft.",
  },
};

const RULE_LISTS: { key: keyof ImportFilterRules; label: string }[] = [
  { key: "doc_types", label: "Importierte Dokumentarten" },
  { key: "title_positive", label: "Titel gilt als Reglement" },
  { key: "title_negative", label: "Titel führt zur Ablehnung" },
  { key: "title_reject_exact", label: "Genau diese Titel ablehnen" },
  { key: "title_not_in_force", label: "Nicht rechtskräftig" },
  { key: "title_amendment", label: "Änderungserlasse" },
  { key: "title_annex", label: "Beilagen" },
  { key: "content_reject_head", label: "Textanfang: Beschluss" },
  { key: "letter_head_terms", label: "Textanfang: Brief" },
  { key: "version_date_markers", label: "Stand-Begriffe" },
  { key: "authority_reject", label: "Abgelehnte Behörden" },
  { key: "allowed_hosts", label: "Erlaubte Quellen" },
  { key: "http_allowed_hosts", label: "Quellen mit http" },
];

const RULE_NUMBERS: { key: keyof ImportFilterRules; label: string }[] = [
  { key: "min_text_chars", label: "Mindestens Zeichen" },
  { key: "min_article_run", label: "Mindestens Artikel in Folge" },
  { key: "min_article_run_amendment", label: "Dito bei Änderungserlassen" },
  { key: "max_accepted_per_municipality", label: "Höchstens Dokumente je Gemeinde" },
  { key: "max_pdf_bytes", label: "Höchstens Bytes je PDF" },
  { key: "recheck_hours", label: "Neu prüfen nach Stunden" },
  { key: "older_version_recheck_hours", label: "Ältere Fassung neu prüfen nach Stunden" },
  { key: "version_min_overlap", label: "Mindestanteil gemeinsamer Text bei Fassungen" },
  { key: "upload_similarity_min", label: "Ablösung eines Uploads ab Anteil" },
  { key: "supersede_after_days", label: "Alte Adresse abgelöst nach Tagen" },
];

const INPUT = "rounded-lg border border-[rgba(240,201,154,0.25)] bg-[rgba(17,27,43,0.6)] px-3 py-2 text-sm text-white placeholder:text-[#8E98A6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]";
const ACTION_BTN = "rounded-lg border border-[rgba(255,255,255,0.08)] px-3 py-1.5 text-xs font-medium text-[#A7AFBA] transition-colors hover:bg-[#223247] hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]";
const PANEL = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03]";
const TH = "px-3 py-2 text-right font-medium";
const TD = "px-3 py-2 text-right tabular-nums";

function releaseText(release: CantonRelease): string {
  const source = release.source === "canton" ? "Kantonszeile" : release.source === "default" ? "Zeile default" : "Standard im Code";
  return `${release.released ? "Freigegeben" : "Gestoppt"} (${source})`;
}

function ownRulesText(own: CantonOverview["own_rules"]): string {
  return own === "active" ? "aktiv" : own === "inactive" ? "inaktiv" : "keine";
}

function CantonTable({ cantons, selected, onSelect }: { cantons: CantonOverview[]; selected: string; onSelect: (canton: string) => void }) {
  return (
    <section aria-label="Kantone" className={`${PANEL} overflow-x-auto tba-scroll-x`}>
      <table className="w-full min-w-[720px] text-xs text-[#A7AFBA]">
        <thead className="text-[#8E98A6]">
          <tr className="border-b border-[rgba(255,255,255,0.08)]">
            <th scope="col" className={`${TH} text-left`}>Kanton</th>
            <th scope="col" className={`${TH} text-left`}>Freigabe</th>
            <th scope="col" className={`${TH} text-left`}>Eigene Regeln</th>
            <th scope="col" className={TH}>Dokumente</th>
            <th scope="col" className={TH}>Importiert</th>
            <th scope="col" className={TH}>Abgelehnt</th>
            <th scope="col" className={TH}>Scans</th>
            <th scope="col" className={TH}>Fehler</th>
            <th scope="col" className={TH}>Offen</th>
            <th scope="col" className={TH}>Zur Prüfung</th>
          </tr>
        </thead>
        <tbody>
          {cantons.map((c) => (
            <tr key={c.canton} className={`border-b border-[#304052] last:border-0 ${c.canton === selected ? "bg-[#F0C99A]/15" : ""}`}>
              <th scope="row" className="px-3 py-1 text-left font-normal">
                <button
                  type="button"
                  aria-pressed={c.canton === selected}
                  onClick={() => onSelect(c.canton)}
                  className="min-h-[28px] min-w-[44px] rounded-md px-2 text-left font-semibold text-[#F0C99A] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]"
                >
                  {c.canton}
                </button>
              </th>
              <td className={`px-3 py-2 ${c.release.released ? "text-[#65A88A]" : "text-[#D6A45F]"}`}>{releaseText(c.release)}</td>
              <td className="px-3 py-2">{ownRulesText(c.own_rules)}</td>
              <td className={TD}>{c.total}</td>
              <td className={TD}>{c.imported}</td>
              <td className={TD}>{c.rejected}</td>
              <td className={TD}>{c.scans}</td>
              <td className={TD}>{c.failed}</td>
              <td className={TD}>{c.pending}</td>
              <td className={TD}>{c.review}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RulesPanel({ canton, rules, filters }: { canton: string; rules: ImportFilterRules; filters: FilterRow[] }) {
  const rows = filters.filter((f) => f.scope === "default" || f.scope === canton);
  return (
    <details className={`${PANEL} px-4 py-3`}>
      <summary className="cursor-pointer text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]">
        Aktive Filterregeln für {canton}
      </summary>
      <p className="mt-2 text-xs text-[#8E98A6]">Wirksam sind der Standard im Code, darüber die Zeile default, darüber die Zeile des Kantons. Ändern lassen sich die Zeilen per SQL.</p>
      <dl className="mt-3 grid gap-3 md:grid-cols-2">
        {RULE_LISTS.map(({ key, label }) => {
          const values = rules[key] as string[];
          return (
            <div key={key}>
              <dt className="text-xs font-medium text-[#A7AFBA]">{label}</dt>
              <dd className="mt-0.5 text-xs text-[#8E98A6]" style={{ overflowWrap: "anywhere" }}>{values.length ? values.join(", ") : "keine"}</dd>
            </div>
          );
        })}
        {RULE_NUMBERS.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-xs font-medium text-[#A7AFBA]">{label}</dt>
            <dd className="mt-0.5 text-xs tabular-nums text-[#8E98A6]">{String(rules[key])}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-4 text-xs font-semibold text-white">Zeilen aus der Datenbank</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-[#8E98A6]">Keine: Es gilt der Standard im Code.</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {rows.map((row) => (
            <li key={row.scope} className="text-xs text-[#8E98A6]">
              <span className="font-medium text-[#A7AFBA]">{row.scope}</span>
              {row.active ? "" : " (inaktiv, zählt nicht)"}
              {row.updated_at ? ` · ${formatDate(row.updated_at)}` : ""}
              {row.note ? <span className="block">{row.note}</span> : null}
              <code className="mt-0.5 block text-[11px]" style={{ overflowWrap: "anywhere" }}>{JSON.stringify(row.rules)}</code>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function DocumentRow({ doc, busy, onDecide }: { doc: AdminDocument; busy: boolean; onDecide: (doc: AdminDocument, decision: DocumentDecision) => void }) {
  const isScan = doc.status === "rejected" && doc.reject_reason === "scan_or_short";
  const status = isScan ? SCAN_STATUS : STATUS[doc.status] ?? STATUS.rejected;
  const href = safeExternalUrl(doc.url);
  const checked = formatDate(doc.last_checked_at);
  const meta = [
    doc.reject_reason ? `Grund: ${rejectReasonLabel(doc.reject_reason)}` : null,
    doc.scope === "municipal" ? "Geltung: ganze Gemeinde" : doc.scope === "parcel" ? "Geltung: einzelne Grundstücke" : "Geltung: offen",
    checked ? `geprüft ${checked}` : "noch nicht geprüft",
    typeof doc.ocr_cost_usd === "number" ? `Lesekosten ${Number(doc.ocr_cost_usd).toFixed(2)} USD` : null,
  ].filter(Boolean).join(" · ");

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.cls}`}>{status.label}</span>
        {doc.manual_decision && (
          <span className="whitespace-nowrap rounded-full border border-[#F0C99A]/40 bg-[#F0C99A]/15 px-2 py-0.5 text-[11px] font-medium text-[#F0C99A]">
            {DECISION_BADGE[doc.manual_decision]}
          </span>
        )}
        {doc.text_source === "ai_read" && (
          <span className="whitespace-nowrap rounded-full border border-[#D6A45F]/30 bg-[#D6A45F]/10 px-2 py-0.5 text-[11px] font-medium text-[#D6A45F]">
            {AI_READ_LABEL}
          </span>
        )}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-sm text-white underline decoration-[#F0C99A]/50 underline-offset-2 hover:decoration-white" style={{ overflowWrap: "anywhere" }}>
            {doc.title} <span aria-hidden="true" className="text-[#F0C99A]">↗</span>
          </a>
        ) : (
          <span className="text-sm text-white" style={{ overflowWrap: "anywhere" }}>{doc.title}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-[#8E98A6]" style={{ overflowWrap: "anywhere" }}>{meta}</p>
      {doc.reject_detail && <p className="mt-0.5 text-xs text-[#8E98A6]" style={{ overflowWrap: "anywhere" }}>{doc.reject_detail}</p>}
      {doc.version_note && <p className="mt-0.5 text-xs text-[#F0C99A]" style={{ overflowWrap: "anywhere" }}>{doc.version_note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || doc.status === "imported"} onClick={() => onDecide(doc, "force_import")} className={ACTION_BTN}>Trotzdem importieren</button>
        <button type="button" disabled={busy || doc.manual_decision === "exclude"} onClick={() => onDecide(doc, "exclude")} className={ACTION_BTN}>Ausschliessen</button>
        <button type="button" disabled={busy} onClick={() => onDecide(doc, "recheck")} className={ACTION_BTN}>Neu prüfen</button>
      </div>
    </li>
  );
}

/** Dokumente je Kanton und Gemeinde, mit Entscheiden des Plattform-Admins. */
export default function OerebImportsManager() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [canton, setCanton] = useState("");

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

  // Nur die jüngste Anfrage zählt: Sonst überschreibt eine langsame Antwort den neuen Kanton.
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

  const groups = useMemo(() => {
    const out: { key: number; name: string; docs: AdminDocument[] }[] = [];
    for (const doc of docs?.documents ?? []) {
      const last = out[out.length - 1];
      if (last?.key === doc.bfs_number) last.docs.push(doc);
      else out.push({ key: doc.bfs_number, name: doc.municipality, docs: [doc] });
    }
    return out;
  }, [docs]);

  const selected = overview?.cantons.find((c) => c.canton === canton);

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-white">ÖREB-Importe</h1>
        <p className="mt-1 text-sm text-[#A7AFBA]">Reglemente aus den ÖREB-Auszügen je Kanton und Gemeinde. Entscheide bleiben auch bei späteren Abrufen bestehen.</p>
      </div>

      {overviewError && (
        <div role="alert" className="rounded-xl border border-[#D87979]/30 bg-[#D87979]/10 px-4 py-3 text-sm text-[#EBA1A1]">
          {overviewError}{" "}
          <button type="button" onClick={() => void loadOverview()} className="underline underline-offset-2 hover:text-white">Erneut versuchen</button>
        </div>
      )}
      {!overview && !overviewError && (
        <div aria-busy="true" aria-label="Überblick wird geladen" className="h-64 animate-pulse rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03]" />
      )}
      {overview && !overview.available && (
        <p className={`${PANEL} px-4 py-6 text-center text-sm text-[#A7AFBA]`}>Der automatische Import ist noch nicht aktiv: Die Datenbank-Migration fehlt.</p>
      )}

      {overview?.available && (
        <>
          {overview.truncated && <p className="text-xs text-[#D6A45F]">Es gibt mehr Dokumente, als gezählt wurden. Die Zahlen sind Untergrenzen.</p>}
          <CantonTable cantons={overview.cantons} selected={canton} onSelect={selectCanton} />

          {selected && !selected.release.released && (
            <p className="rounded-xl border border-[#D6A45F]/30 bg-[#D6A45F]/10 px-4 py-3 text-sm text-[#D6A45F]">
              Import für {canton} gestoppt: Die Filterregeln lassen keine Dokumentart zu.
            </p>
          )}

          {docs?.available && <RulesPanel canton={canton} rules={docs.rules} filters={overview.filters} />}

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[#8E98A6]">
              <span className="mb-1 block">Gemeinde</span>
              <select value={bfs} onChange={(e) => setBfs(e.target.value)} className={INPUT}>
                <option value="">Alle Gemeinden</option>
                {docs?.municipalities.map((m) => <option key={m.bfs_number} value={m.bfs_number}>{m.municipality} ({m.count})</option>)}
              </select>
            </label>
            <label className="text-xs text-[#8E98A6]">
              <span className="mb-1 block">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT}>
                <option value="">Alle Status</option>
                {Object.entries(STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-[#8E98A6]">
              <span className="mb-1 block">Grund</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT}>
                <option value="">Alle Gründe</option>
                {docs?.reasons.map((r) => <option key={r.reason} value={r.reason}>{rejectReasonLabel(r.reason)} ({r.count})</option>)}
              </select>
            </label>
            <label className="min-w-[200px] flex-1 text-xs text-[#8E98A6]">
              <span className="mb-1 block">Titel</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="z. B. Baureglement" className={`${INPUT} w-full`} />
            </label>
          </div>

          {docsError && <div role="alert" className="rounded-xl border border-[#D87979]/30 bg-[#D87979]/10 px-4 py-3 text-sm text-[#EBA1A1]">{docsError}</div>}

          <div aria-busy={loading} className={loading ? "opacity-60" : ""}>
            {docs?.available && docs.documents.length === 0 && !loading && (
              <p className={`${PANEL} px-4 py-10 text-center text-sm text-[#8E98A6]`}>Keine Dokumente für diese Auswahl.</p>
            )}
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.key} aria-label={`Gemeinde ${group.name}`} className={PANEL}>
                  <h2 className="border-b border-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-semibold text-white">
                    {group.name} <span className="font-normal text-[#8E98A6]">BFS {group.key}</span>
                  </h2>
                  <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
                    {group.docs.map((doc) => (
                      <DocumentRow key={doc.id} doc={doc} busy={busy} onDecide={(d, decision) => setPending({ doc: d, decision })} />
                    ))}
                  </ul>
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
