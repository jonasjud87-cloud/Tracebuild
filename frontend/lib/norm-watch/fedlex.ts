import { XML_LIMIT_BYTES, assertOrigin, readJsonLimited, readTextLimited } from "./limits";
import { formatStandDate, xmlToText } from "./text";
import type { RemoteVersion } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ENDPOINT = "https://fedlex.data.admin.ch/sparqlendpoint";
const FILE_PREFIX = "https://fedlex.data.admin.ch/filestore/";
const XSD_DATE = "http://www.w3.org/2001/XMLSchema#date";
const SR_RE = /^\d{1,3}(?:\.\d{1,4})*$/;

export const isValidSr = (value: string): boolean => SR_RE.test(value);

export function buildCurrentQuery(sr: string, todayIso: string): string {
  if (!isValidSr(sr)) throw new Error(`Ungültige SR-Nummer: ${sr}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) throw new Error(`Ungültiges Datum: ${todayIso}`);
  const date = `"${todayIso}"^^<${XSD_DATE}>`;
  return [
    "PREFIX jolux: <http://data.legilux.public.lu/resource/ontology/jolux#>",
    "SELECT ?from ?file WHERE {",
    `  ?act jolux:historicalLegalId "${sr}" .`,
    "  ?cons jolux:isMemberOf ?act ; jolux:dateApplicability ?from .",
    "  OPTIONAL { ?cons jolux:dateEndApplicability ?to }",
    `  FILTER(?from <= ${date})`,
    `  FILTER(!BOUND(?to) || ?to >= ${date})`,
    "  ?cons jolux:isRealizedBy ?expr .",
    "  ?expr jolux:isEmbodiedBy ?man .",
    "  ?man jolux:isExemplifiedBy ?file .",
    '  FILTER(CONTAINS(STR(?file), "/de/xml/"))',
    "} ORDER BY DESC(?from) ASC(STR(?file)) LIMIT 1",
  ].join("\n");
}

interface SparqlBinding {
  from?: { value?: string };
  file?: { value?: string };
}

export function parseCurrent(json: unknown): { from: string; file: string } | null {
  const bindings = (json as { results?: { bindings?: SparqlBinding[] } } | null)?.results?.bindings;
  const first = Array.isArray(bindings) ? bindings[0] : undefined;
  const from = first?.from?.value;
  const file = first?.file?.value;
  if (typeof from !== "string" || typeof file !== "string") return null;
  if (!file.startsWith(FILE_PREFIX)) return null;
  return { from, file };
}

export async function fedlexCurrent(sr: string, today: Date, fetchFn: FetchLike = fetch): Promise<RemoteVersion> {
  const query = buildCurrentQuery(sr, today.toISOString().slice(0, 10));
  const res = await fetchFn(ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ query }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Fedlex antwortet mit ${res.status}`);
  assertOrigin(res, "https://fedlex.data.admin.ch/");
  const current = parseCurrent(await readJsonLimited(res));
  if (!current) throw new Error(`Keine gültige Fassung für SR ${sr} bei Fedlex gefunden`);
  return {
    version: current.from,
    label: `Stand ${formatStandDate(current.from)}`,
    title: null,
    fetchText: async () => {
      const file = await fetchFn(current.file, { signal: AbortSignal.timeout(60_000) });
      if (!file.ok) throw new Error(`Fedlex-Datei nicht ladbar (${file.status})`);
      assertOrigin(file, FILE_PREFIX);
      const text = xmlToText(await readTextLimited(file, XML_LIMIT_BYTES));
      if (!text.trim()) throw new Error("Fedlex-Datei enthält keinen Text");
      return text;
    },
  };
}
