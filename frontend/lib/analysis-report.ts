import { type AnalysisItem, type Category, type Confidence, CATEGORY_LABELS, CONFIDENCE_LABELS } from "@/lib/domains/bau";

/**
 * Export eines Analyse-Ergebnisses: druckfertiger Prüfbericht (→ PDF über den
 * Browser-Druckdialog) und CSV-Mängelliste. Rein clientseitig, keine Abhängigkeiten.
 */

export interface ReportMeta {
  projectName: string;
  canton: string;
  municipality: string;
  parcel: string | null;
  bauzone: string | null;
  planType: string;
  version: number;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = { fail: "Verstoss", warn: "Unklar", ok: "Konform" };
const STATUS_COLOR: Record<string, string> = { fail: "#B91C1C", warn: "#B45309", ok: "#15803D" };
const ORDER: Record<string, number> = { fail: 0, warn: 1, ok: 2 };

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function categoryLabel(c: string | null | undefined): string {
  if (!c) return "";
  return CATEGORY_LABELS[c as Category] ?? c;
}

function confidenceLabel(c: string | null | undefined): string {
  if (!c) return "";
  return CONFIDENCE_LABELS[c as Confidence] ?? c;
}

function sorted(items: AnalysisItem[]): AnalysisItem[] {
  return items.slice().sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
}

export function buildReportHtml(meta: ReportMeta, items: AnalysisItem[]): string {
  const counts = {
    fail: items.filter((i) => i.status === "fail").length,
    warn: items.filter((i) => i.status === "warn").length,
    ok: items.filter((i) => i.status === "ok").length,
  };
  const date = new Date(meta.createdAt).toLocaleDateString("de-CH", { day: "2-digit", month: "long", year: "numeric" });
  const printed = new Date().toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const location = [meta.municipality, meta.canton].filter(Boolean).join(" ");

  const rows = sorted(items)
    .map((it) => {
      const color = STATUS_COLOR[it.status] ?? "#374151";
      const norm = it.norm_title ? esc(it.norm_title) : "";
      const cat = categoryLabel(it.category);
      const conf = confidenceLabel(it.confidence);
      const page = it.page_reference != null ? `S. ${esc(it.page_reference)}` : "";
      return `
        <tr>
          <td class="st"><span style="color:${color}">●</span> <b style="color:${color}">${esc(STATUS_LABEL[it.status] ?? it.status)}</b></td>
          <td>
            ${norm ? `<div class="norm">${norm}</div>` : ""}
            <div>${esc(it.note)}</div>
            ${it.suggestion ? `<div class="sug">Empfehlung: ${esc(it.suggestion)}</div>` : ""}
          </td>
          <td class="meta">${[cat, conf ? `Konfidenz: ${esc(conf)}` : "", page].filter(Boolean).join("<br>")}</td>
        </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Prüfbericht ${esc(meta.projectName)} – ${esc(meta.planType)} V${meta.version}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111827; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  .sub { color: #6B7280; font-size: 10pt; margin: 0 0 14pt; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4pt 24pt; font-size: 10pt; margin-bottom: 14pt; }
  .grid b { color: #374151; }
  .tiles { display: flex; gap: 10pt; margin: 0 0 16pt; }
  .tile { flex: 1; border: 1px solid #E5E7EB; border-radius: 6pt; padding: 8pt 10pt; }
  .tile .n { font-size: 20pt; font-weight: 800; line-height: 1; }
  .tile .l { font-size: 9pt; color: #6B7280; margin-top: 2pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #6B7280; border-bottom: 1.5px solid #D1D5DB; padding: 6pt 6pt; }
  td { vertical-align: top; border-bottom: 1px solid #E5E7EB; padding: 7pt 6pt; page-break-inside: avoid; }
  td.st { white-space: nowrap; width: 80pt; }
  td.meta { color: #6B7280; font-size: 9pt; width: 120pt; }
  .norm { font-weight: 600; margin-bottom: 2pt; }
  .sug { color: #4B5563; font-size: 9.5pt; margin-top: 3pt; }
  .foot { margin-top: 16pt; color: #9CA3AF; font-size: 8.5pt; border-top: 1px solid #E5E7EB; padding-top: 6pt; }
  @media print { .noprint { display: none; } }
  .noprint { margin-bottom: 12pt; }
  .noprint button { font: inherit; padding: 6pt 12pt; border: 1px solid #D1D5DB; border-radius: 6pt; background: #F9FAFB; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">Als PDF speichern / drucken</button></div>
  <h1>Prüfbericht</h1>
  <p class="sub">${esc(meta.projectName)} · ${esc(meta.planType)} · Version ${meta.version} · Analyse vom ${esc(date)}</p>

  <div class="grid">
    <div><b>Projekt:</b> ${esc(meta.projectName)}</div>
    <div><b>Standort:</b> ${esc(location) || "–"}</div>
    <div><b>Parzelle:</b> ${esc(meta.parcel) || "–"}</div>
    <div><b>Bauzone:</b> ${esc(meta.bauzone) || "–"}</div>
  </div>

  <div class="tiles">
    <div class="tile"><div class="n" style="color:${STATUS_COLOR.fail}">${counts.fail}</div><div class="l">Verstösse</div></div>
    <div class="tile"><div class="n" style="color:${STATUS_COLOR.warn}">${counts.warn}</div><div class="l">Unklare Punkte</div></div>
    <div class="tile"><div class="n" style="color:${STATUS_COLOR.ok}">${counts.ok}</div><div class="l">Konforme Punkte</div></div>
  </div>

  <table>
    <thead><tr><th>Status</th><th>Prüfpunkt</th><th>Details</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="3">Keine Prüfpunkte.</td></tr>`}</tbody>
  </table>

  <p class="foot">Automatisch erstellte KI-Analyse (Tracebuild) · exportiert am ${esc(printed)} · ${items.length} Prüfpunkte.
  Die Ergebnisse ersetzen keine behördliche Prüfung.</p>
</body>
</html>`;
}

/** Öffnet den Bericht in einem neuen Tab; von dort über den Browser-Druckdialog als PDF speichern. */
export function openReportForPrint(meta: ReportMeta, items: AnalysisItem[]): boolean {
  const html = buildReportHtml(meta, items);
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // Kurz warten, bis das Dokument gerendert ist, dann Druckdialog.
  w.setTimeout(() => w.print(), 300);
  return true;
}

/**
 * Zellen, die mit = + - @ oder Tab beginnen, wertet Excel als Formel (CSV-Injection).
 * Die Texte kommen vom Modell — "-3.50 m" am Zeilenanfang reicht. Ein führendes
 * Hochkomma macht daraus Text; Excel zeigt es nicht an.
 */
function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r\t]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildReportCsv(meta: ReportMeta, items: AnalysisItem[]): string {
  const header = ["Status", "Norm", "Prüfpunkt", "Empfehlung", "Kategorie", "Konfidenz", "Seite"];
  const lines = sorted(items).map((it) =>
    [
      STATUS_LABEL[it.status] ?? it.status,
      it.norm_title ?? "",
      it.note ?? "",
      it.suggestion ?? "",
      categoryLabel(it.category),
      confidenceLabel(it.confidence),
      it.page_reference ?? "",
    ].map(csvCell).join(";"),
  );
  const head = [
    `Projekt;${csvCell(meta.projectName)}`,
    `Planart;${csvCell(meta.planType)};Version;${meta.version}`,
    `Analyse vom;${csvCell(new Date(meta.createdAt).toLocaleDateString("de-CH"))}`,
    "",
  ];
  // BOM, damit Excel die Umlaute korrekt liest; Semikolon = Excel-Standard im DACH-Raum.
  return "﻿" + [...head, header.join(";"), ...lines].join("\r\n");
}

export function downloadReportCsv(meta: ReportMeta, items: AnalysisItem[]): void {
  const blob = new Blob([buildReportCsv(meta, items)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
  a.href = url;
  a.download = `Pruefbericht_${safe(meta.projectName)}_${safe(meta.planType)}_V${meta.version}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
