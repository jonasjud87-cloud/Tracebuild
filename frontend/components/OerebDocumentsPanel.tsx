"use client";

import { useState } from "react";
import type { OerebDocumentItem } from "@/lib/geoadmin/contract";
import { documentSummaryLine, formatDate, rejectReasonLabel, summarizeDocuments } from "./geoportal-logic";
import { useOerebSync } from "./useOerebDocumentSync";

const STATUS: Record<OerebDocumentItem["status"], { label: string; color: string; bg: string }> = {
  imported:         { label: "importiert",           color: "#34D399", bg: "rgba(52,211,153,0.12)"  },
  pending:          { label: "offen",                color: "#85A6E9", bg: "rgba(133,166,233,0.1)"  },
  rejected:         { label: "herausgefiltert",      color: "#ABAEBB", bg: "rgba(133,166,233,0.1)"  },
  failed:           { label: "Fehler",               color: "#F87171", bg: "rgba(248,113,113,0.12)" },
  duplicate_manual: { label: "bereits von Hand erfasst", color: "#ABAEBB", bg: "rgba(133,166,233,0.1)" },
  removed:          { label: "vom Admin entfernt",   color: "#7B8299", bg: "rgba(133,166,233,0.1)"  },
  review:           { label: "zur Prüfung",          color: "#85A6E9", bg: "rgba(133,166,233,0.1)"  },
};

function statusFor(item: OerebDocumentItem) {
  if (item.status === "rejected" && item.reject_reason === "scan_or_short") {
    return { label: "Scan", color: "#FBBF24", bg: "rgba(251,191,36,0.12)" };
  }
  return STATUS[item.status] ?? STATUS.rejected;
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
                  <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#fff", textDecoration: "none", overflowWrap: "anywhere" }}>
                    {item.title} <span style={{ color: "#85A6E9" }}>↗</span>
                  </a>
                </div>
                <p style={{ fontSize: 11, color: "#7B8299", margin: "3px 0 0", lineHeight: 1.45, overflowWrap: "anywhere" }}>
                  {[
                    item.status === "rejected" ? `Grund: ${rejectReasonLabel(item.reject_reason)}` : null,
                    item.status !== "imported" ? item.reject_detail : null,
                    item.scope === "parcel" ? "gilt nur für dieses Grundstück" : item.scope === "municipal" ? "gilt für die Gemeinde" : null,
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
