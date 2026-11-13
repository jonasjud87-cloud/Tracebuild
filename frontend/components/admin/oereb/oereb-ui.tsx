"use client";

import { useState } from "react";
import { REVIEW_LABEL, formatDate, rejectReasonLabel, safeExternalUrl } from "@/components/geoportal-logic";
import { AI_READ_LABEL } from "@/lib/oereb/ai-read-label";
import type { ImportFilterRules } from "@/lib/oereb/import-filter";
import { CATEGORY_INFO, categoryGroup, type CategoryCount, type DocumentCategory } from "@/lib/oereb/rejection-category";
import type { AdminDocument, CantonOverview, CantonRelease, DocumentDecision, FilterRow } from "./types";

export const STATUS: Record<string, { label: string; cls: string }> = {
  imported: { label: "Importiert", cls: "border-[#65A88A]/30 bg-[#e4f3ea] text-[#136a40]" },
  pending: { label: "Offen", cls: "border-[rgba(21,20,20,0.15)] bg-[#cbbfae]/30 text-[#46464a]" },
  rejected: { label: "Abgelehnt", cls: "border-[rgba(21,20,20,0.15)] bg-[#cbbfae]/30 text-[#46464a]" },
  failed: { label: "Fehler", cls: "border-[#D87979]/40 bg-[#fde7e5] text-[#a3201a]" },
  duplicate_manual: { label: "Von Hand erfasst", cls: "border-[rgba(21,20,20,0.15)] bg-[#cbbfae]/30 text-[#46464a]" },
  removed: { label: "Entfernt", cls: "border-[rgba(21,20,20,0.15)] bg-[#cbbfae]/30 text-[#5f5f64]" },
  review: { label: REVIEW_LABEL, cls: "border-[rgba(21,20,20,0.15)] bg-[#cbbfae]/30 text-[#46464a]" },
};
export const SCAN_STATUS = { label: "Scan", cls: "border-[#D6A45F]/30 bg-[#fff1d6] text-[#7a4f00]" };
export const CHECK_CLS = "border-[#D6A45F]/30 bg-[#fff1d6] text-[#7a4f00]";
export const SKIPPED_CLS = "border-[rgba(21,20,20,0.12)] bg-[#f6f3ee] text-[#5f5f64]";

/** Abzeichen: bewusst ausgelassene neutral mit Kategorie, echte Ablehnungen in Warnfarbe. */
export function statusBadge(doc: AdminDocument, category: DocumentCategory): { label: string; cls: string } {
  if (doc.status === "rejected" && doc.reject_reason === "scan_or_short") return SCAN_STATUS;
  if (categoryGroup(category) === "skipped") return { label: `Ausgelassen: ${CATEGORY_INFO[category].label}`, cls: SKIPPED_CLS };
  if (doc.status === "rejected") return { label: "Abgelehnt, prüfen", cls: CHECK_CLS };
  return STATUS[doc.status] ?? { label: CATEGORY_INFO.check.label, cls: CHECK_CLS };
}

export const DECISION_BADGE: Record<DocumentDecision, string> = {
  force_import: "Admin: trotzdem importieren",
  exclude: "Admin: ausgeschlossen",
  recheck: "Admin: neu prüfen",
};

