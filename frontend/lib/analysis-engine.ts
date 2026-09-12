/**
 * Analyse-Engine: Bauplan gegen Normen prüfen.
 *
 * Warum aufgeteilt statt ein Call?
 * Ein einziger Call muss ALLE zugewiesenen Normen in EINE Antwort schreiben. Gemessen
 * (Projekt Obergasse, 8 Normen): nach 8'192 Output-Tokens war die Antwort mitten im
 * String abgeschnitten und deckte 2 von 8 Normen ab. Ein vollständiger Lauf braucht
 * 30'000–40'000 Output-Tokens — die zwar in ein max_tokens von 64k passen würden, aber
 * sequenziell generiert das Vercel-Limit von 300 s sprengen.
 *
 * Deshalb: ein Call pro Norm. Jeder Teilcall hat ein winziges Output-Budget (deshalb
 * kein max_tokens-Abbruch), die Calls laufen parallel (deshalb im Zeitlimit), und ein
 * kaputter Teilcall kostet nur seine eigene Norm (deshalb überleben Teilergebnisse).
 *
 * Damit das PDF nicht N-mal bezahlt wird, liegt der Cache-Breakpoint hinter dem
 * stabilen Teil (System-Prompt + PDF). Der variable Teil — der Normtext — steht
 * dahinter. Call 1 schreibt den Cache, die restlichen N-1 lesen ihn für 10 %.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";

// ── Modell & Preise ───────────────────────────────────────────────────────────

export const ANALYSIS_MODEL = "claude-sonnet-5";

/** USD pro 1M Tokens. Cache-Write = 1.25x Input, Cache-Read = 0.1x Input. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5":     { input: 5, output: 25 },
  "claude-sonnet-5":   { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5":  { input: 1, output: 5 },
};

/** Output-Budget pro Norm-Call. Grosszügig — ein Norm-Call braucht real 2–6k. */
const MAX_TOKENS_PER_NORM = 32_000;

/** Obergrenze Prüfpunkte pro Norm. Hält das Output-Budget hart begrenzt. */
const MAX_CHECKS_PER_NORM = 25;

/** Wie viele Norm-Calls gleichzeitig laufen dürfen. */
const MAX_CONCURRENCY = Number(process.env.ANALYSIS_MAX_CONCURRENCY ?? 8);

/**
 * Denktiefe. Gemessen an der Norm Mels_Baureglement (53'825 Zeichen):
 * effort "high" 232 s ohne Ergebnis (adaptives Denken lief davon), effort "medium"
 * 72 s mit 25 Prüfpunkten. Bei einem 300-s-Deckel ist "medium" die belastbare Wahl.
 */
const EFFORT: "low" | "medium" | "high" = "medium";

/**
 * Gesamtbudget der Modell-Phase. Vercel bricht die Route bei 300 s ab; der Rest ist
 * Reserve für Upload, DB-Inserts und Response.
 */
const RUN_BUDGET_MS = Number(process.env.ANALYSIS_BUDGET_MS ?? 235_000);

/** Deckel für einen einzelnen Norm-Call, damit ein Ausreisser Zeit für den Rettungsversuch lässt. */
const PER_CALL_BUDGET_MS = 130_000;

/** Ab so viel Restzeit lohnt sich ein zweiter Versuch für eine gescheiterte Norm. */
const RETRY_MIN_REMAINING_MS = 60_000;

/** Wie lange maximal auf den Cache-Write von Call 1 gewartet wird, bevor gefächert wird. */
const PREFILL_GATE_MAX_MS = 75_000;

// ── Kategorien ────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  "grenzabstand",
  "gebaeudehöhe",
  "erschliessung",
  "brandschutz",
  "parkierung",
  "andere",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Status = "ok" | "fail" | "warn";
export type Confidence = "high" | "medium" | "low";

/**
 * `gebaeudehöhe` ist der kanonische Wert (so steht er in lib/domains/bau.ts und in der
 * DB). Das Modell schrieb bisher `gebäudehöhe` — und fiel damit still auf `andere`.
 * Hier landen alle Schreibweisen auf dem kanonischen Wert.
 */
