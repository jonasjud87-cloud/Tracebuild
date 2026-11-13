"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckSummary, DraftDetail, NormWatchOverview, SourceView } from "@/lib/norm-watch/types";
import { Card, CardError, CardSkeleton, focusRing } from "../overview/CardFrame";
import { fetchEnvelope, useResource } from "../overview/resource";
import {
  findUnwatched,
  groupByJurisdiction,
  groupCounts,
  groupLabel,
  supportedProvider,
  type PlatformNorm,
  type UnwatchedNorm,
} from "./norm-watch-groups";
import { PROVIDER_LABEL, STATUS_META, callApi, formatDateTime } from "./norm-watch-meta";
import { groupTone } from "./library-filter";

type Banner = { tone: "ok" | "error"; text: string } | null;

type DraftState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: DraftDetail };

const OVERVIEW_URL = "/api/v1/admin/norm-watch";
const NORMS_URL = "/api/v1/admin/norms?platform_only=true&limit=500";

const loadOverview = () => fetchEnvelope<NormWatchOverview>(OVERVIEW_URL, "Normabgleich konnte nicht geladen werden.");

const btn = `rounded-xl border border-[#8c8b8e] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#151414] hover:border-[#151414] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const btnDark = `rounded-xl bg-[#151414] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#2e2e30] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const inputCls =
  "w-full rounded-lg border border-[#8c8b8e] bg-white px-3 py-2 text-sm text-[#151414] focus:border-[#151414] focus:outline-none focus:ring-2 focus:ring-[#cbbfae]/55";

function checkMessage(s: CheckSummary): string {
  const parts = [`${s.checked} Quellen geprüft`];
  if (s.draftsCreated > 0) parts.push(`${s.draftsCreated} neue Entwürfe`);
  if (s.adopted > 0) parts.push(`${s.adopted} ohne inhaltliche Änderung übernommen`);
  if (s.errors > 0) parts.push(`${s.errors} Fehler`);
  if (s.skipped > 0) parts.push(`${s.skipped} wegen Zeitlimit übersprungen, bitte erneut prüfen`);
  return parts.join(", ");
}

function draftWarning(d: DraftDetail): string | null {
  const ratio = d.oldChars > 0 ? d.newChars / d.oldChars : null;
  if (d.similarity !== null && d.similarity < 0.5) return "Der neue Text stimmt nur zu weniger als der Hälfte mit dem bisherigen überein.";
  if (ratio !== null && ratio < 0.6) return "Der neue Text ist deutlich kürzer als der bisherige. Möglicherweise fehlen Teile.";
  return null;
}

function DraftBox({
  state,
  busy,
  onApprove,
  onReject,
}: {
  state: DraftState;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (state.status === "loading") return <CardSkeleton rows={2} />;
  if (state.status === "error") return <p role="alert" className="text-sm text-[#a3201a]">{state.message}</p>;
  const d = state.detail;
  const similarity = d.similarity === null ? null : Math.round(d.similarity * 1000) / 10;
  const warning = draftWarning(d);
  const open = d.status === "draft";
  return (
    <div className="space-y-3 rounded-xl border border-[rgba(21,20,20,.12)] bg-white/70 p-4">
      {warning && (
        <p role="alert" className="rounded-lg bg-[#fff1d6] px-3 py-2 text-sm font-semibold text-[#7a4f00]">
          {warning} Bitte vor der Freigabe prüfen.
        </p>
      )}
      {!open && <p className="text-sm font-semibold text-[#a3201a]">Dieser Entwurf ist bereits entschieden.</p>}
      {d.diff.note && <p className="text-[13px] text-[var(--tba-text-2,#46464a)]">{d.diff.note}</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-[#151414]">
          {d.appliedLabel ?? "Bisheriger Stand"} → {d.remoteLabel}
        </p>
        <p className="text-[13px] text-[var(--tba-text-2,#46464a)]">
          {d.oldChars.toLocaleString("de-CH")} → {d.newChars.toLocaleString("de-CH")} Zeichen
          {similarity !== null ? `, ${similarity} % Übereinstimmung` : ""}
        </p>
      </div>
      <p className="text-[13px] text-[var(--tba-text-2,#46464a)]">
        {d.diff.added} neue und {d.diff.removed} entfernte Sätze. Beim ersten Abgleich einer Norm weicht der Text oft nur
        durch die Quelle ab (zum Beispiel PDF statt amtlichem Text); Kopfzeilen und Fussnoten zählen dann als Unterschied.
      </p>
      {d.diff.samplesAdded.length > 0 && (
        <div>
          <p className="mb-1 text-[13px] font-semibold text-[#136a40]">Neu in der Fassung</p>
          <ul className="space-y-1 text-[13px] text-[#151414]">
            {d.diff.samplesAdded.map((s, i) => (
              <li key={i} className="rounded-md bg-[#65A88A]/10 px-2 py-1">{s}</li>
            ))}
          </ul>
        </div>
      )}
      {d.diff.samplesRemoved.length > 0 && (
        <div>
          <p className="mb-1 text-[13px] font-semibold text-[#a3201a]">Nur im bisherigen Text</p>
          <ul className="space-y-1 text-[13px] text-[#151414]">
            {d.diff.samplesRemoved.map((s, i) => (
              <li key={i} className="rounded-md bg-[#D87979]/10 px-2 py-1">{s}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className={btnDark} disabled={busy || !open} onClick={onApprove}>
          Freigeben und ersetzen
        </button>
        <button type="button" className={btn} disabled={busy || !open} onClick={onReject}>
          Ablehnen
        </button>
      </div>
      <p className="text-[13px] text-[var(--tba-text-2,#46464a)]">
        Bei der Freigabe wird der bisherige Text archiviert, der neue Text gilt sofort für neue Prüfungen, und ein
        Ankündigungs-Entwurf für die Nutzer wird angelegt (nicht veröffentlicht).
      </p>
    </div>
  );
}

function SourceRow({
  source,
  norms,
  busy,
  draft,
  onToggleDraft,
  onApprove,
  onReject,
  onPause,
  onDelete,
  onLink,
}: {
  source: SourceView;
  norms: PlatformNorm[];
  busy: boolean;
  draft: DraftState | null;
  onToggleDraft: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPause: () => void;
  onDelete: () => void;
  onLink: (normId: string) => void;
}) {
  const meta = STATUS_META[source.status];
  const [pick, setPick] = useState("");
  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[200px] flex-1">
          <p className="text-sm font-semibold text-[#151414]">{source.label}</p>
          <p className="text-[13px] text-[var(--tba-text-2,#46464a)]">
            {PROVIDER_LABEL[source.provider]} {source.identifier}
            {source.normTitle ? ` · ${source.normTitle}` : ""}
          </p>
          {source.status === "error" && source.lastError && (
            <p className="mt-0.5 text-[13px] text-[#a3201a]">{source.lastError}</p>
          )}
        </div>
        <div className="text-[13px] text-[var(--tba-text-2,#46464a)]">
          <p>Stand: {source.appliedLabel ?? "–"}</p>
          <p>Geprüft: {formatDateTime(source.lastCheckedAt)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-medium ${meta.pill}`}>{meta.label}</span>
        <div className="flex flex-wrap gap-2">
          {source.draftId && (
            <button type="button" className={btnDark} disabled={busy} onClick={onToggleDraft} aria-expanded={draft !== null}>
              {draft ? "Entwurf schliessen" : "Entwurf prüfen"}
            </button>
          )}
          <button type="button" className={btn} disabled={busy} onClick={onPause}>
            {source.enabled ? "Pausieren" : "Aktivieren"}
          </button>
          <button type="button" className={btn} disabled={busy} onClick={onDelete}>
            Entfernen
          </button>
        </div>
      </div>
      {source.status === "missing" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[13px] text-[var(--tba-text-2,#46464a)]" htmlFor={`link-${source.id}`}>
            Bestehende Norm zuordnen:
          </label>
          <select
            id={`link-${source.id}`}
            className={`${inputCls} max-w-md`}
            value={pick}
            disabled={busy}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Auswählen oder beim ersten Abgleich neu anlegen</option>
            {norms.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title ?? n.id}
              </option>
            ))}
          </select>
          <button type="button" className={btn} disabled={busy || !pick} onClick={() => onLink(pick)}>
            Zuordnen
          </button>
        </div>
      )}
      {draft && <DraftBox state={draft} busy={busy} onApprove={onApprove} onReject={onReject} />}
    </li>
  );
}

export default function NormWatchPanel() {
  const [overview, reload, loading] = useResource(loadOverview);
  const [banner, setBanner] = useState<Banner>(null);
  const [working, setWorking] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const openTokens = useRef<Record<string, number>>({});
  const tokenCounter = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const [norms, setNorms] = useState<PlatformNorm[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ provider: "fedlex", identifier: "", label: "", normId: "" });

  useEffect(() => {
    let alive = true;
    fetchEnvelope<PlatformNorm[]>(NORMS_URL, "")
      .then((list) => {
        if (alive) setNorms(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<string>) => {
      setWorking(true);
      setBanner(null);
      try {
        const text = await action();
        setBanner({ tone: "ok", text });
      } catch (e) {
        setBanner({ tone: "error", text: e instanceof Error ? e.message : "Aktion fehlgeschlagen." });
      } finally {
        reload();
        setWorking(false);
      }
    },
    [reload],
  );

  const toggleDraft = async (source: SourceView) => {
    if (!source.draftId) return;
    if (drafts[source.id]) {
      delete openTokens.current[source.id];
      setDrafts((d) => {
        const { [source.id]: _removed, ...rest } = d;
        return rest;
      });
      return;
    }
    const token = ++tokenCounter.current;
    openTokens.current[source.id] = token;
    setDrafts((d) => ({ ...d, [source.id]: { status: "loading" } }));
    try {
      const detail = await fetchEnvelope<DraftDetail>(`${OVERVIEW_URL}/drafts/${source.draftId}`, "Entwurf konnte nicht geladen werden.");
      if (openTokens.current[source.id] !== token) return;
      setDrafts((d) => ({ ...d, [source.id]: { status: "ready", detail } }));
    } catch (e) {
      if (openTokens.current[source.id] !== token) return;
      setDrafts((d) => ({ ...d, [source.id]: { status: "error", message: e instanceof Error ? e.message : "Fehler" } }));
    }
  };

  const decide = (source: SourceView, decision: "approve" | "reject") => {
    if (!source.draftId) return;
    const shown = drafts[source.id];
    const warning = shown && shown.status === "ready" ? draftWarning(shown.detail) : null;
    const question =
      decision === "approve"
        ? `${warning ? `${warning}\n\n` : ""}«${source.label}» jetzt durch die neue Fassung ersetzen? Der bisherige Text wird archiviert.`
        : `Entwurf für «${source.label}» ablehnen? Diese Fassung wird nicht erneut vorgeschlagen.`;
    if (!window.confirm(question)) return;
    void run(async () => {
      await callApi(`${OVERVIEW_URL}/drafts/${source.draftId}/decision`, "POST", { decision });
      setDrafts((d) => {
        const { [source.id]: _removed, ...rest } = d;
        return rest;
      });
      return decision === "approve"
        ? "Neue Fassung übernommen. Ein Ankündigungs-Entwurf liegt unter «Ankündigungen» bereit."
        : "Entwurf abgelehnt.";
    });
  };

  const checkAll = () =>
    void run(async () => checkMessage(await callApi<CheckSummary>(`${OVERVIEW_URL}/check`, "POST", {})));

  const startWatch = (norm: UnwatchedNorm) => {
    setForm({
      provider: supportedProvider(norm.jurisdictionType, norm.jurisdictionName) ?? "fedlex",
      identifier: "",
      label: norm.title,
      normId: norm.id,
    });
    setShowAdd(true);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const addSource = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await callApi(OVERVIEW_URL, "POST", {
        provider: form.provider,
        identifier: form.identifier.trim(),
        label: form.label.trim(),
        normId: form.normId || null,
      });
      setForm({ provider: "fedlex", identifier: "", label: "", normId: "" });
      setShowAdd(false);
      return "Quelle hinzugefügt. Sie wird beim nächsten Abgleich geprüft.";
    });
  };

  const groups = overview.status === "ready" ? groupByJurisdiction(overview.data.sources) : [];
  const unwatched = overview.status === "ready" ? groupByJurisdiction(findUnwatched(norms, overview.data.sources)) : [];
  const unwatchedCount = unwatched.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <section id="norm-watch" className="scroll-mt-24">
      <Card
        title="Normabgleich"
        subtitle="Bundes- und Kantonsnormen werden wöchentlich mit Fedlex und der Gesetzessammlung SG verglichen. Neue Fassungen erscheinen als Entwurf und werden erst nach deiner Freigabe ersetzt."
        action={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={working} onClick={() => setShowAdd((v) => !v)} aria-expanded={showAdd}>
              Quelle hinzufügen
            </button>
            <button type="button" className={btnDark} disabled={working} onClick={checkAll}>
              {working ? "Läuft …" : "Jetzt prüfen"}
            </button>
          </div>
        }
      >
        {banner && (
          <p
            role={banner.tone === "error" ? "alert" : "status"}
            className={`mb-3 rounded-lg px-3 py-2 text-sm ${banner.tone === "error" ? "bg-[#fde7e5] text-[#a3201a]" : "bg-[#65A88A]/15 text-[#136a40]"}`}
          >
            {banner.text}
          </p>
        )}

        {showAdd && (
          <form ref={formRef} onSubmit={addSource} className="mb-4 grid gap-3 rounded-xl border border-[rgba(21,20,20,.12)] bg-white/70 p-4 sm:grid-cols-2">
            <label className="text-[13px] font-semibold text-[#151414]">
              Quelle
              <select className={`${inputCls} mt-1`} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                <option value="fedlex">Bund (Fedlex, SR-Nummer)</option>
                <option value="sg">Kanton St. Gallen (sGS-Nummer)</option>
              </select>
            </label>
            <label className="text-[13px] font-semibold text-[#151414]">
              Nummer
              <input
                className={`${inputCls} mt-1`}
                value={form.identifier}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                placeholder={form.provider === "fedlex" ? "814.20" : "731.1"}
                required
              />
            </label>
            <label className="text-[13px] font-semibold text-[#151414] sm:col-span-2">
              Bezeichnung (wird im Titel der Norm verwendet)
              <input
                className={`${inputCls} mt-1`}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Gewässerschutzgesetz (GSchG), SR 814.20"
                required
              />
            </label>
            <label className="text-[13px] font-semibold text-[#151414] sm:col-span-2">
              Bestehende Norm zuordnen (optional)
              <select className={`${inputCls} mt-1`} value={form.normId} onChange={(e) => setForm({ ...form, normId: e.target.value })}>
                <option value="">Keine, beim ersten Abgleich neu anlegen</option>
                {norms.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title ?? n.id}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={btnDark} disabled={working}>
                Hinzufügen
              </button>
            </div>
          </form>
        )}

        {overview.status === "loading" && <CardSkeleton rows={3} />}
        {overview.status === "error" && <CardError message={overview.message} onRetry={reload} />}
        {overview.status === "ready" && (
          <>
            {overview.data.sources.length === 0 ? (
              <p className="text-sm text-[var(--tba-text-2,#46464a)]">Noch keine Quellen eingerichtet.</p>
            ) : (
              <div className="space-y-6" aria-busy={loading}>
                {groups.map((g) => {
                  const counts = groupCounts(g.items);
                  const tone = groupTone(g.label);
                  return (
                    <section key={g.key} aria-label={g.label} className={`overflow-hidden rounded-xl border-2 ${tone.edge}`}>
                      <header className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${tone.bar}`}>
                        <h3 className="text-[15px] font-bold">{g.label}</h3>
                        <span className={`text-[13px] ${tone.sub}`}>
                          {g.items.length} {g.items.length === 1 ? "Quelle" : "Quellen"}
                        </span>
                        {counts.update > 0 && (
                          <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${STATUS_META.update_available.pill}`}>
                            {counts.update} zur Freigabe
                          </span>
                        )}
                        {counts.error > 0 && (
                          <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${STATUS_META.error.pill}`}>{counts.error} Fehler</span>
                        )}
                        {counts.missing > 0 && (
                          <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${STATUS_META.missing.pill}`}>
                            {counts.missing} ohne Norm
                          </span>
                        )}
                      </header>
                      <ul className="divide-y divide-[rgba(21,20,20,.08)] bg-white px-4">
                {g.items.map((s) => (
                  <SourceRow
                    key={s.id}
                    source={s}
                    norms={norms}
                    busy={working}
                    draft={drafts[s.id] ?? null}
                    onToggleDraft={() => void toggleDraft(s)}
                    onApprove={() => decide(s, "approve")}
                    onReject={() => decide(s, "reject")}
                    onPause={() =>
                      void run(async () => {
                        await callApi(`${OVERVIEW_URL}/sources/${s.id}`, "PATCH", { enabled: !s.enabled });
                        return s.enabled ? "Quelle pausiert." : "Quelle aktiviert.";
                      })
                    }
                    onDelete={() => {
                      if (!window.confirm(`Quelle «${s.label}» nicht mehr beobachten? Die Norm selbst bleibt bestehen.`)) return;
                      void run(async () => {
                        await callApi(`${OVERVIEW_URL}/sources/${s.id}`, "DELETE");
                        return "Quelle entfernt.";
                      });
                    }}
                    onLink={(normId) =>
                      void run(async () => {
                        await callApi(`${OVERVIEW_URL}/sources/${s.id}`, "PATCH", { normId });
                        return "Norm zugeordnet. Der nächste Abgleich prüft sie.";
                      })
                    }
                  />
                ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
            {unwatchedCount > 0 && (
              <details className="mt-5 rounded-xl border border-[rgba(21,20,20,.12)] bg-white/60 p-4">
                <summary className={`cursor-pointer text-sm font-semibold text-[#151414] ${focusRing}`}>
                  Manuell hinterlegt, ohne Abgleich ({unwatchedCount})
                </summary>
                <p className="mt-2 text-[13px] text-[var(--tba-text-2,#46464a)]">
                  Diese Bundes- und Kantonsnormen wurden von Hand hochgeladen und werden nicht auf neue Fassungen geprüft. Mit «Abgleich einrichten» legst du eine Quelle dafür an.
                </p>
                <div className="mt-3 space-y-4">
                  {unwatched.map((g) => (
                    <div key={g.key}>
                      <h4 className="text-[13px] font-bold uppercase tracking-wide text-[var(--tba-text-2,#46464a)]">{g.label}</h4>
                      <ul className="divide-y divide-[rgba(21,20,20,.08)]">
                        {g.items.map((n) => {
                          const provider = supportedProvider(n.jurisdictionType, n.jurisdictionName);
                          return (
                            <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-[#151414]">{n.title}</p>
                                <p className="text-[13px] text-[var(--tba-text-2,#46464a)]">{groupLabel(n.jurisdictionType, n.jurisdictionName)}</p>
                              </div>
                              {provider ? (
                                <button type="button" className={btn} disabled={working} onClick={() => startWatch(n)}>
                                  Abgleich einrichten
                                </button>
                              ) : (
                                <span className="text-[13px] text-[var(--tba-text-2,#46464a)]">Für diesen Kanton gibt es noch keine Quelle</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <p className="mt-3 text-[13px] text-[var(--tba-text-2,#46464a)]">
              {overview.data.summary.lastCheckedAt
                ? `Letzter Abgleich: ${formatDateTime(overview.data.summary.lastCheckedAt)}${overview.data.summary.stale ? " (überfällig)" : ""}`
                : "Der Abgleich ist noch nie gelaufen."}
            </p>
          </>
        )}
      </Card>
    </section>
  );
}
