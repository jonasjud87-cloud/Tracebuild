import type { FetchLike } from "./fedlex";
import { PDF_LIMIT_BYTES, assertOrigin, readJsonLimited, readLimited } from "./limits";
import { cleanPlainText, formatStandDate } from "./text";
import type { RemoteVersion } from "./types";

const API = "https://www.gesetzessammlung.sg.ch/api/de/texts_of_law/";
const HOST_PREFIX = "https://www.gesetzessammlung.sg.ch/";
const SGS_RE = /^\d{1,3}(?:\.\d{1,4})*$/;

export const isValidSgs = (value: string): boolean => SGS_RE.test(value);

export type PdfTextExtractor = (bytes: Buffer) => Promise<string>;

interface SgTextOfLaw {
  title?: string;
  abbreviation?: string;
  abrogated?: boolean;
  version_uid?: string;
  pdf_link?: string;
  current_version?: { version_dates_str?: string };
}

export function standFromDates(dates: string | undefined): string | null {
  const m = /seit:\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(dates ?? "");
  if (!m) return null;
  return `Stand ${formatStandDate(`${m[3]}-${m[2]}-${m[1]}`)}`;
}

export async function sgCurrent(nr: string, fetchFn: FetchLike, extractPdf: PdfTextExtractor): Promise<RemoteVersion> {
  if (!isValidSgs(nr)) throw new Error(`Ungültige sGS-Nummer: ${nr}`);
  const res = await fetchFn(`${API}${nr}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) throw new Error(`sGS ${nr} in der Gesetzessammlung nicht gefunden`);
  if (!res.ok) throw new Error(`Gesetzessammlung antwortet mit ${res.status}`);
  assertOrigin(res, HOST_PREFIX);
  const law = ((await readJsonLimited(res)) as { text_of_law?: SgTextOfLaw } | null)?.text_of_law;
  if (!law || typeof law.version_uid !== "string" || typeof law.pdf_link !== "string") {
    throw new Error(`Unerwartete Antwort der Gesetzessammlung für sGS ${nr}`);
  }
  if (law.abrogated) throw new Error(`sGS ${nr} ist aufgehoben`);
  if (!law.pdf_link.startsWith(HOST_PREFIX)) throw new Error("PDF-Adresse der Gesetzessammlung nicht vertrauenswürdig");
  const pdfLink = law.pdf_link;
  return {
    version: law.version_uid,
    label: standFromDates(law.current_version?.version_dates_str) ?? "Stand unbekannt",
    title: law.title ?? null,
    fetchText: async () => {
      const file = await fetchFn(pdfLink, { signal: AbortSignal.timeout(90_000) });
      if (!file.ok) throw new Error(`PDF der Gesetzessammlung nicht ladbar (${file.status})`);
      assertOrigin(file, HOST_PREFIX);
      const text = cleanPlainText(await extractPdf(Buffer.from(await readLimited(file, PDF_LIMIT_BYTES))));
      if (!text.trim()) throw new Error("Aus dem PDF liess sich kein Text lesen");
      return text;
    },
  };
}
