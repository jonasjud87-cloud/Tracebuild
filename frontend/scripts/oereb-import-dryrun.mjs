// Testlauf des Reglement-Imports ohne Datenbank: gespeicherte Auszüge aller Kantone durch die echte
// Filterlogik. Schreibt nichts in die Datenbank und nichts ins Repo. Nicht in CI (Fair Use).
// Aufruf aus frontend/:
//   node --no-warnings --import ./scripts/ts-resolve-hook.mjs scripts/oereb-import-dryrun.mjs \
//     --raw <Ordner mit KT/extract.json|xml> --cache <Ordner ausserhalb des Repos> \
//     [--extra KT=<Datei> …] [--only KT,KT] [--per-canton 3] [--max-pdf 60] [--pause 3000] \
//     [--offline] [--upload <text.txt> --official <text.txt>]
// Höflich: nur Rechtsvorschriften eines Auszugs, Pausen, nur erlaubte Hosts über fetchDocument (SSRF,
// Redirects, Grösse wie produktiv), höchstens --max-pdf Downloads. Bereits geladene PDFs bleiben im Cache.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseExtractResponse } from "../lib/oereb/adapters/generic.ts";
import { fetchDocument } from "../lib/oereb/document-fetch.ts";
import { measureDocument, planVersionActions } from "../lib/oereb/document-versions.ts";
import { collectCandidates } from "../lib/oereb/documents.ts";
import {
  assessContent,
  contentStatus,
  decidePreDownload,
  documentPriority,
  foreignPlaceInTitle,
  isAmendmentTitle,
  resolveFilterRules,
  scopeOf,
} from "../lib/oereb/import-filter.ts";
import { normalizeExtract } from "../lib/oereb/normalize.ts";
import { OTHER_LEGEND_CANTONS, PRESET_LANGUAGES } from "../lib/oereb/service-quirks.ts";
import { containment, shingleSet } from "../lib/oereb/text-measure.ts";
import { titleKey } from "../lib/oereb/title-key.ts";
import { xmlToObject } from "../lib/oereb/xml.ts";
import { normTextHash } from "../lib/norm-hash.ts";
import { normTextTooLongMessage } from "../lib/norm-text.ts";
import { extractPdfText } from "../lib/pdf-text.ts";

function args() {
  const out = { extra: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key === "offline") out.offline = true;
    else if (key === "extra") out.extra.push(argv[++i]);
    else out[key] = argv[++i];
  }
  return out;
}

const opts = args();
const PER_CANTON = Number(opts["per-canton"] ?? 3);
const MAX_PDF = Number(opts["max-pdf"] ?? 60);
const PAUSE_MS = Number(opts.pause ?? 3000);
const repoRoot = path.resolve(import.meta.dirname, "../..");

// Datenzeilen wie in Migration 20261106000001. Der produktive Stopp ({"doc_types":[]}) gehört nicht
// hierher: Der Testlauf zeigt, was nach dem Freigeben passieren würde.
const FILTER_ROWS = [{ scope: "GE", rules: { title_reject_exact_add: ["loi", "plan"] } }];

if (opts.upload) {
  const upload = shingleSet(readFileSync(opts.upload, "utf8"));
  const official = shingleSet(readFileSync(opts.official, "utf8"));
  console.log(`Anteil des Uploads im amtlichen Text: ${containment(upload, official).toFixed(3)}`);
  process.exit(0);
}
if (!opts.raw || !opts.cache) throw new Error("--raw und --cache sind nötig");
const cacheDir = path.resolve(opts.cache);
if (cacheDir.startsWith(repoRoot)) throw new Error("PDFs gehören nicht ins Repo: --cache ausserhalb wählen");
mkdirSync(cacheDir, { recursive: true });

