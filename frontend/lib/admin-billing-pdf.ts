import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { invoiceNumberResolver, sumRows, type OrgCostRow, type Period, type UnassignedCosts } from "@/lib/admin-billing";

export function buildPdf(rows: OrgCostRow[], period: Period, usdToChf: number, now: Date, unassigned?: UnassignedCosts): ArrayBuffer {
  const totals = sumRows(rows);
  const numberOf = invoiceNumberResolver(rows);
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.setFontSize(18);
  doc.text("Tracebuild Kostenbericht", 14, 20);
  doc.setFontSize(11);
  doc.text(`Zeitraum: ${period.value}`, 14, 28);

  autoTable(doc, {
    startY: 34,
    head: [["Organisation", "Monat", "Rechnung", "KI-Analysen CHF", "KI-Chat CHF", "Normen CHF", "Gesamt CHF"]],
    body: rows.map((r) => [
      r.orgName,
      r.month,
      numberOf(r.orgId, r.month),
      `${r.analyseCost.toFixed(2)} (${r.analyseCount})`,
      `${r.chatCost.toFixed(2)} (${r.chatCount})`,
      `${r.normCost.toFixed(2)} (${r.normCount})`,
      r.totalCost.toFixed(2),
    ]),
    foot: [
      [
        "Gesamtsumme",
        "",
        "",
        `${totals.analyseChf.toFixed(2)} (${totals.analyseCount})`,
        `${totals.chatChf.toFixed(2)} (${totals.chatCount})`,
        `${totals.normChf.toFixed(2)} (${totals.normCount})`,
        totals.amountChf.toFixed(2),
      ],
    ],
    styles: { fontSize: 8 },
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
    headStyles: { fillColor: [40, 40, 40] },
    footStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: "bold" },
    showFoot: "lastPage",
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  if (y + 6 > doc.internal.pageSize.getHeight() - 20) {
    doc.addPage();
    y = 20;
  }
  doc.setFontSize(10);
  doc.text(`Kurs USD/CHF: ${Math.round(usdToChf * 10000) / 10000}`, 14, y);
  doc.text(`Erstellt am: ${now.toLocaleDateString("de-CH", { timeZone: "Europe/Zurich" })}`, 14, y + 6);
  if (unassigned && unassigned.count > 0) {
    doc.text(
      `Nicht zuordenbare Kosten (CHF): ${unassigned.chf.toFixed(2)} (${unassigned.count} Positionen, nicht in der Gesamtsumme)`,
      14,
      y + 12,
    );
  }

  return doc.output("arraybuffer");
}