const CATEGORY_ALIASES: Record<string, Category> = {
  "gebaeudehohe": "gebaeudehöhe",
  "gebaeudehöhe": "gebaeudehöhe",
  "gebaeudehoehe": "gebaeudehöhe",
  "gebäudehöhe": "gebaeudehöhe",
  "gebäudehohe": "gebaeudehöhe",
  "gebäudehoehe": "gebaeudehöhe",
  "gebaudehohe": "gebaeudehöhe",
  "hoehe": "gebaeudehöhe",
  "höhe": "gebaeudehöhe",
  "firsthöhe": "gebaeudehöhe",
  "firsthoehe": "gebaeudehöhe",
  "gesamthöhe": "gebaeudehöhe",
  "gesamthoehe": "gebaeudehöhe",
  "grenzabstand": "grenzabstand",
  "abstand": "grenzabstand",
  "abstaende": "grenzabstand",
  "abstände": "grenzabstand",
  "gebaeudeabstand": "grenzabstand",
  "gebäudeabstand": "grenzabstand",
  "strassenabstand": "grenzabstand",
  "erschliessung": "erschliessung",
  "erschließung": "erschliessung",
  "zufahrt": "erschliessung",
  "brandschutz": "brandschutz",
  "feuerpolizei": "brandschutz",
  "parkierung": "parkierung",
  "parkplatz": "parkierung",
  "abstellplaetze": "parkierung",
  "abstellplätze": "parkierung",
  "andere": "andere",
};

export function normalizeCategory(raw: unknown): Category {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return "andere";
  return CATEGORY_ALIASES[key] ?? "andere";
}

// ── Datentypen ────────────────────────────────────────────────────────────────

export interface NormInput {
  id: string;
  title: string;
  category: string | null;
  text: string;
}

export interface CheckItem {
  check_id: string;
  norm_id: string | null;
  norm_title: string;
  category: Category;
  status: Status;
  finding: string;
  suggestion: string | null;
  confidence: Confidence;
  page_reference: number | null;
}

export interface NormCallResult {
  norm_id: string;
  norm_title: string;
  ok: boolean;
  error: string | null;
  stop_reason: string | null;
  /** true, wenn dieses Ergebnis aus dem zweiten Versuch stammt. */
  retried: boolean;
  item_count: number;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  duration_ms: number;
}

export interface UsageTotals {
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
}

export interface AnalysisRunResult {
  items: CheckItem[];
  calls: NormCallResult[];
  usage: UsageTotals;
  cost_usd: number;
  duration_ms: number;
  model: string;
  /** Normen, für die kein sauberes Ergebnis vorliegt (Fehler, Timeout, max_tokens). */
  failed_norms: { norm_id: string; norm_title: string; error: string }[];
}

export type FileBlock = Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam;