function loadExtract(file, canton) {
  const text = readFileSync(file, "utf8");
  const parsed = file.endsWith(".xml") ? xmlToObject(text) : JSON.parse(text);
  const normalized = normalizeExtract(parsed, { otherLegend: OTHER_LEGEND_CANTONS.has(canton) });
  return parseExtractResponse(normalized, canton, PRESET_LANGUAGES[canton] ?? "de");
}

/** Der Auszug mit den meisten Dokumenten: Manche Kantone sind mehrfach gespeichert (SO). */
function extractFile(dir) {
  let best = null;
  let most = 0;
  for (const name of ["extract.json", "extract.xml", "extract2.xml", "extract2.json"]) {
    const file = path.join(dir, name);
    if (!existsSync(file) || readFileSync(file).length < 200) continue;
    try {
      const count = loadExtract(file, path.basename(dir)).themes.reduce((n, t) => n + t.lawLinks.length, 0);
      if (count > most) {
        most = count;
        best = file;
      }
    } catch {
      // anderes Format versuchen
    }
  }
  return best;
}

let downloads = 0;
async function loadPdf(url, rules, canton) {
  const name = createHash("sha256").update(url).digest("hex").slice(0, 24);
  const file = path.join(cacheDir, `${name}.pdf`);
  const textFile = `${file}.txt`;
  if (existsSync(textFile)) return { text: readFileSync(textFile, "utf8"), cached: true };
  if (opts.offline) return { skipped: "offline" };
  if (downloads >= MAX_PDF) return { skipped: `Budget von ${MAX_PDF} PDFs erschöpft` };
  downloads++;
  await new Promise((r) => setTimeout(r, PAUSE_MS));
  const res = await fetchDocument(url, { rules, canton });
  if (res.kind === "rejected") return { rejected: res.reason, detail: res.detail };
  if (res.kind !== "ok") return { failed: res.detail ?? res.kind };
  writeFileSync(file, res.bytes);
  try {
    const text = (await extractPdfText(res.bytes, { timeoutMs: 120_000 })).replaceAll("\u0000", "").trim();
    writeFileSync(textFile, text);
    return { text };
  } catch (e) {
    return { rejected: "pdf_unreadable", detail: String(e?.message ?? e) };
  }
}

const c_number = (d) => d.official_number_raw;

