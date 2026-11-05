"use client";

import Link from "next/link";
import type { ExtractStatus } from "@/lib/geoadmin/contract";
import { extractStatusInfo, formatDate, type NoticeTone } from "./geoportal-logic";

const TONES: Record<NoticeTone, { color: string; bg: string; border: string }> = {
  error: { color: "#F87171", bg: "rgba(248,113,113,0.06)", border: "rgba(248,113,113,0.25)" },
  warn:  { color: "#FBBF24", bg: "rgba(251,191,36,0.06)",  border: "rgba(251,191,36,0.2)"  },
  info:  { color: "#85A6E9", bg: "rgba(133,166,233,0.05)", border: "rgba(133,166,233,0.15)" },
};

/** Status ungleich `ok`, immer in Worten und mit dem, was der Nutzer tun kann. */
export default function OerebStatusNotice({ status, canton, detail, pdfUrl, attemptAt, projectId, isAdmin, hideChoose = false, children }: {
  status: ExtractStatus;
  canton: string | null | undefined;
  detail?: string | null;
  pdfUrl?: string | null;
  attemptAt?: string | null;
  projectId: string;
  isAdmin: boolean;
  /** Die Parzellenwahl steht bereits daneben. */
  hideChoose?: boolean;
  /** Aktion rechts, etwa «ÖREB abrufen». */
  children?: React.ReactNode;
}) {
  const info = extractStatusInfo(status, canton);
  const tone = TONES[info.tone];
  const attempt = formatDate(attemptAt);
  const choose = info.choose && !hideChoose;

  return (
    <div style={{ background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: tone.color, margin: 0 }}>{info.title}</p>
        <p style={{ fontSize: 12, color: "#ABAEBB", margin: "2px 0 0", lineHeight: 1.45 }}>
          {info.text}{attempt ? ` Letzter Versuch: ${attempt}.` : ""}
        </p>
        {info.showDetail && detail && (
          <p style={{ fontSize: 11, color: "#7B8299", margin: "3px 0 0", overflowWrap: "anywhere" }}>Meldung des Dienstes: {detail}</p>
        )}
        {(choose || (info.offerPdf && pdfUrl)) && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
            {info.offerPdf && pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#85A6E9", textDecoration: "none" }}>
                Amtlicher PDF-Auszug ↗
              </a>
            )}
            {choose && (isAdmin ? (
              <Link href={`/projects/${projectId}/settings#parzelle`} style={{ fontSize: 12, color: "#85A6E9", textDecoration: "none" }}>
                Grundstück in den Einstellungen wählen →
              </Link>
            ) : (
              <span style={{ fontSize: 12, color: "#7B8299" }}>Das Grundstück kann ein Organisations-Admin in den Einstellungen wählen.</span>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
