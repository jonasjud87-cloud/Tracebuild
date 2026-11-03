import { esc, csvCell } from "@/lib/report-utils";

/**
 * Export des Normenblatts: druckfertiges Letterhead-PDF (→ Browser-Druckdialog)
 * und CSV-Register. Rein clientseitig, keine Abhängigkeiten.
 */

export interface NormenblattMeta {
  projectName: string;
  canton: string;
  municipality: string;
}

export interface NormenblattRow {
  group: string;
  title: string;
  source: string;
  referenceUrl: string | null;
  referenceLabel: string;
  relevance: string;
}

function groupRows(rows: NormenblattRow[]): { label: string; rows: NormenblattRow[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, NormenblattRow[]>();
  for (const r of rows) {
    if (!byGroup.has(r.group)) { byGroup.set(r.group, []); order.push(r.group); }
    byGroup.get(r.group)!.push(r);
  }
  return order.map((label) => ({ label, rows: byGroup.get(label)! }));
}

export function buildNormenblattHtml(meta: NormenblattMeta, rows: NormenblattRow[]): string {
  const year = new Date().getFullYear();
  const title = `Normenblatt — ${esc(meta.projectName)}`;
  const location = [meta.municipality, meta.canton].filter(Boolean).join(" ");
  const logoSrc = (typeof window !== "undefined" ? window.location.origin : "") + "/Logo-new.png";

  const sections = groupRows(rows)
    .map((grp, i) => {
      const trs = grp.rows
        .map((r) => {
          const ref = r.referenceUrl
            ? `<a href="${esc(r.referenceUrl)}">${esc(r.referenceLabel)}</a>`
            : esc(r.referenceLabel);
          return `
        <tr>
          <td class="b">${esc(r.title)}</td>
          <td>${esc(r.source)}</td>
          <td>${ref}</td>
          <td>${esc(r.relevance)}</td>
        </tr>`;
        })
        .join("");
      return `
      <h2>${i + 1}. ${esc(grp.label)}</h2>
      <table>
        <thead><tr><th>Bezeichnung</th><th>Quelle</th><th>Referenz</th><th>Relevanz</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
    })
    .join("");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111827; margin: 0; }
  .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10pt; }
  .header img { height: 28pt; }
  .wordmark { font-weight: 800; font-size: 13pt; color: #2862D7; letter-spacing: 0.02em; }
  .rule-blue { border-bottom: 2pt solid #2862D7; margin-bottom: 18pt; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  .sub { color: #6B7280; font-size: 10pt; margin: 0 0 8pt; }
  .rule { border-bottom: 1px solid #E5E7EB; margin-bottom: 18pt; }
  h2 { font-size: 12pt; margin: 20pt 0 8pt; color: #111827; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 4pt; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: #6B7280; border-bottom: 1.5px solid #D1D5DB; padding: 6pt 6pt; }
  td { vertical-align: top; border-bottom: 1px solid #E5E7EB; padding: 6pt 6pt; page-break-inside: avoid; }
  td.b { font-weight: 600; }
  a { color: #2862D7; text-decoration: none; }
  .foot { position: fixed; bottom: 10mm; left: 16mm; right: 16mm; display: flex; justify-content: space-between; color: #9CA3AF; font-size: 8.5pt; border-top: 1px solid #E5E7EB; padding-top: 6pt; }
  @media print { .noprint { display: none; } }
  .noprint { margin-bottom: 12pt; display: flex; align-items: center; gap: 10pt; }
  .noprint button { font: inherit; padding: 6pt 12pt; border: 1px solid #D1D5DB; border-radius: 6pt; background: #F9FAFB; cursor: pointer; }
  .noprint-hint { font-size: 9pt; color: #6B7280; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">Als PDF speichern / drucken</button> <span class="noprint-hint">Vorschau — PDF wird erst mit Klick erzeugt.</span></div>
  <div class="header">
    <img src="${esc(logoSrc)}" alt="TraceBuild">
    <span class="wordmark">TraceBuild</span>
  </div>
  <div class="rule-blue"></div>

  <h1>${title}</h1>
  <p class="sub">${esc(location) || "–"}${rows.length ? ` · ${rows.length} Normen` : ""}</p>
  <div class="rule"></div>

  ${sections || `<p>Keine Normen zugewiesen.</p>`}

  <div class="foot">
    <span>${year}</span>
    <span>${title}</span>
  </div>
</body>
</html>`;
}

/** Öffnet das Normenblatt als Vorschau in einem neuen Tab; der Export (Browser-Druckdialog) löst erst der "Als PDF speichern / drucken"-Button dort aus. */
export function openNormenblattForPrint(meta: NormenblattMeta, rows: NormenblattRow[]): boolean {
  const html = buildNormenblattHtml(meta, rows);
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  return true;
}

export function buildNormenblattCsv(meta: NormenblattMeta, rows: NormenblattRow[]): string {
  const header = ["Gruppe", "Bezeichnung", "Quelle", "Referenz", "Relevanz"];
  const lines = rows.map((r) =>
    [r.group, r.title, r.source, r.referenceUrl ?? r.referenceLabel, r.relevance].map(csvCell).join(";"),
  );
  const head = [`Projekt;${csvCell(meta.projectName)}`, `Standort;${csvCell([meta.municipality, meta.canton].filter(Boolean).join(" "))}`, ""];
  return "﻿" + [...head, header.join(";"), ...lines].join("\r\n");
}

export function downloadNormenblattCsv(meta: NormenblattMeta, rows: NormenblattRow[]): void {
  const blob = new Blob([buildNormenblattCsv(meta, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
  a.href = url;
  a.download = `Normenblatt_${safe(meta.projectName)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
