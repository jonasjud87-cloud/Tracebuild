/**
 * Original-PDF der Gemeindenormen fürs Kenndatenblatt holen. Nur Lesen: Nichts wird gespeichert, der Text
 * gilt nur für diese Auswertung. Abruf über fetchDocument (erlaubte Hosts, SSRF-Schutz, Grösse, %PDF),
 * eigene Uploads über den Storage. Scheitert es, läuft die Norm auf dem gespeicherten Text, und das Blatt sagt es.
 */
import { fetchDocument, type DocumentFetchResult } from "@/lib/oereb/document-fetch";
import type { ImportFilterRules } from "@/lib/oereb/import-filter";
import { pdfLayoutText, type LayoutResult } from "@/lib/kenndaten-pdf";

const MAX_PDFS = 3;
const FETCH_TIMEOUT_MS = 12_000;
const PARSE_TIMEOUT_MS = 15_000;

export interface PdfQuelle {
  id: string;
  title: string;
  pdf_url: string | null;
  source_url: string | null;
}

export interface PdfErgebnis {
  /** Zeilengetreuer Text je Norm-ID. */
  texte: Map<string, string>;
  hinweise: string[];
  /** Mindestens ein Original war nur vorübergehend nicht abrufbar. */
  vorbehalt: boolean;
}

export interface PdfDeps {
  rules: ImportFilterRules;
  canton: string;
  deadlineAt: number;
  /** Lädt einen eigenen Upload. Null, wenn die URL keiner ist. */
  ladeUpload: (url: string, maxBytes: number) => Promise<Buffer | null>;
  fetchDoc?: (url: string, opts: Parameters<typeof fetchDocument>[1]) => Promise<DocumentFetchResult>;
  parse?: (bytes: Uint8Array, opts: { timeoutMs: number }) => Promise<LayoutResult>;
}

/** Nur der Dokumentpfad eines eigenen Uploads: öffentlicher Storage-Pfad unter `documents/norms/`. */
export function uploadPfad(url: string, supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/documents/`;
  if (!url.startsWith(prefix)) return null;
  const path = decodeURI(url.slice(prefix.length));
  return path.startsWith("norms/") && !path.includes("..") ? path : null;
}

const hinweis = (title: string, grund: string) =>
  `${title}: ${grund}. Werte aus dem gespeicherten Text; ohne eindeutige Bindung an die Zone bleiben sie leer.`;

export async function ladeGemeindePdfs(normen: PdfQuelle[], deps: PdfDeps): Promise<PdfErgebnis> {
  const fetchDoc = deps.fetchDoc ?? fetchDocument;
  const parse = deps.parse ?? pdfLayoutText;
  const out: PdfErgebnis = { texte: new Map(), hinweise: [], vorbehalt: false };

  let geladen = 0;
  // Der Reihe nach: Mehrere grosse PDF gleichzeitig kosten zu viel Speicher.
  for (const norm of normen) {
    const url = norm.pdf_url || norm.source_url;
    if (!url) {
      out.hinweise.push(hinweis(norm.title, "Kein Original-PDF hinterlegt"));
      continue;
    }
    const left = deps.deadlineAt - Date.now();
    if (geladen >= MAX_PDFS || left < 3_000) {
      out.hinweise.push(hinweis(norm.title, "Original-PDF aus Zeitgründen nicht gelesen"));
      if (left < 3_000) out.vorbehalt = true;
      continue;
    }
    geladen += 1;

    try {
      let bytes = await deps.ladeUpload(url, deps.rules.max_pdf_bytes);
      if (!bytes) {
        const res = await fetchDoc(url, { rules: deps.rules, canton: deps.canton, timeoutMs: Math.min(FETCH_TIMEOUT_MS, left) });
        if (res.kind === "rejected") {
          out.hinweise.push(hinweis(norm.title, "Original-PDF nicht abrufbar"));
          continue;
        }
        if (res.kind !== "ok") {
          out.hinweise.push(hinweis(norm.title, "Original-PDF zurzeit nicht abrufbar"));
          out.vorbehalt = true;
          continue;
        }
        bytes = res.bytes;
      }
      const layout = await parse(bytes, { timeoutMs: Math.min(PARSE_TIMEOUT_MS, Math.max(1_000, deps.deadlineAt - Date.now())) });
      if (layout.scan) out.hinweise.push(hinweis(norm.title, "Das Original ist ein Scan ohne Textlayer"));
      else out.texte.set(norm.id, layout.text);
    } catch (e) {
      console.error("kenndaten: Original-PDF nicht lesbar", norm.id, e instanceof Error ? e.message : e);
      out.hinweise.push(hinweis(norm.title, "Original-PDF nicht lesbar"));
    }
  }
  return out;
}
