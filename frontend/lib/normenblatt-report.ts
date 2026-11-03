import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { csvCell } from "@/lib/report-utils";

/**
 * Export des Normenblatts: generiertes PDF (jsPDF/autoTable, nativer Browser-PDF-Viewer)
 * und CSV-Register. Rein clientseitig, keine Backend-Abhängigkeit.
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

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch("/Logo-new.png");
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const PAGE_MARGIN = 14;

export async function buildNormenblattPdf(meta: NormenblattMeta, rows: NormenblattRow[]): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const year = new Date().getFullYear();
  const title = `Normenblatt — ${meta.projectName}`;
  const location = [meta.municipality, meta.canton].filter(Boolean).join(" ");

  const logo = await loadLogoDataUrl();
  if (logo) {
    doc.addImage(logo, "PNG", PAGE_MARGIN, 10, 10, 10);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const wordmarkY = 17;
  doc.setTextColor(17, 24, 39);
  doc.text("Trace", pageWidth - PAGE_MARGIN - doc.getTextWidth("TraceBuild"), wordmarkY);
  const traceWidth = doc.getTextWidth("Trace");
  doc.setTextColor(40, 98, 215);
  doc.text("Build", pageWidth - PAGE_MARGIN - doc.getTextWidth("TraceBuild") + traceWidth, wordmarkY);

  doc.setDrawColor(40, 98, 215);
  doc.setLineWidth(0.6);
  doc.line(PAGE_MARGIN, 24, pageWidth - PAGE_MARGIN, 24);

  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, PAGE_MARGIN, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  const subtitle = (location || "–") + (rows.length ? ` · ${rows.length} Normen` : "");
  doc.text(subtitle, PAGE_MARGIN, 42);

  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(PAGE_MARGIN, 46, pageWidth - PAGE_MARGIN, 46);

  let cursorY = 54;
  const groups = groupRows(rows);

  if (groups.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(17, 24, 39);
    doc.text("Keine Normen zugewiesen.", PAGE_MARGIN, cursorY);
  }

  groups.forEach((grp, i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(17, 24, 39);
    doc.text(`${i + 1}. ${grp.label}`, PAGE_MARGIN, cursorY);

    autoTable(doc, {
      startY: cursorY + 4,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [["Bezeichnung", "Quelle", "Referenz", "Relevanz"]],
      body: grp.rows.map((r) => [r.title, r.source, r.referenceLabel, r.relevance]),
      theme: "plain",
      styles: { fontSize: 9.5, textColor: [17, 24, 39], cellPadding: 2 },
      headStyles: { fontSize: 8.5, textColor: [107, 114, 128], fontStyle: "bold" },
      bodyStyles: { lineColor: [229, 231, 235], lineWidth: { bottom: 0.2 } },
      columnStyles: { 0: { fontStyle: "bold" } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          const row = grp.rows[data.row.index];
          if (row?.referenceUrl) data.cell.styles.textColor = [40, 98, 215];
        }
      },
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          const row = grp.rows[data.row.index];
          if (row?.referenceUrl) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: row.referenceUrl });
          }
        }
      },
    });

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  });

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const footY = doc.internal.pageSize.getHeight() - 10;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, footY - 4, pageWidth - PAGE_MARGIN, footY - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(156, 163, 175);
    doc.text(String(year), PAGE_MARGIN, footY);
    doc.text(title, pageWidth / 2, footY, { align: "center" });
    doc.text(`Seite ${p} / ${pageCount}`, pageWidth - PAGE_MARGIN, footY, { align: "right" });
  }

  return doc.output("blob");
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
