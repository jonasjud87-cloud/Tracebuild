"use client";

import { useState } from "react";
import type { OerebDocumentItem } from "@/lib/geoadmin/contract";
import { api } from "@/lib/api";
import { AI_READ_LABEL } from "@/lib/oereb/ai-read-label";
import { REVIEW_LABEL, documentNotices, documentSummaryLine, formatDate, rejectReasonLabel, safeExternalUrl, summarizeDocuments } from "./geoportal-logic";
import { useOerebSync } from "./useOerebDocumentSync";
import { useOrgRole } from "./useOrgRole";
import p from "@/app/projects/project.module.css";
import n from "@/app/projects/[id]/norms/norms.module.css";

const STATUS: Record<OerebDocumentItem["status"], { label: string; chip: string }> = {
  imported:         { label: "importiert",           chip: p.chipOk },
  pending:          { label: "offen",                chip: p.chipInfo },
  rejected:         { label: "herausgefiltert",      chip: p.chip },
  failed:           { label: "Fehler",               chip: p.chipErr },
  duplicate_manual: { label: "bereits von Hand erfasst", chip: p.chip },
  removed:          { label: "vom Admin entfernt",   chip: p.chip },
  review:           { label: REVIEW_LABEL,           chip: p.chipInfo },
};

function statusFor(item: OerebDocumentItem) {
  if (item.status === "rejected" && item.reject_reason === "scan_or_short") {
    return { label: "Scan", chip: p.chipWarn };
  }
  return STATUS[item.status] ?? STATUS.rejected;
}

/** Titel als Link zum amtlichen PDF. Unbrauchbare Adressen bleiben reiner Text. */
function DocumentLink({ item }: { item: OerebDocumentItem }) {
  const href = safeExternalUrl(item.url);
  if (!href) return <span style={{ color: "var(--ink)", overflowWrap: "anywhere" }}>{item.title}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={n.plainLink}>
      {item.title} <span aria-hidden="true">↗</span>
      <span className={p.srOnly}> (amtliches PDF, öffnet in neuem Fenster)</span>
    </a>
  );
}

type Decision = "force_import" | "exclude" | "recheck";

const DECISIONS: { decision: Decision; label: string; confirm: string }[] = [
  { decision: "force_import", label: "Trotzdem importieren", confirm: "Dieses Dokument wird als globale Norm importiert und gilt für alle Organisationen. Fortfahren?" },
  { decision: "exclude", label: "Ausschliessen", confirm: "Dieses Dokument wird für alle Organisationen ausgeschlossen, seine Norm gilt nicht mehr. Fortfahren?" },
  { decision: "recheck", label: "Neu prüfen", confirm: "Frühere Entscheide werden aufgehoben und das Dokument nach den normalen Regeln neu beurteilt. Fortfahren?" },
];