export const DECISION_DIALOG: Record<DocumentDecision, { title: string; text: string; confirm: string; tone: "danger" | "primary"; done: string }> = {
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

export const RULE_LISTS: { key: keyof ImportFilterRules; label: string }[] = [
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

export const RULE_NUMBERS: { key: keyof ImportFilterRules; label: string }[] = [
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

export const INPUT = "rounded-lg border border-[#8c8b8e] bg-white px-3 py-2 text-sm text-[#151414] placeholder:text-[#6e6e73] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]";
export const ACTION_BTN = "rounded-lg border border-[#8c8b8e] px-3 py-1.5 text-sm font-medium text-[#151414] transition-colors hover:bg-[#f6f3ee] hover:text-[#151414] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]";
export const PANEL = "rounded-2xl border border-[rgba(21,20,20,0.08)] bg-white";
export const TH = "px-3 py-2 text-right font-medium";
export const TD = "px-3 py-2 text-right tabular-nums";

export function releaseText(release: CantonRelease): string {
  const source = release.source === "canton" ? "Kantonszeile" : release.source === "default" ? "Zeile default" : "Standard im Code";
  return `${release.released ? "Freigegeben" : "Gestoppt"} (${source})`;
}

export function ownRulesText(own: CantonOverview["own_rules"]): string {
  return own === "active" ? "aktiv" : own === "inactive" ? "inaktiv" : "keine";
}

export function CantonTable({ cantons, selected, onSelect }: { cantons: CantonOverview[]; selected: string; onSelect: (canton: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const active = cantons.filter((c) => c.total > 0 || c.release.released);
  const visible = showAll || active.length === 0 ? cantons : active;
  const hidden = cantons.length - visible.length;
  return (
    <section aria-label="Kantone" className={`${PANEL} overflow-x-auto tba-scroll-x`}>
      <table className="w-full text-sm text-[#46464a]">
        <thead className="text-[#5f5f64]">
          <tr className="bg-[#f6f3ee] border-b border-[rgba(21,20,20,0.08)]">
            <th scope="col" className={`${TH} text-left`}>Kanton</th>
            <th scope="col" className={`${TH} text-left`}>Freigabe</th>
            <th scope="col" className={`${TH} text-left hidden xl:table-cell`}>Eigene Regeln</th>
            <th scope="col" className={TH}>Dokumente</th>
            <th scope="col" className={TH}>Importiert</th>
            <th scope="col" className={`${TH} hidden 2xl:table-cell`}>Abgelehnt</th>
            <th scope="col" className={`${TH} hidden 2xl:table-cell`}>Scans</th>
            <th scope="col" className={TH}>Fehler</th>
            <th scope="col" className={TH}>Offen</th>
            <th scope="col" className={`${TH} hidden xl:table-cell`}>Zur Prüfung</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <tr key={c.canton} className={`tba-row transition-colors border-b border-[rgba(21,20,20,0.08)] last:border-0 ${c.canton === selected ? "tba-row--selected" : ""}`}>
              <th scope="row" className="px-3 py-1 text-left font-normal">
                <button
                  type="button"
                  aria-pressed={c.canton === selected}
                  onClick={() => onSelect(c.canton)}
                  className="min-h-[28px] min-w-[44px] rounded-md px-2 text-left font-semibold text-[#6b6153] hover:text-[#151414] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]"
                >
                  {c.canton}
                </button>
              </th>
              <td className="px-3 py-2">
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium ${c.release.released ? "bg-[#e4f3ea] text-[#136a40]" : "bg-[#fff1d6] text-[#7a4f00]"}`}>
                  {c.release.released ? "Aktiv" : "Gestoppt"}
                </span>
                <span className="ml-2 hidden text-[13px] text-[#5f5f64] xl:inline">{releaseText(c.release).replace(/^(Freigegeben|Gestoppt) /, "")}</span>
              </td>
              <td className="hidden xl:table-cell px-3 py-2">{ownRulesText(c.own_rules)}</td>
              <td className={TD}>{c.total}</td>
              <td className={TD}>{c.imported}</td>
              <td className={`${TD} hidden 2xl:table-cell`}>{c.rejected}</td>
              <td className={`${TD} hidden 2xl:table-cell`}>{c.scans}</td>
              <td className={TD}>{c.failed}</td>
              <td className={TD}>{c.pending}</td>
              <td className={`${TD} hidden xl:table-cell`}>{c.review}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(hidden > 0 || showAll) && active.length > 0 && (
        <div className="border-t border-[rgba(21,20,20,0.08)] px-3 py-2 text-center">
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm font-medium text-[#46464a] underline underline-offset-2 hover:text-[#151414]">
            {showAll ? "Nur Kantone mit Aktivität zeigen" : `Alle ${cantons.length} Kantone zeigen (${hidden} ohne Aktivität)`}
          </button>
        </div>
      )}
    </section>
  );
}

export function RulesPanel({ canton, rules, filters, open = false }: { canton: string; rules: ImportFilterRules; filters: FilterRow[]; open?: boolean }) {
  const rows = filters.filter((f) => f.scope === "default" || f.scope === canton);
  return (
    <details open={open} className={`${PANEL} px-4 py-3`}>
      <summary className="cursor-pointer text-sm font-semibold text-[#151414] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]">
        Aktive Filterregeln für {canton}
      </summary>
      <p className="mt-2 text-sm text-[#5f5f64]">Wirksam sind der Standard im Code, darüber die Zeile default, darüber die Zeile des Kantons. Ändern lassen sich die Zeilen per SQL.</p>
      <dl className="mt-3 grid gap-3 md:grid-cols-2">
        {RULE_LISTS.map(({ key, label }) => {
          const values = rules[key] as string[];
          return (
            <div key={key}>
              <dt className="text-sm font-medium text-[#46464a]">{label}</dt>
              <dd className="mt-0.5 text-sm text-[#5f5f64]" style={{ overflowWrap: "anywhere" }}>{values.length ? values.join(", ") : "keine"}</dd>
            </div>
          );
        })}
        {RULE_NUMBERS.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-sm font-medium text-[#46464a]">{label}</dt>
            <dd className="mt-0.5 text-sm tabular-nums text-[#5f5f64]">{String(rules[key])}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-4 text-sm font-semibold text-[#151414]">Zeilen aus der Datenbank</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-[#5f5f64]">Keine: Es gilt der Standard im Code.</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {rows.map((row) => (
            <li key={row.scope} className="text-sm text-[#5f5f64]">
              <span className="font-medium text-[#46464a]">{row.scope}</span>
              {row.active ? "" : " (inaktiv, zählt nicht)"}
              {row.updated_at ? ` · ${formatDate(row.updated_at)}` : ""}
              {row.note ? <span className="block">{row.note}</span> : null}
              <code className="mt-0.5 block text-[13px]" style={{ overflowWrap: "anywhere" }}>{JSON.stringify(row.rules)}</code>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function CategorySummary({ categories, truncated }: { categories: CategoryCount[]; truncated: boolean }) {
  const sum = (group: CategoryCount["group"]) => categories.filter((c) => c.group === group).reduce((n, c) => n + c.count, 0);
  const skipped = categories.filter((c) => c.group === "skipped");
  const check = sum("check");
  const open = sum("open");
  return (
    <section aria-label="Einteilung der Dokumente" className="space-y-2">
    <p className="text-sm text-[#5f5f64]">
      Einteilung über den ganzen Kanton, unabhängig von den Filtern unten.
      {truncated && " Nicht alle Dokumente wurden gezählt: Die Zahlen sind Untergrenzen."}
    </p>
    <div className="grid gap-3 md:grid-cols-3">
      <div className={`${PANEL} px-4 py-3`}>
        <p className="text-sm font-medium text-[#46464a]">Importiert</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-[#136a40]">{sum("imported")}</p>
        {open > 0 && <p className="mt-1 text-sm text-[#5f5f64]">{open} noch offen</p>}
      </div>
      <div className={`rounded-2xl border px-4 py-3 ${check > 0 ? "border-[#D6A45F]/40 bg-[#fff1d6]" : "border-[rgba(21,20,20,0.08)] bg-white"}`}>
        <p className={`text-sm font-medium ${check > 0 ? "text-[#7a4f00]" : "text-[#46464a]"}`}>Zu prüfen</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${check > 0 ? "text-[#7a4f00]" : "text-[#151414]"}`}>{check}</p>
        <p className="mt-1 text-sm text-[#5f5f64]">{CATEGORY_INFO.check.hint}</p>
      </div>
      <div className={`${PANEL} px-4 py-3`}>
        <p className="text-sm font-medium text-[#46464a]">Bewusst ausgelassen</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-[#5f5f64]">{sum("skipped")}</p>
        {skipped.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-sm text-[#5f5f64]">
            {skipped.map((c) => (
              <li key={c.category} title={CATEGORY_INFO[c.category].hint}>
                <span className="tabular-nums">{c.count}</span> × {c.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
    </section>
  );
}

export function DocumentRow({ doc, category, busy, onDecide }: { doc: AdminDocument; category: DocumentCategory; busy: boolean; onDecide: (doc: AdminDocument, decision: DocumentDecision) => void }) {
  const status = statusBadge(doc, category);
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
        <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-medium ${status.cls}`}>{status.label}</span>
        {doc.manual_decision && (
          <span className="whitespace-nowrap rounded-full border border-[#cbbfae]/40 bg-[#cbbfae]/30 px-2 py-0.5 text-[13px] font-medium text-[#6b6153]">
            {DECISION_BADGE[doc.manual_decision]}
          </span>
        )}
        {doc.text_source === "ai_read" && (
          <span className="whitespace-nowrap rounded-full border border-[#D6A45F]/30 bg-[#fff1d6] px-2 py-0.5 text-[13px] font-medium text-[#7a4f00]">
            {AI_READ_LABEL}
          </span>
        )}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-sm text-[#151414] underline decoration-[#cbbfae]/50 underline-offset-2 hover:decoration-[#151414]" style={{ overflowWrap: "anywhere" }}>
            {doc.title} <span aria-hidden="true" className="text-[#6b6153]">↗</span>
          </a>
        ) : (
          <span className="text-sm text-[#151414]" style={{ overflowWrap: "anywhere" }}>{doc.title}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-[#5f5f64]" style={{ overflowWrap: "anywhere" }}>{meta}</p>
      {doc.reject_detail && <p className="mt-0.5 text-sm text-[#5f5f64]" style={{ overflowWrap: "anywhere" }}>{doc.reject_detail}</p>}
      {doc.version_note && <p className="mt-0.5 text-sm text-[#6b6153]" style={{ overflowWrap: "anywhere" }}>{doc.version_note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || doc.status === "imported"} onClick={() => onDecide(doc, "force_import")} className={ACTION_BTN}>Trotzdem importieren</button>
        <button type="button" disabled={busy || doc.manual_decision === "exclude"} onClick={() => onDecide(doc, "exclude")} className={ACTION_BTN}>Ausschliessen</button>
        <button type="button" disabled={busy} onClick={() => onDecide(doc, "recheck")} className={ACTION_BTN}>Neu prüfen</button>
      </div>
    </li>
  );
}

/** «3 × Übergeordnetes Recht, 1 × Plan, kein Normtext» in Reihenfolge des ersten Auftretens. */
export function skippedBreakdown(categories: DocumentCategory[]): string {
  const counts = new Map<DocumentCategory, number>();
  for (const c of categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  return Array.from(counts, ([c, n]) => `${n} × ${CATEGORY_INFO[c].label}`).join(", ");
}