export interface ProjectContext {
  municipality: string;
  canton: string;
  bauzone: string;
  parcel?: string | null;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_BASE = `Du bist ein Schweizer Baurechtsexperte und prüfst Baupläne auf Normkonformität.

Du erhältst in jedem Auftrag:
- den vollständigen Bauplan als PDF (alle Seiten, 1-basiert nummeriert)
- den Projektkontext
- GENAU EINE Norm mit ihrem vollständigen Text

Deine Aufgabe:
- Prüfe den Bauplan ausschliesslich gegen diese eine Norm. Andere Normen sind nicht dein Auftrag.
- Zerlege die Norm in ihre prüfbaren Einzelbestimmungen (Artikel/Absätze) und gib pro
  relevanter Bestimmung genau einen Prüfpunkt aus.
- status: "ok" = anhand des Plans nachweislich eingehalten. "fail" = nachweislich verletzt.
  "warn" = aus dem Plan nicht abschliessend beurteilbar oder Nachweis fehlt.
- finding: was konkret im Plan gemessen/erkannt wurde — mit Massen, Kote, Bauteil und Seite.
  Keine Wiederholung des Gesetzestextes, keine Floskeln. Ein Architekt liest das.
- suggestion: eine konkrete, umsetzbare Massnahme. Bei status "ok" ein leerer String.
- page_reference: PDF-Seitenzahl 1-basiert. 0, wenn kein Bezug auf eine einzelne Seite möglich ist.
- confidence: "high" nur, wenn der Plan die Angabe wirklich hergibt.
- Bestimmungen, die auf dieses Projekt gar nicht anwendbar sind, lässt du weg — ausser die
  Nichtanwendbarkeit ist selbst ein relevanter Befund (z.B. Schwellenwert knapp unterschritten).
- Maximal ${MAX_CHECKS_PER_NORM} Prüfpunkte. Priorisiere fail vor warn vor ok.
- Wähle die category aus der vorgegebenen Liste; "andere" nur, wenn nichts passt.`;

export function buildSystemPrompt(ctx: ProjectContext): string {
  return (
    `${SYSTEM_BASE}\n\n` +
    `PROJEKTKONTEXT (gilt für alle Prüfungen):\n` +
    `- Gemeinde: ${ctx.municipality || "unbekannt"}\n` +
    `- Kanton: ${ctx.canton || "unbekannt"}\n` +
    `- Bauzone: ${ctx.bauzone || "unbekannt"}\n` +
    (ctx.parcel ? `- Parzelle: ${ctx.parcel}\n` : "")
  );
}

export function buildNormBlock(norm: NormInput, index: number, total: number): string {
  return (
    `ZU PRÜFENDE NORM (${index + 1} von ${total}):\n` +
    `Titel: ${norm.title}\n` +
    `Kategorie: ${norm.category ?? "unbekannt"}\n` +
    `--- NORMTEXT ANFANG ---\n${norm.text}\n--- NORMTEXT ENDE ---\n\n` +
    `Prüfe den beigefügten Bauplan gegen diese Norm.`
  );
}

// ── Structured Output Schema ──────────────────────────────────────────────────

/**
 * Bewusst Structured Outputs statt Fence-Parsing: das Format wird beim Sampling
 * erzwungen, es kann also gar kein ```json-Fence und kein halbes Objekt entstehen.
 *
 * Bewusst OHNE norm_id und check_id: die norm_id setzen wir serverseitig aus der Norm,
 * die wir gefragt haben. Damit ist eine halluzinierte UUID (und die daraus folgende
 * FK-Verletzung) strukturell unmöglich, und wir sparen Output-Tokens.
 *
 * Bewusst ohne nullable-Typen: `suggestion` ist ein String ("" = keine), `page_reference`
 * ein Integer (0 = unbekannt). Union-Typen sind im Structured-Output-Subset heikel.
 */
export const CHECK_OUTPUT_SCHEMA = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      checks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            norm_title:     { type: "string", description: "Titel bzw. Artikel der geprüften Bestimmung" },
            category:       { type: "string", enum: [...CATEGORIES] },
            status:         { type: "string", enum: ["ok", "fail", "warn"] },
            finding:        { type: "string" },
            suggestion:     { type: "string", description: "Leerer String bei status=ok" },
            confidence:     { type: "string", enum: ["high", "medium", "low"] },
            page_reference: { type: "integer", description: "1-basierte PDF-Seite, 0 = unbekannt" },
          },
          required: ["norm_title", "category", "status", "finding", "suggestion", "confidence", "page_reference"],
          additionalProperties: false,
        },
      },
    },
    required: ["checks"],
    additionalProperties: false,
  },
};

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Bergungs-Parser. Structured Outputs macht ihn im Normalfall arbeitslos; er greift
 * nur, wenn die Antwort trotzdem unvollständig ankommt (Abbruch, Netzfehler). Er
 * verkraftet gefenced, ungefenced und mitten im Array abgeschnitten, weil er nicht das
 * Ganze parst, sondern jedes balancierte Objekt einzeln.
 */
export function salvageCheckObjects(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const starts: number[] = [];
  let inStr = false;
  let esc = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { starts.push(i); continue; }
    if (c === "}") {
      const start = starts.pop();
      if (start === undefined) continue;
      try {
        const obj = JSON.parse(raw.slice(start, i + 1));
        if (obj && typeof obj === "object" && !Array.isArray(obj) && typeof obj.finding === "string") {
          out.push(obj as Record<string, unknown>);
        }
      } catch {
        /* unvollständig — nächstes Objekt */
      }
    }
  }
  return out;
}

