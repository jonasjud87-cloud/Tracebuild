"use client";

import Link from "next/link";
import type { ExtractStatus } from "@/lib/geoadmin/contract";
import { extractStatusInfo, formatDate, type NoticeTone } from "./geoportal-logic";
import g from "./project-geo.module.css";

const TONES: Record<NoticeTone, { box: string; title: string }> = {
  error: { box: g.noticeErr, title: g.noticeTitleErr },
  warn: { box: g.noticeWarn, title: g.noticeTitleWarn },
  info: { box: g.noticeInfo, title: g.noticeTitleInfo },
};

export default function OerebStatusNotice({ status, canton, detail, pdfUrl, attemptAt, projectId, isAdmin, hideChoose = false, children }: {
  status: ExtractStatus;
  canton: string | null | undefined;
  detail?: string | null;
  pdfUrl?: string | null;
  attemptAt?: string | null;
  projectId: string;
  isAdmin: boolean;
  hideChoose?: boolean;
  children?: React.ReactNode;
}) {
  const info = extractStatusInfo(status, canton);
  const tone = TONES[info.tone];
  const attempt = formatDate(attemptAt);
  const choose = info.choose && !hideChoose;

  return (
    <div className={`${g.notice} ${tone.box}`}>
      <div className={g.noticeMain}>
        <p className={`${g.noticeTitle} ${tone.title}`}>{info.title}</p>
        <p className={g.noticeText}>
          {info.text}{attempt ? ` Letzter Versuch: ${attempt}.` : ""}
        </p>
        {info.showDetail && detail && (
          <p className={g.noticeDetail}>Meldung des Dienstes: {detail}</p>
        )}
        {(choose || (info.offerPdf && pdfUrl)) && (
          <div className={g.noticeLinks}>
            {info.offerPdf && pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" className={g.link}>
                Amtlicher PDF-Auszug ↗
              </a>
            )}
            {choose && (isAdmin ? (
              <Link href={`/projects/${projectId}/settings#parzelle`} className={g.link}>
                Grundstück in den Einstellungen wählen →
              </Link>
            ) : (
              <span className={g.noticeText}>Das Grundstück kann ein Organisations-Admin in den Einstellungen wählen.</span>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
