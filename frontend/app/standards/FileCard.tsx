"use client";

import { useEffect, useId, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { authoritativeErrorText, formatDate, safeExternalUrl, similarityPercent } from "@/components/geoportal-logic";
import type { NormSupersession } from "@/lib/geoadmin/contract";
import type { FileEntry } from "@/lib/standards-model";
import { CalendarIcon } from "@/components/dashboard/icons";
import { EyeIcon, EyeOffIcon, FileIcon, TrashIcon } from "./icons";
import CompanyBlock from "./CompanyBlock";
import type { ProjectOption } from "./ScopeFields";
import { priorityLabel } from "@/lib/company-norms";
import s from "./standards.module.css";

function VersionHint({ info, onChange }: { info: NormSupersession; onChange: (authoritative: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(authoritative: boolean) {
    if (authoritative && !confirm("Ihre Fassung als massgebend festlegen? Die Projekte Ihrer Organisation verwenden dann Ihren Upload statt des amtlichen Texts.")) return;
    setBusy(true);
    setProblem(null);
    try {
      await onChange(authoritative);
    } catch (e) {
      setProblem(authoritativeErrorText(e instanceof ApiError ? e.status : undefined));
    } finally {
      setBusy(false);
    }
  }

  const authoritative = info.version_hint === "org_authoritative";
  const officialUrl = safeExternalUrl(info.official?.source_url);
  const percent = similarityPercent(info.superseded_similarity);
  const since = formatDate(info.superseded_at);

  return (
    <div className={`${s.hint} ${authoritative ? s.hintOk : s.hintInfo}`}>
      <p className={s.hintTitle}>{authoritative ? "Ihre Fassung ist massgebend" : "Neuere amtliche Fassung verwendet"}</p>
      <p className={s.hintText}>
        {authoritative
          ? "Die Projekte Ihrer Organisation verwenden diesen Upload, auch wenn ein ähnlicher amtlicher Text vorliegt."
          : `Die Projekte verwenden den amtlichen Text. Ihr Upload bleibt gespeichert, zählt aber nicht mehr in der Analyse.${percent !== null ? ` ${percent} % davon stehen im amtlichen Text.` : ""}${since ? ` Stand ${since}.` : ""}`}
      </p>
      {info.official && (
        <p className={s.hintText}>
          Amtlich:{" "}
          {officialUrl ? (
            <a href={officialUrl} target="_blank" rel="noreferrer" className={s.hintLink}>
              {info.official.title} <span aria-hidden="true">↗</span>
            </a>
          ) : (
            info.official.title
          )}
        </p>
      )}
      <div className={s.hintAction}>
        <button type="button" disabled={busy} onClick={() => run(!authoritative)} className={s.btnGhost}>
          {busy ? "Wird gespeichert…" : authoritative ? "Festlegung zurücknehmen" : "Meine Fassung als massgebend festlegen"}
        </button>
      </div>
      {problem && (
        <p role="alert" className={`${s.notice} ${s.noticeErr}`} style={{ marginTop: 8 }}>
          {problem}
        </p>
      )}
    </div>
  );
}

interface Props {
  entry: FileEntry;
  onDelete: (ids: string[]) => void;
  onAuthoritative: (ids: string[], authoritative: boolean) => Promise<void>;
  projects?: ProjectOption[];
  canApprove?: boolean;
  onChanged?: () => Promise<void>;
}

export default function FileCard({ entry, onDelete, onAuthoritative, projects = [], canApprove = false, onChanged }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const detailId = useId();

  useEffect(() => {
    if (!expanded || text !== null) return;
    let active = true;
    Promise.all(entry.ids.map((id) => api.get<{ text: string }>(`/standards/${id}`)))
      .then((rows) => {
        if (active) setText(rows.map((r) => r.text).join("\n\n"));
      })
      .catch(() => {
        if (active) setText("Text konnte nicht geladen werden. Bitte später erneut versuchen.");
      });
    return () => {
      active = false;
    };
  }, [expanded, text, entry.ids]);

  const label = entry.source_url || entry.category;
  const date = formatDate(entry.createdAt);
  const company = entry.company;
  const canDelete = !entry.global && (!company || company.status === "draft" || canApprove);

  return (
    <li className={s.row}>
      <div className={s.rowMain}>
        <span className={s.fileIcon} aria-hidden="true">
          <FileIcon size={22} />
        </span>
        <div className={s.chips}>
          {entry.global && (
            <span className={`${s.chip} ${s.chipGlobal}`} title="Von TraceBuild für alle Organisationen hinterlegt">
              Global
            </span>
          )}
          <span className={`${s.chip} ${s.chipLevel}`}>{entry.jurisdiction_name ?? "—"}</span>
          <span className={`${s.chip} ${s.chipCat}`}>{entry.category}</span>
          {entry.zone && <span className={`${s.chip} ${s.chipCat}`}>Zone {entry.zone}</span>}
          {company && (
            <>
              <span className={`${s.chip} ${company.archived ? s.chipAdvisory : company.status === "draft" ? s.chipDraft : s.chipApproved}`}>
                {company.archived ? "Archiviert" : company.status === "draft" ? "Entwurf" : "Freigegeben"}
              </span>
              <span className={`${s.chip} ${s.chipAdvisory}`}>Version {company.versionNo}</span>
              <span className={`${s.chip} ${company.priority === "binding" ? s.chipBinding : s.chipAdvisory}`}>{priorityLabel(company.priority)}</span>
            </>
          )}
        </div>
        <span className={s.name}>{entry.title || entry.source_url || "—"}</span>
        <span className={s.date}>
          <CalendarIcon size={18} />
          <span className={s.sr}>Hochgeladen am </span>
          <span>{date ?? "–"}</span>
        </span>
        <div className={s.actions}>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className={s.iconBtn}
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={`${expanded ? "Inhalt verbergen" : "Inhalt anzeigen"}: ${label}`}
            title={expanded ? "Inhalt verbergen" : "Inhalt anzeigen"}
          >
            {expanded ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(entry.ids)}
              className={`${s.iconBtn} ${s.dangerBtn}`}
              aria-label={`Löschen: ${label}`}
              title="Löschen"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
      {company && onChanged && <CompanyBlock entry={entry} projects={projects} canApprove={canApprove} onChanged={onChanged} />}
      {entry.supersession && <VersionHint info={entry.supersession} onChange={(value) => onAuthoritative(entry.ids, value)} />}
      <div id={detailId} hidden={!expanded}>
        {expanded && (
          <div className={s.detail}>
            <p className={s.detailText}>{text ?? "Text wird geladen …"}</p>
            {entry.pdf_url && (
              <div>
                <iframe src={entry.pdf_url} className={s.pdfFrame} title={`PDF-Vorschau ${entry.source_url ?? entry.category}`} />
                <a href={entry.pdf_url} target="_blank" rel="noreferrer" className={s.pdfLink}>
                  Original-PDF öffnen ↗
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