async function runCanton(label, canton, file, summary) {
  const rules = resolveFilterRules(FILTER_ROWS, canton);
  const extract = loadExtract(file, canton);
  const themes = extract.themes
    .filter((t) => t.concern === "affects")
    .map((t) => ({ theme_code: t.themeCode, concern: t.concern, law_links: t.lawLinks, raw: t.raw }));
  const candidates = collectCandidates(themes, PRESET_LANGUAGES[canton] ?? "de");
  const municipality = extract.municipality ?? "";

  const docs = candidates.map((c, i) => ({
    id: `d${i}`,
    title: c.title,
    title_key: titleKey(c.title, municipality),
    url_normalized: c.url_normalized,
    official_number: c.official_number,
    official_number_raw: c.official_number_raw,
    scope: scopeOf(c.title, rules, c.official_number_raw),
    status: "pending",
    norm_id: null,
    reject_reason: null,
    pre: decidePreDownload({ title: c.title, doc_type: c.doc_type, authority: c.authority, url: c.url_normalized }, rules, canton),
  }));

  const open = docs.filter((d) => !d.pre).sort((a, b) => documentPriority(a.title, rules) - documentPriority(b.title, rules));
  for (const d of docs.filter((x) => x.pre)) {
    d.status = "rejected";
    d.reject_reason = d.pre.reason;
    d.detail = d.pre.detail;
  }

  let loaded = 0;
  for (const d of open) {
    if (loaded >= PER_CANTON) {
      d.status = "not_loaded";
      d.detail = `über --per-canton ${PER_CANTON}`;
      continue;
    }
    const pdf = await loadPdf(d.url_normalized, rules, canton);
    if (pdf.skipped) {
      d.status = "not_loaded";
      d.detail = pdf.skipped;
      continue;
    }
    loaded++;
    if (pdf.failed) {
      d.status = "failed";
      d.detail = pdf.failed;
      continue;
    }
    if (pdf.rejected) {
      d.status = "rejected";
      d.reject_reason = pdf.rejected;
      d.detail = pdf.detail;
      continue;
    }
    // Wie decideIdentity: Derselbe Text unter anderer URL wird nicht doppelt übernommen (VS Sion).
    const sha = normTextHash(pdf.text);
    const same = docs.find((x) => x.text_sha === sha && x.status === "imported" && x.scope === "municipal");
    d.text_sha = sha;
    if (same) {
      d.status = "rejected";
      d.reject_reason = "duplicate_content";
      d.detail = `Gleicher Text wie «${same.title}»`;
      continue;
    }
    const assessment = assessContent(pdf.text, rules, d.title);
    Object.assign(d, measureDocument(d.title, pdf.text, rules), { chars: pdf.text.length, letterWithArticles: assessment.letterWithArticles });
    if (assessment.rejection) {
      d.status = contentStatus(assessment.rejection.reason, d.title, rules, c_number(d));
      d.reject_reason = assessment.rejection.reason;
      d.detail = assessment.rejection.detail;
    } else if (normTextTooLongMessage(pdf.text)) {
      d.status = "rejected";
      d.reject_reason = "too_long";
      d.detail = `${pdf.text.length} Zeichen`;
    } else if (foreignPlaceInTitle(d.title, municipality, rules)) {
      d.status = "review";
      d.reject_reason = "foreign_place";
      d.detail = `Titel nennt «${foreignPlaceInTitle(d.title, municipality, rules)}»`;
    } else {
      d.status = "imported";
      d.norm_id = d.id;
    }
  }

  // Wie im Import: Der Vergleich läuft über die gespeicherten Messwerte eines Auszugs.
  const measured = docs.filter((d) => typeof d.article_run === "number");
  const steps = planVersionActions(measured, measured, rules, Date.now());
  for (const step of steps) {
    const d = docs.find((x) => x.id === step.docId);
    if (step.action === "retire" || step.action === "relabel") {
      d.status = "rejected";
      d.reject_reason = "older_version";
      d.detail = step.detail;
    } else if (step.action === "note") {
      d.version_note = step.note;
    }
  }

  const suspects = [];
  for (const d of docs) {
    const reasons = [];
    if (d.version_note) reasons.push("Fassung unklar, beide übernommen");
    if (d.status === "imported") {
      if (d.letterWithArticles) reasons.push("Briefkopf, aber Artikel");
      if ((d.article_first ?? 1) > 1 && !isAmendmentTitle(d.title, rules)) reasons.push(`Folge beginnt bei ${d.article_first}`);
      if (d.article_run < 10 && !isAmendmentTitle(d.title, rules)) reasons.push(`nur ${d.article_run} Artikel`);
    }
    if (d.status === "rejected" && d.scope === "municipal" && ["no_articles", "scan_or_short", "too_large", "too_long", "pdf_unreadable"].includes(d.reject_reason)) {
      reasons.push(`Gemeinde-Titel abgelehnt (${d.reject_reason})`);
    }
    if (d.status === "not_loaded" && d.scope === "municipal") reasons.push("Gemeinde-Titel nicht geladen");
    if (reasons.length) suspects.push({ d, reasons });
  }

  const imported = docs.filter((d) => d.status === "imported");
  const rejected = docs.filter((d) => d.status === "rejected");
  const review = docs.filter((d) => d.status === "review");
  summary.push({
    label,
    imported: imported.length,
    municipal: imported.filter((d) => d.scope === "municipal").length,
    rejected: rejected.length,
    review: review.length,
    downloadRejected: rejected.filter((d) => typeof d.article_run === "number" || !d.pre).length,
    older: rejected.filter((d) => d.reject_reason === "older_version").length,
    suspects: suspects.length,
    notLoaded: docs.filter((d) => d.status === "not_loaded").length,
    numbers: candidates.filter((c) => c.official_number).length,
    total: candidates.length,
  });

  console.log(`\n═══ ${label} ${municipality} (${path.basename(file)}): ${candidates.length} Dokumente, ${candidates.filter((c) => c.official_number).length} mit amtlicher Nummer`);
  const short = (s) => (s.length > 62 ? `${s.slice(0, 59)}…` : s);
  const facts = (d) =>
    `${d.chars ?? "?"} Z., Folge ${d.article_run ?? "-"}${d.article_first ? ` ab ${d.article_first}` : ""}, Treffer ${d.article_hits ?? "-"}${d.stand_date ? `, Stand ${d.stand_date}` : ""}`;
  for (const d of imported) console.log(`  ÜBERNOMMEN ${d.scope.padEnd(9)} ${short(d.title)} [${facts(d)}] ${d.official_number ?? ""}`);
  const byReason = new Map();
  for (const d of rejected) byReason.set(d.reject_reason, [...(byReason.get(d.reject_reason) ?? []), d]);
  for (const [reason, list] of byReason) {
    const contentful = list.some((d) => typeof d.article_run === "number");
    if (contentful) for (const d of list) console.log(`  ABGELEHNT  ${reason.padEnd(18)} ${short(d.title)} [${facts(d)}] ${d.detail ?? ""}`);
    else console.log(`  abgelehnt  ${reason.padEnd(18)} ${list.length}×: ${list.slice(0, 3).map((d) => short(d.title)).join(" | ")}`);
  }
  for (const d of review) console.log(`  PRÜFEN     ${d.scope.padEnd(9)} ${short(d.title)} [${facts(d)}] ${d.detail ?? ""}`);
  for (const d of docs.filter((x) => x.status === "failed")) console.log(`  FEHLER     ${short(d.title)}: ${d.detail}`);
  for (const d of docs.filter((x) => x.status === "not_loaded")) console.log(`  offen      ${d.scope.padEnd(9)} ${short(d.title)} (${d.detail})`);
  for (const { d, reasons } of suspects) console.log(`  VERDACHT   ${short(d.title)}: ${reasons.join("; ")}`);
}

