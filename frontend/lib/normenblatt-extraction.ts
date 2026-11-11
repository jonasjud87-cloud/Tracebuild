/**
 * Kennwerte-Extraktion fürs Normenblatt: aus jeder zugewiesenen Norm wird ihr
 * eigener konkreter Kennwert (z.B. "Grenzabstand 3.50 m / 6.00 m") als ein Satz
 * extrahiert — KEIN Abgleich/Zusammenführen über mehrere Normen hinweg. Diese
 * Synthese-Aufgabe ist hallucinationsanfällig (z.B. stillschweigend einen von
 * zwei widersprüchlichen Grenzwerten wählen); der Prompt verlangt deshalb
 * ausdrücklich, jede Norm isoliert zu lesen und ihren eigenen Wert zu nennen.
 *
 * Kostenhebel (in dieser Reihenfolge wichtig):
 * 1. Günstiges Modell: Haiku statt Sonnet — reine Textextraktion ohne Pläne/Vision.
 * 2. Ein Call für ALLE Normen eines Projekts (nicht einer pro Norm/Kategorie).
 * 3. Ergebnis wird in project_norm_summaries gecacht (norms_hash) — siehe die
 *    API-Route; dieses Modul kennt den Cache nicht, es liefert nur den Call.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { buildDataRules, buildKennwerteBlock, newDataBoundary } from "@/lib/analysis-reference";
import { splitNormText, normalizeCategory, computeCost, type Category, type UsageTotals } from "@/lib/analysis-engine";

export const KENNWERTE_MODEL = "claude-haiku-4-5-20251001";

/** Output-Budget: ein Satz pro Norm, grosszügig für grössere Normensätze. */
const MAX_TOKENS = 8_000;

/**
 * Deckel pro Normtext im Prompt. Lange Normen (Baureglemente) werden an
 * Artikelgrenzen geschnitten (dieselbe Logik wie die Analyse-Engine,
 * `splitNormText`) — hier wird NUR der erste Teil verwendet, nicht jeder Teil
 * als eigener Call. Grund: ein Kennwert pro Norm ist ein deutlich kleineres
 * Output-Budget als eine volle Prüfung, ein zweiter Call pro Teil würde den
 * "ein Call total"-Vorteil wieder aufgeben. Ein Kennwert steht praktisch immer
 * in den ersten Artikeln der Norm (Mass-/Abstandsbestimmung), der Rest ist
 * meist Verfahren/Ausnahmen — das Risiko, den Kennwert im abgeschnittenen Teil
 * zu verpassen, wird dafür in Kauf genommen (siehe Bericht an den Aufrufer).
 */
const MAX_CHARS_PER_NORM = 30_000;

export interface KennwertNormInput {
  id: string;
  title: string;
  category: string | null;
  text: string;
}

export interface KennwertItem {
  norm_id: string;
  norm_title: string;
  category: Category;
  /** Ein Satz mit dem konkreten Kennwert dieser Norm. */
  sentence: string;
}

export interface KennwerteRunResult {
  items: KennwertItem[];
  usage: UsageTotals;
  cost_usd: number;
  model: string;
  duration_ms: number;
}

const SYSTEM_PROMPT = `Du liest Bau-/Zonennormen der Schweiz oder Liechtensteins und extrahierst für JEDE einzelne Norm
ihren eigenen konkreten Kennwert als ein Satz — z.B. "Kleiner Grenzabstand 3.50 m,
grosser Grenzabstand 6.00 m; erhöht sich um 1.00 m je zusätzliches Vollgeschoss über
drei." oder "Maximale Gebäudehöhe 11.50 m, Firsthöhe 14.00 m.".

WICHTIGSTE REGEL: Du liest und bewertest JEDE Norm EINZELN UND UNABHÄNGIG von den
anderen. Du vergleichst, kombinierst oder gewichtest NIE Werte zwischen
verschiedenen Normen (auch nicht, wenn zwei Normen zum gleichen Thema
unterschiedliche Zahlen nennen — das ist nicht deine Aufgabe und würde eine der
beiden Zahlen willkürlich unterschlagen). Für jede Norm gibst du nur das zurück,
was IN DIESER NORM steht.

Für jede Norm:
- Nenne die konkreten Zahlen/Masse/Grenzwerte, die die Norm selbst festlegt
  (Distanzen, Höhen, Flächen, Anzahl, Fristen, Prozentsätze, Faktoren).
- Ein Satz, maximal 300 Zeichen, Klartext für einen Architekten — keine
  Wiederholung des ganzen Gesetzestextes, kein "gemäss Art. X" ohne Zahl.
- Enthält die Norm mehrere Kennwerte (z.B. kleiner UND grosser Grenzabstand),
  nenne beide im selben Satz.
- Ist die Norm rein verfahrensmässig/begrifflich/organisatorisch und enthält
  KEINEN eigenen konkreten Zahlenwert, gib für sie einen leeren String zurück
  ("") — erfinde niemals eine Zahl, die nicht im Text steht.
- norm_index ist der 1-basierte Index aus der Liste unten; gib ihn exakt wie
  vorgegeben zurück.`;