/** Primärpfad: sauberes JSON. Sekundärpfad: Bergung. Wirft nie. */
export function parseChecks(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)(?:\s*```)?$/);
  const body = fence ? fence[1] : trimmed;

  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    if (parsed && typeof parsed === "object") {
      const checks = (parsed as { checks?: unknown }).checks;
      if (Array.isArray(checks)) return checks as Record<string, unknown>[];
    }
  } catch {
    /* fällt auf Bergung zurück */
  }
  return salvageCheckObjects(body);
}

function toCheckItem(raw: Record<string, unknown>, norm: NormInput): CheckItem {
  const suggestion = typeof raw.suggestion === "string" ? raw.suggestion.trim() : "";
  const page = Number(raw.page_reference);
  const status = String(raw.status ?? "");
  const confidence = String(raw.confidence ?? "");

  return {
    check_id: crypto.randomUUID(),
    // Immer die Norm, die wir gefragt haben — nie ein Wert aus der Modellantwort.
    // Leere id = synthetische Ersatznorm ohne DB-Zeile.
    norm_id: norm.id ? norm.id : null,
    norm_title: String(raw.norm_title ?? norm.title).slice(0, 500) || norm.title,
    category: normalizeCategory(raw.category),
    status: (status === "ok" || status === "fail" || status === "warn" ? status : "warn") as Status,
    finding: String(raw.finding ?? "").trim(),
    suggestion: suggestion.length > 0 ? suggestion : null,
    confidence: (confidence === "high" || confidence === "low" ? confidence : "medium") as Confidence,
    page_reference: Number.isInteger(page) && page > 0 ? page : null,
  };
}

// ── Kosten ────────────────────────────────────────────────────────────────────

export function computeCost(usage: UsageTotals, model: string = ANALYSIS_MODEL): number {
  const price = PRICES[model] ?? PRICES[ANALYSIS_MODEL];
  return (
    (usage.input_tokens * price.input +
      usage.cache_write_tokens * price.input * 1.25 +
      usage.cache_read_tokens * price.input * 0.1 +
      usage.output_tokens * price.output) /
    1_000_000
  );
}

// ── Ein Call pro Norm ─────────────────────────────────────────────────────────

interface CallOutcome {
  result: NormCallResult;
  items: CheckItem[];
}

function isTimeoutError(msg: string | null): boolean {
  return !!msg && /Zeitbudget|timeout|timed out|aborted/i.test(msg);
}

async function analyseOneNorm(
  norm: NormInput,
  index: number,
  total: number,
  system: string,
  fileBlock: FileBlock,
  runDeadlineAt: number,
  onPrefillDone: (() => void) | null,
  effort: "low" | "medium" | "high" = EFFORT,
  cancelSignal: AbortSignal | null = null,
): Promise<CallOutcome> {
  const startedAt = Date.now();
  const deadlineAt = Math.min(runDeadlineAt, startedAt + PER_CALL_BUDGET_MS);
  const usage: UsageTotals = { input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
  let stopReason: string | null = null;
  let text = "";
  let error: string | null = null;
  let gateFired = false;

  const fireGate = () => {
    if (!gateFired) {
      gateFired = true;
      onPrefillDone?.();
    }
  };

  // Harte Wanduhr-Garantie: der Abbruch hängt nicht daran, dass Stream-Events kommen.
  // Während einer langen Denkphase (display "omitted") fliesst minutenlang nichts.
  const controller = new AbortController();
  const killTimer = setTimeout(() => controller.abort(), Math.max(1_000, deadlineAt - Date.now()));
  // Nutzer-Abbruch: reisst den laufenden Call mit, damit keine Tokens mehr verbraucht werden.
  const onCancel = () => controller.abort();
  cancelSignal?.addEventListener("abort", onCancel, { once: true });

  try {
    if (cancelSignal?.aborted) throw new Error("Analyse abgebrochen");
    const remaining = deadlineAt - Date.now();
    if (remaining <= 5_000) throw new Error("Zeitbudget aufgebraucht, bevor der Call startete");

    // Cache-Grenze: alles VOR dem Breakpoint ist über alle Norm-Calls byte-identisch
    // (system + PDF). Der Normtext steht dahinter und variiert pro Call.
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          { ...fileBlock, cache_control: { type: "ephemeral" } } as FileBlock,
          { type: "text", text: buildNormBlock(norm, index, total) },
        ],
      },
    ];

    const stream = anthropic.messages.stream(
      {
        model: ANALYSIS_MODEL,
        max_tokens: MAX_TOKENS_PER_NORM,
        system: [{ type: "text", text: system }],
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort, format: CHECK_OUTPUT_SCHEMA },
      },
      { timeout: Math.max(10_000, remaining), signal: controller.signal },
    );

    for await (const ev of stream) {
      if (ev.type === "message_start") {
        const u = ev.message.usage;
        usage.input_tokens = u.input_tokens ?? 0;
        usage.cache_write_tokens = u.cache_creation_input_tokens ?? 0;
        usage.cache_read_tokens = u.cache_read_input_tokens ?? 0;
        usage.output_tokens = u.output_tokens ?? 0;
      } else if (ev.type === "content_block_start") {
        // Prefill ist durch — ab jetzt ist der Cache-Eintrag für die anderen Calls lesbar.
        fireGate();
      } else if (ev.type === "message_delta") {
        usage.output_tokens = ev.usage.output_tokens ?? usage.output_tokens;
      }
      if (Date.now() > deadlineAt) {
        stream.abort();
        throw new Error("Zeitbudget der Analyse überschritten");
      }
    }

    const message = await stream.finalMessage();
    stopReason = message.stop_reason ?? null;
    usage.input_tokens = message.usage.input_tokens ?? usage.input_tokens;
    usage.cache_write_tokens = message.usage.cache_creation_input_tokens ?? usage.cache_write_tokens;
    usage.cache_read_tokens = message.usage.cache_read_input_tokens ?? usage.cache_read_tokens;
    usage.output_tokens = message.usage.output_tokens ?? usage.output_tokens;

    text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // stop_reason wird ausgewertet — abgeschnitten ist kein Erfolg.
    if (stopReason === "max_tokens") {
      error = `Antwort bei ${MAX_TOKENS_PER_NORM} Output-Tokens abgeschnitten`;
    } else if (stopReason === "refusal") {
      error = `Modell hat die Prüfung abgelehnt (${message.stop_details?.category ?? "unbekannt"})`;
    } else if (stopReason !== "end_turn" && stopReason !== null) {
      error = `Unerwarteter stop_reason: ${stopReason}`;
    }
  } catch (e) {
    error = cancelSignal?.aborted
      ? "Analyse abgebrochen"
      : controller.signal.aborted
        ? "Zeitbudget der Analyse überschritten"
        : e instanceof Error ? e.message : "Unbekannter Fehler";
  } finally {
    clearTimeout(killTimer);
    cancelSignal?.removeEventListener("abort", onCancel);
    fireGate();
  }

  // Auch bei Fehler wird geborgen, was da ist — Prüfpunkte gehen nicht verloren.
  let items: CheckItem[] = [];
  if (text.trim().length > 0) {
    items = parseChecks(text)
      .map((raw) => toCheckItem(raw, norm))
      .filter((it) => it.finding.length > 0)
      .slice(0, MAX_CHECKS_PER_NORM);
  }
  if (items.length === 0 && !error) {
    error = "Modell lieferte keine Prüfpunkte";
  }

  return {
    items,
    result: {
      norm_id: norm.id,
      norm_title: norm.title,
      ok: error === null,
      error,
      stop_reason: stopReason,
      retried: false,
      item_count: items.length,
      input_tokens: usage.input_tokens,
      cache_write_tokens: usage.cache_write_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      output_tokens: usage.output_tokens,
      duration_ms: Date.now() - startedAt,
    },
  };
}

// ── Orchestrierung ────────────────────────────────────────────────────────────

/**
 * Fährt einen Call pro Norm.
 *
 * Ablauf: Call 1 startet allein und schreibt den Cache (System + PDF). Sobald sein
 * erster Content-Block kommt, ist das Prefill durch und der Eintrag lesbar — erst dann
 * werden die restlichen Calls gefeuert, sonst zahlen alle N den vollen Preis
 * (parallele Requests können nicht lesen, was die anderen gerade schreiben).
 *
 * Wirft nie. Ein kaputter Teilcall taucht in `failed_norms` auf, alle anderen
 * Prüfpunkte bleiben erhalten.
 */
export async function runNormAnalysis(
  norms: NormInput[],
  fileBlock: FileBlock,
  ctx: ProjectContext,
  budgetMs: number = RUN_BUDGET_MS,
  cancelSignal: AbortSignal | null = null,
): Promise<AnalysisRunResult> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + budgetMs;
  const system = buildSystemPrompt(ctx);
  const total = norms.length;

  const outcomes: CallOutcome[] = [];

  if (total > 0) {
    // Torwächter: löst auf, sobald Call 1 den Cache geschrieben hat (oder scheitert).
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => { openGate = resolve; });

    const firstPromise = analyseOneNorm(norms[0], 0, total, system, fileBlock, deadlineAt, openGate, EFFORT, cancelSignal);

    await Promise.race([
      gate,
      new Promise<void>((resolve) => setTimeout(resolve, PREFILL_GATE_MAX_MS)),
    ]);

    const rest = norms.slice(1);
    const restOutcomes: CallOutcome[] = [];
    for (let offset = 0; offset < rest.length; offset += MAX_CONCURRENCY) {
      if (cancelSignal?.aborted) break;
      const wave = rest.slice(offset, offset + MAX_CONCURRENCY);
      const settled = await Promise.all(
        wave.map((n, k) => analyseOneNorm(n, offset + k + 1, total, system, fileBlock, deadlineAt, null, EFFORT, cancelSignal)),
      );
      restOutcomes.push(...settled);
    }

    outcomes.push(await firstPromise, ...restOutcomes);

    // Rettungsdurchgang: gescheiterte Normen bekommen einen zweiten Versuch, solange
    // Restzeit da ist. Ein Timeout wird mit weniger Denktiefe wiederholt (sonst läuft
    // es erneut in dieselbe Wand), alles andere unverändert — dann bleibt der Cache warm.
    for (let i = 0; i < outcomes.length; i++) {
      const o = outcomes[i];
      if (o.result.ok) continue;
      if (cancelSignal?.aborted) break;
      if (deadlineAt - Date.now() < RETRY_MIN_REMAINING_MS) break;

      const normIndex = norms.findIndex((n) => n.id === o.result.norm_id);
      if (normIndex < 0) continue;
      const retryEffort = isTimeoutError(o.result.error) ? "low" : EFFORT;
      const retry = await analyseOneNorm(
        norms[normIndex], normIndex, total, system, fileBlock, deadlineAt, null, retryEffort, cancelSignal,
      );
      retry.result.retried = true;
      // Der Versuch mit mehr Prüfpunkten gewinnt; die Tokens beider Versuche zählen.
      if (retry.result.ok || retry.items.length > o.items.length) {
        retry.result.input_tokens += o.result.input_tokens;
        retry.result.cache_write_tokens += o.result.cache_write_tokens;
        retry.result.cache_read_tokens += o.result.cache_read_tokens;
        retry.result.output_tokens += o.result.output_tokens;
        retry.result.duration_ms += o.result.duration_ms;
        outcomes[i] = retry;
      } else {
        o.result.input_tokens += retry.result.input_tokens;
        o.result.cache_write_tokens += retry.result.cache_write_tokens;
        o.result.cache_read_tokens += retry.result.cache_read_tokens;
        o.result.output_tokens += retry.result.output_tokens;
        o.result.retried = true;
      }
    }
  }

  const usage: UsageTotals = { input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
  for (const o of outcomes) {
    usage.input_tokens += o.result.input_tokens;
    usage.cache_write_tokens += o.result.cache_write_tokens;
    usage.cache_read_tokens += o.result.cache_read_tokens;
    usage.output_tokens += o.result.output_tokens;
  }

  return {
    items: outcomes.flatMap((o) => o.items),
    calls: outcomes.map((o) => o.result),
    usage,
    cost_usd: computeCost(usage),
    duration_ms: Date.now() - startedAt,
    model: ANALYSIS_MODEL,
    failed_norms: outcomes
      .filter((o) => !o.result.ok)
      .map((o) => ({ norm_id: o.result.norm_id, norm_title: o.result.norm_title, error: o.result.error ?? "unbekannt" })),
  };
}
