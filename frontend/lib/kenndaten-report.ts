import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { kenndatenDateiname, type KenndatenBlatt } from "./kenndaten";

/** PDF des Kenndatenblatts, rein clientseitig. Rechnet nichts: Alle Werte stehen fertig im Blatt. */

export const KENNDATEN_FUSSZEILE =
  "Automatisch aus den zugewiesenen Normen und dem ÖREB-Auszug erstellt. Keine behördliche Auskunft, Werte am Original prüfen.";

// Logo-new.png liegt auf schwarzem Grund, dieses ist auf Weiss gemacht.
const LOGO_PATH = "/tracebuild-logo.png";
const LOGO_RATIO = 1008 / 1024;
const LOGO_PX = 240;

const MARGIN = 16;
const FOOT_SPACE = 24;
const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];
const LINE: [number, number, number] = [229, 231, 235];
const BLUE: [number, number, number] = [40, 98, 215];

/** Die Standardschrift des PDF kennt nur WinAnsi. Ein Zeichen wie ≥ aus einem Reglement würde sonst die Zeile zerstören. */
export function pdfText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/≥/g, "mind.")
    .replace(/≤/g, "höchstens")
    .replace(/[×✕]/g, "x")
    .replace(/[\r\n\t]+/g, " ")
    .replace(new RegExp("[^\u0020-\u007E\u00A0-\u00FF–—‘’“”„…•€]", "gu"), (c) => {
      const plain = c.normalize("NFKD").replace(new RegExp("\\p{M}", "gu"), "");
      return /^[ -~ -ÿ]+$/.test(plain) ? plain : "?";
    });
}

/** Das Logo auf 240 px verkleinert: Das Original wiegt fast ein halbes Megabyte. */
export async function loadKenndatenLogo(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_PATH);
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.height = LOGO_PX;
    canvas.width = Math.round(LOGO_PX * LOGO_RATIO);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function sectionTitle(doc: jsPDF, label: string, y: number): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BLUE);
  doc.text(label, MARGIN, y);
}

export function buildKenndatenDoc(blatt: KenndatenBlatt, logo: string | null): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - 2 * MARGIN;

  // Kopf
  if (logo) doc.addImage(logo, "PNG", MARGIN - 2, 9, 16 * LOGO_RATIO, 16, undefined, "FAST");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  const wordmarkX = pageWidth - MARGIN - doc.getTextWidth("TraceBuild");
  doc.text("Trace", wordmarkX, 18.5);
  doc.setTextColor(...BLUE);
  doc.text("Build", wordmarkX + doc.getTextWidth("Trace"), 18.5);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, 27, pageWidth - MARGIN, 27);

  doc.setTextColor(...INK);
  doc.setFontSize(20);
  doc.text("Kenndatenblatt", MARGIN, 38);

  doc.setFontSize(12);
  const nameLines = (doc.splitTextToSize(pdfText(blatt.projektName), contentWidth) as string[]).slice(0, 2);
  doc.text(nameLines, MARGIN, 45.5);
  let y = 45.5 + nameLines.length * 5.5;

  const meta: [string, string, number, number][] = [
    ["Gemeinde, Kanton", blatt.ort, 0, 0.53],
    ["Parzelle", blatt.parzelle, 0.55, 0.21],
    ["Datum", blatt.datum, 0.78, 0.22],
  ];
  for (const [label, value, at, share] of meta) {
    const x = MARGIN + contentWidth * at;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(label, x, y);
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text((doc.splitTextToSize(pdfText(value), contentWidth * share) as string[])[0], x, y + 4.5);
  }
  y += 14;

  // Kenndaten
  sectionTitle(doc, "KENNDATEN", y);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOT_SPACE },
    head: [["Bezeichnung", "Wert", "Quelle"]],
    body: blatt.zeilen.map((z) => [pdfText(z.bezeichnung), pdfText(z.wert), pdfText(z.quelle)]),
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9.5, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 2 }, overflow: "linebreak" },
    headStyles: { fontSize: 8, textColor: MUTED, fontStyle: "bold", lineColor: INK, lineWidth: { bottom: 0.3 } },
    bodyStyles: { lineColor: LINE, lineWidth: { bottom: 0.2 } },
    columnStyles: {
      0: { cellWidth: 38, textColor: MUTED },
      1: { cellWidth: 68, fontStyle: "bold" },
      2: { textColor: MUTED, fontSize: 8 },
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;

  // Berechnungen
  const b = blatt.berechnung;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const hinweis = doc.splitTextToSize(pdfText(b.hinweis), contentWidth) as string[];
  const needed = 11 + b.zeilen.length * 5.5 + hinweis.length * 4 + 7;
  if (y + needed > pageHeight - FOOT_SPACE) {
    doc.addPage();
    y = 20;
  }
  sectionTitle(doc, "BERECHNUNGEN", y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Geschossfläche", MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  for (const line of b.zeilen) {
    doc.text(pdfText(line), MARGIN, y);
    y += 5.5;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...(b.art === "keine" ? INK : MUTED));
  doc.text(hinweis, MARGIN, y);
  y += hinweis.length * 4 + 3;

  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(pdfText(blatt.oerebStand), MARGIN, y);

  // Fusszeile
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const footY = pageHeight - 12;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, footY - 4.5, pageWidth - MARGIN, footY - 4.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(KENNDATEN_FUSSZEILE, contentWidth) as string[], MARGIN, footY);
    if (pages > 1) doc.text(`Seite ${p} / ${pages}`, pageWidth - MARGIN, footY + 5, { align: "right" });
  }
  return doc;
}

export async function downloadKenndatenPdf(blatt: KenndatenBlatt): Promise<void> {
  const doc = buildKenndatenDoc(blatt, await loadKenndatenLogo());
  const url = URL.createObjectURL(doc.output("blob"));
  const a = document.createElement("a");
  a.href = url;
  a.download = kenndatenDateiname(blatt.projektName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