export const KENNWERTE_OUTPUT_SCHEMA = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            norm_index: { type: "integer", description: "1-basierter Index der Norm aus der Liste" },
            sentence: { type: "string", description: "Kennwert-Satz dieser Norm; leerer String, wenn kein konkreter Wert enthalten ist" },
          },
          required: ["norm_index", "sentence"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

/** Kürzt lange Normtexte auf den ersten Abschnitt (Artikelgrenze), damit ein Normensatz nicht den ganzen Call sprengt. */
function clipNormText(text: string): string {
  const parts = splitNormText(text, MAX_CHARS_PER_NORM);
  return parts[0] ?? text.slice(0, MAX_CHARS_PER_NORM);
}

function buildNormsBlock(norms: KennwertNormInput[], boundary: string): string {
  return buildKennwerteBlock(norms.map((n) => ({ ...n, text: clipNormText(n.text) })), boundary);
}

/**
 * Bergungs-Parser für den Fall, dass die Antwort trotz Structured Output nicht
 * sauber parst (abgebrochen, Netzfehler) — balancierte Objekte einzeln lesen,
 * gleiche Technik wie `salvageCheckObjects` in der Analyse-Engine.
 */
function salvageItems(raw: string): Record<string, unknown>[] {
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
        if (obj && typeof obj === "object" && !Array.isArray(obj) && typeof obj.norm_index === "number") {
          out.push(obj as Record<string, unknown>);
        }
      } catch {
        /* unvollständig — nächstes Objekt */
      }
    }
  }
  return out;
}

function parseItems(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)(?:\s*```)?$/);
  const body = fence ? fence[1] : trimmed;

  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    if (parsed && typeof parsed === "object") {
      const items = (parsed as { items?: unknown }).items;
      if (Array.isArray(items)) return items as Record<string, unknown>[];
    }
  } catch {
    /* fällt auf Bergung zurück */
  }
  return salvageItems(body);
}

/**
 * Genau EIN Anthropic-Call für alle übergebenen Normen. Wirft bei einem
 * fehlgeschlagenen Call (die Route entscheidet, ob der Cache dann unverändert
 * bleibt) — anders als die Analyse-Engine gibt es hier keinen Teil-Erfolg,
 * weil es nur einen Call gibt.
 */
export async function runKennwerteExtraction(norms: KennwertNormInput[]): Promise<KennwerteRunResult> {
  const startedAt = Date.now();
  const usage: UsageTotals = { input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };

  if (norms.length === 0) {
    return { items: [], usage, cost_usd: 0, model: KENNWERTE_MODEL, duration_ms: 0 };
  }

  const boundary = newDataBoundary();
  const message = await anthropic.messages.create({
    model: KENNWERTE_MODEL,
    max_tokens: MAX_TOKENS,
    // System-Text ist über alle Projekte byte-identisch — der Cache-Breakpoint
    // erlaubt Anthropic-Prompt-Caching über aufeinanderfolgende Extraktionen
    // hinweg (verschiedene Projekte, gleicher System-Prompt).
    // Die Datenregel enthält die zufällige Grenze und steht deshalb hinter dem Breakpoint.
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: buildDataRules(boundary) },
    ],
    messages: [{ role: "user", content: buildNormsBlock(norms, boundary) }],
    output_config: { format: KENNWERTE_OUTPUT_SCHEMA },
  });

  usage.input_tokens = message.usage.input_tokens ?? 0;
  usage.cache_write_tokens = message.usage.cache_creation_input_tokens ?? 0;
  usage.cache_read_tokens = message.usage.cache_read_input_tokens ?? 0;
  usage.output_tokens = message.usage.output_tokens ?? 0;

  if (message.stop_reason === "max_tokens") {
    throw new Error(`Antwort bei ${MAX_TOKENS} Output-Tokens abgeschnitten`);
  }
  if (message.stop_reason === "refusal") {
    throw new Error(`Modell hat die Extraktion abgelehnt (${message.stop_details?.category ?? "unbekannt"})`);
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const raw = parseItems(text);
  const bySentence = new Map<number, string>();
  for (const r of raw) {
    const idx = Number(r.norm_index);
    const sentence = typeof r.sentence === "string" ? r.sentence.trim() : "";
    if (Number.isInteger(idx) && idx >= 1 && idx <= norms.length && sentence.length > 0) {
      bySentence.set(idx, sentence.slice(0, 300));
    }
  }

  const items: KennwertItem[] = [];
  norms.forEach((n, i) => {
    const sentence = bySentence.get(i + 1);
    if (sentence) {
      items.push({
        norm_id: n.id,
        norm_title: n.title,
        category: normalizeCategory(n.category),
        sentence,
      });
    }
  });

  return {
    items,
    usage,
    cost_usd: computeCost(usage, KENNWERTE_MODEL),
    model: KENNWERTE_MODEL,
    duration_ms: Date.now() - startedAt,
  };
}
