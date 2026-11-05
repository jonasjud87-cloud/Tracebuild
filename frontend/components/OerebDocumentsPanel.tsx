"use client";

import { useState } from "react";
import type { OerebDocumentItem } from "@/lib/geoadmin/contract";
import { documentNotices, documentSummaryLine, formatDate, rejectReasonLabel, safeExternalUrl, summarizeDocuments } from "./geoportal-logic";
import { useOerebSync } from "./useOerebDocumentSync";

const STATUS: Record<OerebDocumentItem["status"], { label: string; color: string; bg: string }> = {
  imported:         { label: "importiert",           color: "#34D399", bg: "rgba(52,211,153,0.12)"  },
  pending:          { label: "offen",                color: "#85A6E9", bg: "rgba(133,166,233,0.1)"  },
  rejected:         { label: "herausgefiltert",      color: "#ABAEBB", bg: "rgba(133,166,233,0.1)"  },
  failed:           { label: "Fehler",               color: "#F87171", bg: "rgba(248,113,113,0.12)" },
  duplicate_manual: { label: "bereits von Hand erfasst", color: "#ABAEBB", bg: "rgba(133,166,233,0.1)" },
  removed:          { label: "vom Admin entfernt",   color: "#7B8299", bg: "rgba(133,166,233,0.1)"  },
};

function statusFor(item: OerebDocumentItem) {
  if (item.status === "rejected" && item.reject_reason === "scan_or_short") {
    return { label: "Scan", color: "#FBBF24", bg: "rgba(251,191,36,0.12)" };
  }
  return STATUS[item.status] ?? STATUS.rejected;
}

/** Titel als Link zum amtlichen PDF. Unbrauchbare Adressen bleiben reiner Text. */
function DocumentLink({ item }: { item: OerebDocumentItem }) {
  const href = safeExternalUrl(item.url);
  if (!href) return <span style={{ color: "#fff", overflowWrap: "anywhere" }}>{item.title}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline", textDecorationColor: "rgba(133,166,233,0.5)", textUnderlineOffset: 2, overflowWrap: "anywhere" }}>
      {item.title} <span aria-hidden="true" style={{ color: "#85A6E9" }}>↗</span>
      <span className="sr-only"> (amtliches PDF, öffnet in neuem Fenster)</span>
    </a>
  );
}

const NOTICE_HEAD: React.CSSProperties = { fontSize: 12, fontWeight: 600, margin: 0 };
const NOTICE_TEXT: React.CSSProperties = { fontSize: 12, color: "#ABAEBB", margin: "3px 0 0", lineHeight: 1.45 };
const NOTICE_LIST: React.CSSProperties = { listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4, fontSize: 12 };
const NOTICE_DETAIL: React.CSSProperties = { display: "block", color: "#7B8299", fontSize: 11, overflowWrap: "anywhere" };

/** Gründe, die Nutzer eher überraschen: Hier stehen die Titel gleich offen da. */
const OPEN_REASONS = new Set(["older_version", "decision_document"]);

