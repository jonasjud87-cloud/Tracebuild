"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AdminNorm } from "./admin-norm-types";

function OwnerBadge({ norm }: { norm: AdminNorm }) {
  if (!norm.org_id) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#cbbfae]/30 px-2 py-0.5 text-[13px] font-semibold text-[#46464a]">
        Plattformweit
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[rgba(21,20,20,0.08)] px-2 py-0.5 text-[13px] font-semibold text-[#46464a]">
      {norm.org_name ?? "Unbekannte Organisation"}
    </span>
  );
}

interface Props {
  norm: AdminNorm;
  watched?: boolean;
  showOwner?: boolean;
  promoting?: boolean;
  onPromote?: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function AdminNormRow({ norm, watched = false, showOwner = false, promoting = false, onPromote, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [normText, setNormText] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || normText !== null) return;
    let active = true;
    api
      .get<{ text: string }>(`/admin/norms/${norm.id}`)
      .then((row) => {
        if (active) setNormText(row.text);
      })
      .catch(() => {
        if (active) setNormText("Text konnte nicht geladen werden. Bitte später erneut versuchen.");
      });
    return () => {
      active = false;
    };
  }, [expanded, normText, norm.id]);

  return (
    <li className="border-b border-[rgba(21,20,20,0.08)] last:border-0">
      <div className="flex items-start gap-3 px-1 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#151414]">{norm.title || norm.source_url || "Ohne Titel"}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[rgba(21,20,20,0.08)] px-2 py-0.5 text-[13px] text-[#46464a]">{norm.category}</span>
            {norm.zone && (
              <span className="rounded-full bg-[#fff1d6] px-2 py-0.5 text-[13px] font-medium text-[#7a4f00]">Zone {norm.zone}</span>
            )}
            {showOwner && <OwnerBadge norm={norm} />}
            {watched && (
              <span className="rounded-full bg-[#65A88A]/15 px-2 py-0.5 text-[13px] font-semibold text-[#136a40]">Abgleich aktiv</span>
            )}
            {norm.pdf_url && (
              <span className="rounded-full bg-[#cbbfae]/30 px-2 py-0.5 text-[13px] font-semibold text-[#6b6153]">PDF</span>
            )}
            {norm.promoted_from_org_id && (
              <span className="text-[13px] italic text-[#46464a]">
                ursprünglich von {norm.promoted_from_org_name ?? "unbekannter Organisation"}
              </span>
            )}
          </div>
          {expanded && (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#46464a]">{normText ?? "Text wird geladen …"}</p>
              {norm.pdf_url && (
                <div className="mt-2">
                  <iframe
                    src={norm.pdf_url}
                    className="w-full rounded-lg border border-[rgba(21,20,20,0.15)]"
                    style={{ height: 480 }}
                    title={`PDF-Vorschau ${norm.title ?? norm.source_url ?? norm.category}`}
                  />
                  <a
                    href={norm.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm text-[#6b6153] transition-colors hover:text-[#151414]"
                  >
                    Original-PDF öffnen ↗
                  </a>
                </div>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-1 text-sm text-[#6b6153] transition-colors hover:text-[#151414]"
          >
            {expanded ? "Inhalt verbergen ▲" : "Inhalt anzeigen ▼"}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {norm.org_id && onPromote && (
            <button
              type="button"
              onClick={() => onPromote(norm.id)}
              disabled={promoting}
              className="whitespace-nowrap rounded-lg border border-[#cbbfae]/30 px-3 py-1.5 text-sm font-semibold text-[#6b6153] transition-colors hover:bg-[#cbbfae]/25 disabled:opacity-40"
            >
              {promoting ? "…" : "Für alle Organisationen freigeben"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(norm.id)}
            className="px-1 text-lg leading-none text-[#5f5f64] transition-colors hover:text-[#a3201a]"
            title="Löschen"
            aria-label={`Löschen: ${norm.title ?? norm.source_url ?? norm.category}`}
          >
            ×
          </button>
        </div>
      </div>
    </li>
  );
}
