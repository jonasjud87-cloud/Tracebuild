/**
 * Zeilengetreuer Text aus einem Original-PDF. Der gespeicherte Normtext gibt Zonentabellen je nach PDF
 * spaltenweise wieder, eine Zeile «W2» gibt es dann nicht und kein Wert lässt sich an die Zone binden.
 * Deshalb hier über die pdfjs-Koordinaten: Zeilen über y, Spalten über x. Nur fürs Kenndatenblatt und
 * nur im Arbeitsspeicher, an gespeicherten Normen ändert sich nichts.
 */
import { withTimeout } from "@/lib/pdf-text";

export interface LayoutItem {
  str: string;
  /** Links, in Punkten. */
  x: number;
  /** Grundlinie, von oben gemessen. */
  y: number;
  width: number;
  height: number;
}

/** Punkte je Textspalte einer Tabelle. */
const POINTS_PER_CHAR = 4;

/** Hochgestellte Fussnotenzeichen («4)WG2») liegen wenig über der Zeile und gehören dazu. */
function toLines(items: LayoutItem[]): LayoutItem[][] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: LayoutItem[][] = [];
  let ref: LayoutItem | null = null;
  for (const item of sorted) {
    const tolerance = 0.35 * Math.max(item.height, ref?.height ?? 0);
    if (ref && item.y - ref.y <= tolerance) {
      lines[lines.length - 1].push(item);
      if (item.height > ref.height) ref = item;
    } else {
      lines.push([item]);
      ref = item;
    }
  }
  return lines;
}

function hatSpalten(items: LayoutItem[]): boolean {
  const row = [...items].sort((a, b) => a.x - b.x);
  const height = Math.max(...row.map((i) => i.height));
  return row.some((item, i) => i > 0 && item.x - (row[i - 1].x + row[i - 1].width) > 1.2 * height);
}

function lineText(items: LayoutItem[], isTable: boolean): string {
  const row = [...items].sort((a, b) => a.x - b.x);
  const height = Math.max(...row.map((i) => i.height));

  let out = "";
  row.forEach((item, i) => {
    const text = item.str.trim();
    if (isTable) {
      // Spalten bleiben untereinander: Fehlt in einer Zeile ein Wert, rutscht der nächste nicht nach links.
      const column = Math.round(item.x / POINTS_PER_CHAR);
      const gap = i === 0 ? column : item.x - (row[i - 1].x + row[i - 1].width);
      if (i === 0 || gap > 1.2 * height) out += " ".repeat(Math.max(i === 0 ? 0 : 2, column - out.length));
      else if (gap > 0.15 * height) out += " ";
    } else if (i > 0 && item.x - (row[i - 1].x + row[i - 1].width) > 0.15 * height) {
      out += " ";
    }
    out += text;
  });
  return out.trimEnd();
}

export function layoutPageText(items: LayoutItem[]): string {
  const lines = toLines(items);
  const spalten = lines.map(hatSpalten);
  // Eine einzelne Zelle zwischen Tabellenzeilen («20 %») behält ihre Spalte.
  return lines.map((line, i) => lineText(line, spalten[i] || spalten[i - 1] === true || spalten[i + 1] === true)).join("\n");
}

const MAX_PAGES = 150;

export interface LayoutResult {
  text: string;
  pages: number;
  /** Fast kein Textlayer: ein Scan, die Koordinaten helfen hier nicht. */
  scan: boolean;
}

interface PdfTextItem {
  str: string;
  width: number;
  transform: number[];
}

/** Wirft bei einem unlesbaren PDF. Das Dokument wird in jedem Fall wieder freigegeben. */
export async function pdfLayoutText(bytes: Uint8Array, opts: { timeoutMs?: number } = {}): Promise<LayoutResult> {
  // Dynamisch wie in pdf-text.ts: Scheitert pdfjs im Bundle, bleibt das ein abfangbarer Fehler.
  const { getDocument, Util } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false, disableFontFace: true });
  const read = async (): Promise<LayoutResult> => {
    const doc = await task.promise;
    const pages: string[] = [];
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: LayoutItem[] = [];
      for (const raw of content.items) {
        const item = raw as PdfTextItem;
        if (typeof item.str !== "string" || !item.transform) continue;
        const t = Util.transform(viewport.transform, item.transform) as number[];
        // Senkrechte Randtexte gehören in keine Zeile.
        if (Math.abs(t[1]) > Math.abs(t[0]) * 0.1) continue;
        items.push({ str: item.str, x: t[4], y: t[5], width: item.width, height: Math.hypot(t[2], t[3]) });
      }
      pages.push(layoutPageText(items));
      page.cleanup();
    }
    const text = pages.join("\n\n");
    const chars = text.replace(/\s+/g, "").length;
    return { text, pages: count, scan: chars < Math.max(200, 30 * count) };
  };
  try {
    return await (opts.timeoutMs ? withTimeout(read(), opts.timeoutMs) : read());
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