function DocumentNoticeBlocks({ items }: { items: OerebDocumentItem[] }) {
  const { scans, rejected, bothKept } = documentNotices(items);
  const rejectedCount = rejected.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <>
      {scans.length > 0 && (
        <div style={{ marginTop: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          <p style={{ ...NOTICE_HEAD, color: "#FBBF24" }}>
            {scans.length === 1 ? "Reglement nicht geprüft, weil Scan" : `${scans.length} Reglemente nicht geprüft, weil Scan`}
          </p>
          <p style={NOTICE_TEXT}>
            Das PDF enthält keinen oder zu wenig lesbaren Text, darum fehlt es in der Analyse. Bitte das amtliche PDF von Hand prüfen.
          </p>
          <ul style={NOTICE_LIST}>
            {scans.map((item) => <li key={item.id}><DocumentLink item={item} /></li>)}
          </ul>
        </div>
      )}
      {bothKept.length > 0 && (
        <div style={{ marginTop: 10, background: "rgba(133,166,233,0.08)", border: "1px solid rgba(133,166,233,0.25)", borderRadius: 8, padding: "8px 12px" }}>
          <p style={{ ...NOTICE_HEAD, color: "#85A6E9" }}>Beide Fassungen übernommen</p>
          <p style={NOTICE_TEXT}>TraceBuild konnte nicht sicher entscheiden, welche Fassung gilt. Die Analyse prüft gegen beide. Bitte beurteilen, welche massgebend ist.</p>
          <ul style={NOTICE_LIST}>
            {bothKept.map((item) => (
              <li key={item.id}>
                <DocumentLink item={item} />
                <span style={NOTICE_DETAIL}>{item.version_note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rejectedCount > 0 && (
        <div style={{ marginTop: 10, background: "rgba(133,166,233,0.05)", border: "1px solid rgba(133,166,233,0.15)", borderRadius: 8, padding: "8px 12px" }}>
          <p style={{ ...NOTICE_HEAD, color: "#fff" }}>
            {rejectedCount === 1 ? "1 Dokument nicht übernommen" : `${rejectedCount} Dokumente nicht übernommen`}
          </p>
          {rejected.map((group) => (
            <details key={group.reason} open={OPEN_REASONS.has(group.reason)} style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 12, color: "#ABAEBB", cursor: "pointer", lineHeight: 1.6 }}>
                {group.items.length} × {group.label}
              </summary>
              <ul style={{ ...NOTICE_LIST, marginLeft: 12 }}>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <DocumentLink item={item} />
                    {item.reject_detail && <span style={NOTICE_DETAIL}>{item.reject_detail}</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
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
    <section id="reglemente" aria-label="Reglemente aus dem ÖREB-Kataster" style={{ marginBottom: 20, background: "rgba(23,37,64,0.35)", border: "1px solid rgba(133,166,233,0.15)", borderRadius: 12, padding: "12px 16px", scrollMarginTop: 110 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0 }}>Reglemente aus dem ÖREB-Kataster</p>
      {summary && <p style={{ fontSize: 12, color: "#ABAEBB", margin: "3px 0 0", lineHeight: 1.45 }}>{summary}</p>}
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
        style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6, minHeight: 28, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "#85A6E9" }}
      >
        <svg aria-hidden="true" style={{ width: 11, height: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {open ? "Dokumente ausblenden" : `${documents.items.length} Dokumente anzeigen`}
      </button>
      {open && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {documents.items.map((item) => {
            const status = statusFor(item);
            const checked = formatDate(item.last_checked_at);
            return (
              <li key={item.id} style={{ borderLeft: "2px solid rgba(133,166,233,0.2)", paddingLeft: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: status.bg, color: status.color, whiteSpace: "nowrap" }}>{status.label}</span>
                  <a href={safeExternalUrl(item.url) ?? undefined} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#fff", textDecoration: "none", overflowWrap: "anywhere" }}>
                    {item.title} <span style={{ color: "#85A6E9" }}>↗</span>
                  </a>
                </div>
                <p style={{ fontSize: 11, color: "#7B8299", margin: "3px 0 0", lineHeight: 1.45, overflowWrap: "anywhere" }}>
                  {[
                    item.status === "rejected" ? `Grund: ${rejectReasonLabel(item.reject_reason)}` : null,
                    item.status !== "imported" ? item.reject_detail : null,
                    item.scope === "parcel" ? "gilt nur für dieses Grundstück" : item.scope === "municipal" ? "gilt für die Gemeinde" : null,
                    item.version_note ?? null,
                    item.last_update_status === "rejected_shrink" ? "neue Fassung abgelehnt, bisheriger Stand bleibt" : null,
                    item.last_update_status === "fetch_failed" ? "letzte Prüfung fehlgeschlagen, bisheriger Stand bleibt" : null,
                    checked ? `Stand ${checked}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </>,
    runningText + summary,
  );
}
