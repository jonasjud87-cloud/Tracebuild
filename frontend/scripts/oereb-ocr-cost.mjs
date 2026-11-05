// Kostenmessung fürs Lesen eines Scans durch Claude. Schreibt nichts in die Datenbank und nichts ins Repo.
// Ohne --run gibt es KEINEN Modellaufruf: nur Abruf (oder --file), Seitenzahl und Grenzen.
// Mit --run kostet es echtes Geld: nur mit Freigabe von Jonas. Der Schlüssel kommt aus ANTHROPIC_API_KEY
// in der Umgebung, dieses Skript liest keine .env-Dateien.
//
// Aufruf aus frontend/:
//   node --no-warnings --import ./scripts/ts-resolve-hook.mjs scripts/oereb-ocr-cost.mjs \
//     [--url https://oereblex.sg.ch/api/attachments/17830] [--canton SG] [--title Reglement] \
//     [--file <lokales PDF>] [--model claude-opus-5-5] [--max-usd 3] [--out <Textdatei ausserhalb des Repos>] [--run]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fetchDocument } from "../lib/oereb/document-fetch.ts";
import { OCR_PRICES, pageCountFromText, readPdfWithClaude, textWithoutPageMarkers } from "../lib/oereb/document-ocr.ts";
import { DEFAULT_IMPORT_FILTER, assessContent } from "../lib/oereb/import-filter.ts";
import { extractPdfText } from "../lib/pdf-text.ts";

/** Grosszügig: Gemessen werden soll auch, wenn der Lauf das Funktionslimit überschreiten würde. */
const MEASURE_LIMIT_MS = 900_000;

const opts = { url: "https://oereblex.sg.ch/api/attachments/17830", canton: "SG", title: "Reglement" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, "");
  if (key === "run") opts.run = true;
  else opts[key] = argv[++i];
}

const rules = {
  ...DEFAULT_IMPORT_FILTER,
  ocr_enabled: true,
  ...(opts.model ? { ocr_model: opts.model } : {}),
  ...(opts["max-usd"] ? { ocr_max_cost_usd: Number(opts["max-usd"]) } : {}),
};

let bytes;
if (opts.file) {
  bytes = readFileSync(opts.file);
} else {
  const res = await fetchDocument(opts.url, { rules, canton: opts.canton });
  if (res.kind !== "ok") throw new Error(`Abruf fehlgeschlagen: ${JSON.stringify({ ...res, bytes: undefined })}`);
  bytes = res.bytes;
}

const pdfText = await extractPdfText(bytes, { timeoutMs: 120_000 });
const pages = pageCountFromText(pdfText);
const price = OCR_PRICES[rules.ocr_model];
console.log(`Dokument: ${opts.file ?? opts.url}`);
console.log(`${(bytes.length / 1_048_576).toFixed(1)} MB, ${pages} Seiten, ${textWithoutPageMarkers(pdfText).length} Zeichen Textlayer`);
console.log(`Grenzen: ${rules.ocr_max_pages} Seiten, ${rules.ocr_max_pdf_bytes} Bytes, ${rules.ocr_max_cost_usd} USD`);
console.log(`Modell: ${rules.ocr_model} (${price ? `${price.input} / ${price.output} USD je 1M Tokens` : "KEIN PREIS HINTERLEGT"})`);

if (!opts.run) {
  console.log("Kein Modellaufruf. Mit --run messen (kostet Geld, nur mit Freigabe).");
  process.exit(0);
}

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const result = await readPdfWithClaude(
  { bytes, title: opts.title, pages, rules, deadlineAt: Date.now() + MEASURE_LIMIT_MS },
  new Anthropic()
);
if (result.kind === "retry") {
  console.log(`Nicht gelesen, nichts verbraucht: ${result.detail}`);
  process.exit(1);
}

const seconds = result.durationMs / 1000;
console.log(`Ergebnis: ${result.kind === "read" ? "gelesen" : `fehlgeschlagen (${result.reason}: ${result.detail})`}`);
console.log(`Tokens: ${result.usage.input_tokens} Eingabe, ${result.usage.output_tokens} Ausgabe`);
console.log(`KOSTEN: ${result.costUsd.toFixed(4)} USD (${(result.costUsd / Math.max(1, pages)).toFixed(4)} USD je Seite)`);
console.log(`Dauer: ${seconds.toFixed(0)} s (${(result.usage.output_tokens / Math.max(1, seconds)).toFixed(0)} Tokens/s)`);
if (result.durationMs > rules.ocr_deadline_ms) {
  console.log(`WARNUNG: Auf Vercel bricht der Lauf nach ${rules.ocr_deadline_ms / 1000} s ab. So ginge das Lesen dort nicht durch.`);
}
if (result.kind === "read") {
  const { rejection, sequence } = assessContent(result.text, rules, opts.title);
  console.log(`Text: ${result.text.length} Zeichen, ${sequence.run} fortlaufende Artikel, Inhaltstest: ${rejection ? `${rejection.reason} (${rejection.detail})` : "bestanden"}`);
  if (opts.out) {
    const target = path.resolve(opts.out);
    if (target.startsWith(path.resolve(process.cwd(), ".."))) throw new Error("Text gehört nicht ins Repo: --out ausserhalb wählen");
    writeFileSync(target, result.text);
    console.log(`Text gespeichert: ${target}`);
  }
}