const raw = path.resolve(opts.raw);
const only = opts.only ? new Set(opts.only.split(",")) : null;
const cantons = readdirSync(raw).filter((n) => /^[A-Z]{2}$/.test(n)).sort();
const summary = [];
for (const canton of cantons) {
  if (only && !only.has(canton)) continue;
  const file = extractFile(path.join(raw, canton));
  if (!file) {
    console.log(`\n═══ ${canton}: kein auswertbarer Auszug gespeichert`);
    summary.push({ label: canton, none: true });
    continue;
  }
  try {
    await runCanton(canton, canton, file, summary);
  } catch (e) {
    console.log(`\n═══ ${canton}: Fehler ${e?.message ?? e}`);
    summary.push({ label: canton, none: true });
  }
}
for (const entry of opts.extra) {
  const [canton, file] = entry.split("=");
  await runCanton(`${canton}+`, canton, file, summary);
}

console.log("\nKanton | übernommen (Gemeinde) | abgelehnt (nach Download) | zur Prüfung | ältere Fassung | Verdacht | nicht geladen | Nummern");
for (const s of summary) {
  if (s.none) console.log(`${s.label} | kein Auszug`);
  else console.log(`${s.label} | ${s.imported} (${s.municipal}) | ${s.rejected} (${s.downloadRejected}) | ${s.review} | ${s.older} | ${s.suspects} | ${s.notLoaded} | ${s.numbers}/${s.total}`);
}
console.log(`\nDownloads in diesem Lauf: ${downloads} (Budget ${MAX_PDF})`);