/** Nur für Plattform-Admins: Die Route lässt sonst niemanden zu. Wirkt global, darum mit Rückfrage. */
function DocumentActions({ item }: { item: OerebDocumentItem }) {
  const { role } = useOrgRole();
  const { state, run, reloadDocuments } = useOerebSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (role !== "super_admin") return null;

  async function decide({ decision, confirm }: (typeof DECISIONS)[number]) {
    if (!window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/oereb-imports/${item.id}/decision`, { decision });
      const documents = await reloadDocuments();
      if (documents?.available && documents.pending > 0) void run(documents.pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Der Entscheid konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={n.docActions}>
      {DECISIONS.map((d) => (
        <button
          key={d.decision}
          type="button"
          disabled={busy || state.running || (d.decision === "force_import" && item.status === "imported") || (d.decision === "exclude" && item.manual_decision === "exclude")}
          onClick={() => void decide(d)}
          className={`${p.btnGhost} ${p.btnSm}`}
        >
          {d.label}
        </button>
      ))}
      {error && <span role="alert" className={n.noticeDetail} style={{ color: "var(--err-text)", fontWeight: 600 }}>{error}</span>}
    </span>
  );
}

/** Gründe, die Nutzer eher überraschen: Hier stehen die Titel gleich offen da. */
const OPEN_REASONS = new Set(["decision_document"]);

function DocumentNoticeBlocks({ items }: { items: OerebDocumentItem[] }) {
  const { scans, review, rejected, skipped, bothKept } = documentNotices(items);
  const rejectedCount = rejected.reduce((sum, group) => sum + group.items.length, 0);
  const skippedCount = skipped.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <>
      {scans.length > 0 && (
        <div className={`${n.inlineNotice} ${n.toneWarn}`}>
          <div>
            <p className={n.noticeTitle}>
              {scans.length === 1 ? "Reglement nicht geprüft, weil Scan" : `${scans.length} Reglemente nicht geprüft, weil Scan`}
            </p>
            <p className={n.noticeText}>
              Das PDF enthält keinen oder zu wenig lesbaren Text, darum fehlt es in der Analyse. Bitte das amtliche PDF von Hand prüfen.
            </p>
            <ul className={n.noticeList}>
              {scans.map((item) => <li key={item.id}><DocumentLink item={item} /></li>)}
            </ul>
          </div>
        </div>
      )}
      {review.length > 0 && (
        <div className={`${n.inlineNotice} ${n.toneInfo}`}>
          <div>
            <p className={n.noticeTitle}>
              {review.length === 1 ? `1 Dokument ${REVIEW_LABEL}` : `${review.length} Dokumente ${REVIEW_LABEL}`}
            </p>
            <p className={n.noticeText}>Der Titel nennt ein Reglement, im Text wurden aber keine Artikel erkannt. Es fehlt deshalb in der Analyse, bis es jemand angesehen hat.</p>
            <ul className={n.noticeList}>
              {review.map((item) => (
                <li key={item.id}>
                  <DocumentLink item={item} />
                  {item.reject_detail && <span className={n.noticeDetail}>{item.reject_detail}</span>}
                  <DocumentActions item={item} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {bothKept.length > 0 && (
        <div className={`${n.inlineNotice} ${n.toneInfo}`}>
          <div>
            <p className={n.noticeTitle}>Beide Fassungen übernommen</p>
            <p className={n.noticeText}>TraceBuild konnte nicht sicher entscheiden, welche Fassung gilt. Die Analyse prüft gegen beide. Bitte beurteilen, welche massgebend ist.</p>
            <ul className={n.noticeList}>
              {bothKept.map((item) => (
                <li key={item.id}>
                  <DocumentLink item={item} />
                  <span className={n.noticeDetail}>{item.version_note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {rejectedCount > 0 && (
        <div className={`${n.inlineNotice} ${n.toneWarn}`}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className={n.noticeTitle}>
              {rejectedCount === 1 ? "1 Dokument abgelehnt, bitte prüfen" : `${rejectedCount} Dokumente abgelehnt, bitte prüfen`}
            </p>
            {rejected.map((group) => (
              <details key={group.reason} open={OPEN_REASONS.has(group.reason)} style={{ marginTop: 6 }}>
                <summary className={n.summaryLine}>
                  {group.items.length} × {group.label}
                </summary>
                <ul className={n.noticeList} style={{ marginLeft: 12 }}>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <DocumentLink item={item} />
                      {item.reject_detail && <span className={n.noticeDetail}>{item.reject_detail}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </div>
      )}
      {skippedCount > 0 && (
        <div className={`${n.inlineNotice} ${n.toneQuiet}`}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className={n.noticeTitle}>
              {skippedCount === 1 ? "1 Dokument bewusst ausgelassen" : `${skippedCount} Dokumente bewusst ausgelassen`}
            </p>
            <p className={n.noticeText}>Kein Fehler: Diese Dokumente gehören nicht in den automatischen Import.</p>
            {skipped.map((group) => (
              <details key={group.category} style={{ marginTop: 6 }}>
                <summary className={n.summaryLine}>
                  {group.items.length} × {group.label}
                </summary>
                <p className={n.noticeDetail} style={{ marginLeft: 12 }}>{group.hint}</p>
                <ul className={n.noticeList} style={{ marginLeft: 12 }}>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <DocumentLink item={item} />
                      {item.reject_detail && <span className={n.noticeDetail}>{item.reject_detail}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Reglemente aus dem Auszug dieses Grundstücks. Nur Anzeige: Der Import läuft ohne Bestätigung. */
export default function OerebDocumentsPanel() {
  const { state } = useOerebSync();
  const [open, setOpen] = useState(false);
  const { documents, documentsError, running, progress } = state;

  const shell = (body: React.ReactNode, summary?: string) => (
    <section id="reglemente" aria-label="Reglemente aus dem ÖREB-Kataster" className={`${p.glassFlat} ${p.card}`} style={{ scrollMarginTop: 110 }}>
      <h2 className={n.panelTitle}>Reglemente aus dem ÖREB-Kataster</h2>
      {summary && <p className={n.panelSummary}>{summary}</p>}
      {body}
    </section>
  );

  if (documentsError) {
    return shell(null, `Der Stand des Imports konnte nicht geladen werden. Bitte die Seite später neu laden. Meldung: ${documentsError}`);
  }
  if (!documents) return shell(null, "Wird geladen…");
  if (!documents.available) {
    return shell(null, "Der automatische Import ist noch nicht aktiv. Die Normen des Projekts sind davon nicht betroffen.");
  }
  if (documents.items.length === 0) {
    return shell(null, running ? "Wird geprüft…" : "Der aktuelle Auszug nennt keine Dokumente für den Import, oder es liegt noch kein Auszug vor.");
  }

  const summary = documentSummaryLine(summarizeDocuments(documents.items));
  const runningText = running && progress?.total ? `Import läuft (${progress.processed}/${progress.total}). ` : "";

  return shell(
    <>
      <DocumentNoticeBlocks items={documents.items} />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={n.docToggle}
      >
        <svg aria-hidden="true" width="14" height="14" className={`${n.chev} ${open ? n.chevRight : ""}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M9 5l7 7-7 7" />
        </svg>
        {open ? "Dokumente ausblenden" : `${documents.items.length} Dokumente anzeigen`}
      </button>
      {open && (
        <ul className={n.docList}>
          {documents.items.map((item) => {
            const status = statusFor(item);
            const checked = formatDate(item.last_checked_at);
            return (
              <li key={item.id} className={n.docItem}>
                <div className={n.themeLine}>
                  <span className={status.chip}>{status.label}</span>
                  {item.text_source === "ai_read" && <span className={p.chipWarn}>{AI_READ_LABEL}</span>}
                  <a href={safeExternalUrl(item.url) ?? undefined} target="_blank" rel="noreferrer" className={n.plainLink} style={{ fontSize: 15 }}>
                    {item.title} <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <p className={n.docMeta}>
                  {[
                    item.status === "rejected" || item.status === "review" ? `Grund: ${rejectReasonLabel(item.reject_reason)}` : null,
                    item.status !== "imported" ? item.reject_detail : null,
                    item.scope === "parcel" ? "gilt nur für dieses Grundstück" : item.scope === "municipal" ? "gilt für die Gemeinde" : null,
                    item.version_note ?? null,
                    item.last_update_status === "rejected_shrink" ? "neue Fassung abgelehnt, bisheriger Stand bleibt" : null,
                    item.last_update_status === "fetch_failed" ? "letzte Prüfung fehlgeschlagen, bisheriger Stand bleibt" : null,
                    checked ? `Stand ${checked}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                <DocumentActions item={item} />
              </li>
            );
          })}
        </ul>
      )}
    </>,
    runningText + summary,
  );
}
