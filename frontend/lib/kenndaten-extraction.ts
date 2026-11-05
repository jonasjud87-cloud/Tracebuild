/**
 * Auswertung der Normen fürs Kenndatenblatt: welche Textstellen das Modell sieht, Prompt, Schema und
 * Prüfung der Antwort. Die Route kennt Cache und Datenbank, dieses Modul nur den einen Modellaufruf.
 *
 * Modell: ANALYSIS_MODEL statt KENNWERTE_MODEL. Die Gefahr ist hier die falsche Spalte einer
 * flachgedrückten Zonentabelle. Die Zahl steht dann im Text und besteht die Beleg-Prüfung, nur eben für
 * die Nachbarzone. Das fängt kein Code ab, also braucht es das bessere Lesen.
 */
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { buildDataRules, buildKennwerteBlock, inlineData, newDataBoundary } from "@/lib/analysis-reference";
import { ANALYSIS_MODEL, computeCost, splitNormText, type NormInput, type UsageTotals } from "@/lib/analysis-engine";
import { normTextHash } from "@/lib/norm-hash";
import {
  KENNDATEN_FELDER,
  layerRank,
  waehleWerte,
  type BelegNorm,
  type KenndatenAuswertung,
  type KenndatenKandidat,
  type ModellEinheit,
} from "@/lib/kenndaten";

export const KENNDATEN_MODEL = ANALYSIS_MODEL;

/** Erhöhen, wenn sich Prompt oder Prüfung ändern: Alte Einträge im Cache gelten dann nicht mehr. */
const KENNDATEN_VERSION = "1";

const MAX_TOKENS = 12_000;
/** Zwei Versuche passen in die maxDuration der Route. */
const CALL_TIMEOUT_MS = 130_000;

// Ungefähr 3.5 Zeichen je Token: Das deckelt den Eingang auf rund 45'000 Tokens.
const BUDGET_GEMEINDE = 100_000;
const BUDGET_KANTON = 35_000;
const BUDGET_SPEZIAL = 20_000;
const BUDGET_BUND = 20_000;
const PASSAGE_CHARS = 5_000;
const LUECKE = "\n[… Abschnitt ausgelassen …]\n";

/** Die verständliche Meldung für den Knopf. Alles andere meldet die Route allgemein. */
export class KenndatenFehler extends Error {}

// ── Textstellen ──────────────────────────────────────────────────────────────

const STICHWORTE = [
  /ausn[üu]tzung/i, /\bAZ\b/, /geschossfl[äa]chenziffer/i, /\bGFZ\b/, /vollgeschoss/i, /geschosszahl/i,
  /grenzabstand/i, /gr\.\s*GA|kl\.\s*GA/i, /geb[äa]udel[äa]nge/i, /geb[äa]udebreite/i, /mehrl[äa]ngenzuschlag/i,
  /geb[äa]udeh[öo]he/i, /fassadenh[öo]he/i, /firsth[öo]he/i, /gesamth[öo]he/i, /dachform|flachdach|satteldach|schr[äa]gdach/i,
  /strassenabstand|baulinie/i, /zonenschema|zonentabelle|masstabelle|grundmasse|baumasse|zonenvorschriften/i,
];

function passageScore(text: string, zone: string): number {
  const kinds = STICHWORTE.filter((re) => re.test(text)).length;
  if (kinds === 0) return 0;
  return kinds * 3 + (text.toUpperCase().includes(zone.toUpperCase()) ? 5 : 0);
}

/**
 * Die relevanten Abschnitte über alle Normen einer Ebene, in der Reihenfolge des Texts, höchstens
 * `budget` Zeichen. Massgebend ist der ganze Text: Eine Zonentabelle im Anhang zählt so viel wie Art. 1.
 */
function pickPassages(norms: NormInput[], zone: string, budget: number): Map<string, string> {
  const passages = norms.flatMap((norm) =>
    splitNormText(norm.text, PASSAGE_CHARS).map((text, order) => ({ normId: norm.id, order, text, score: passageScore(text, zone) })),
  );
  let left = budget;
  const chosen = passages
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((p) => {
      if (p.text.length > left) return false;
      left -= p.text.length;
      return true;
    })
    .sort((a, b) => a.order - b.order);

  const out = new Map<string, string>();
  for (const norm of norms) {
    const parts = chosen.filter((p) => p.normId === norm.id).map((p) => p.text);
    if (parts.length > 0) out.set(norm.id, parts.join(LUECKE));
  }
  return out;
}

const KANTON_BAURECHT_RE = /\bPBG\b|\bPBV\b|\bBauG\b|\bBauV\b|planungs|baugesetz|bauverordnung|baureglement|raumplanung|raumentwicklung/i;

export interface KenndatenNorm extends BelegNorm {
  id: string;
  category: string | null;
}

/**
 * Sparsam: Gemeindenormen ganz, solange sie ins Budget passen, sonst ihre relevanten Abschnitte. Vom
 * Kanton nur die relevanten Abschnitte von PBG/PBV, Bundesrecht nur, wenn sonst nichts da ist.
 */
export function waehleTextstellen(norms: NormInput[], zone: string): KenndatenNorm[] {
  const ofLayer = (...layers: number[]) => norms.filter((n) => layers.includes(n.layer ?? 0));
  const texts = new Map<string, string>();
  const merge = (m: Map<string, string>) => m.forEach((text, id) => texts.set(id, text));

  const gemeinde = ofLayer(4);
  if (gemeinde.reduce((sum, n) => sum + n.text.length, 0) <= BUDGET_GEMEINDE) gemeinde.forEach((n) => texts.set(n.id, n.text));
  else merge(pickPassages(gemeinde, zone, BUDGET_GEMEINDE));

  merge(pickPassages(ofLayer(5), zone, BUDGET_SPEZIAL));

  const kanton = ofLayer(3);
  const baurecht = kanton.filter((n) => KANTON_BAURECHT_RE.test(n.title));
  merge(pickPassages(baurecht.length > 0 ? baurecht : kanton, zone, BUDGET_KANTON));

  if (texts.size === 0) merge(pickPassages(ofLayer(1, 2), zone, BUDGET_BUND));

  return norms
    .filter((n) => texts.has(n.id))
    .map((n) => ({ id: n.id, title: n.title, category: n.category, layer: n.layer ?? 0, text: texts.get(n.id)! }))
    .sort((a, b) => layerRank(a.layer) - layerRank(b.layer));
}

/** Unabhängig von der Auswahl der Textstellen: Massgebend sind die vollen Normtexte und die Zone. */
export function kenndatenCacheKey(norms: { id: string; text: string }[], zone: string): string {
  const entries = norms.map((n) => `${n.id}:${normTextHash(n.text)}`).sort();
  return createHash("sha256")
    .update([KENNDATEN_VERSION, KENNDATEN_MODEL, zone.trim().toUpperCase(), ...entries].join("|"))
    .digest("hex");
}

// ── Prompt und Schema ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du liest Schweizer Baureglemente und Baugesetze und suchst die Grundmasse EINER Bauzone für ein
Kenndatenblatt. Ein Architekt verlässt sich auf das Blatt. Ein fehlender Wert ist in Ordnung, ein falscher nicht.

Felder (feld):
- vollgeschosse: zulässige Anzahl Vollgeschosse, ganze Zahl. Bei «W2» nur, wenn der Text die Geschosszahl selbst nennt.
- ausnuetzungsziffer: Ausnützungsziffer (AZ) oder gleichbedeutende Geschossflächenziffer. NIE Baumassenziffer, Überbauungsziffer oder Grünflächenziffer.
- grenzabstand_gross, grenzabstand_klein: grosser und kleiner Grenzabstand. Regelt die Norm nur einen einheitlichen Grenzabstand, nenne ihn bei beiden Feldern.
- gebaeudelaenge: zulässige Gebäudelänge.
- gebaeudebreite: nur, wenn die Norm eine Gebäudebreite ausdrücklich regelt.
- gebaeudehoehe: Gebäudehöhe, auch Fassadenhöhe.
- firsthoehe: Firsthöhe, auch Gesamthöhe.
- dachform: zulässige Dachform als kurzer Text in text.
- strassenabstand: Mindestabstand von Strassen.

Für jede Angabe gilt:
- Nenne nur, was im Text der jeweiligen Norm steht. Rechne nichts aus, ergänze nichts aus Fachwissen, schätze nicht.
- Zone: Der Wert muss für die unten genannte Projektzone gelten. Lies Zonentabellen besonders sorgfältig: PDF-Text verliert die Spalten, ordne Zahl und Zone nur zu, wenn die Zuordnung eindeutig ist. Im Zweifel lässt du das Feld weg. Gib NIE den Wert einer anderen Zone an.
- zone_im_text: die Zonenbezeichnung genau so, wie die Norm sie für diesen Wert verwendet.
- gilt_fuer_alle_zonen: true nur, wenn die Bestimmung ausdrücklich für alle Zonen oder allgemein gilt. zone_im_text ist dann "alle".
- zitat: wörtlich aus dem Normtext, höchstens 200 Zeichen, mit der Zahl des Werts. Bei einer Tabelle die Zeile der Zone.
- artikel: Fundstelle wie «Art. 12» oder «Anhang 1», sonst null.
- norm_index: die Nummer der Norm aus der Liste, exakt wie vorgegeben.
- zahl und einheit: die Zahl und ihre Einheit, wie sie im Text stehen. Masse: "m", "cm" oder "mm". AZ und Vollgeschosse: "" (AZ in Prozent: "%"). Dachform: zahl null, einheit "".
- text: nur bei dachform, sonst null.
- zusatz: nur wenn der Wert an eine Bedingung geknüpft ist, ein kurzer Zusatz ohne Klammern, z. B. «Mehrlängenzuschlag ab 15.00 m», sonst null. Jede Zahl darin muss im Text stehen.

Ebenen: Werte werden später nach Ebene gewichtet, das machst nicht du. Nennt ausser der Gemeindenorm auch eine kantonale Norm einen Wert, gib beide Angaben einzeln an. Nennen zwei Normen unterschiedliche Werte, gib beide an und wähle nicht aus.
Ein Feld ohne Beleg lässt du einfach weg. Findest du gar nichts, ist werte leer.`;

export const KENNDATEN_OUTPUT_SCHEMA = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      werte: {
        type: "array",
        items: {
          type: "object",
          properties: {
            feld: { type: "string", enum: [...KENNDATEN_FELDER] },
            zahl: { anyOf: [{ type: "number" }, { type: "null" }] },
            einheit: { type: "string", enum: ["m", "cm", "mm", "%", ""] },
            text: { anyOf: [{ type: "string" }, { type: "null" }] },
            zusatz: { anyOf: [{ type: "string" }, { type: "null" }] },
            norm_index: { type: "integer" },
            artikel: { anyOf: [{ type: "string" }, { type: "null" }] },
            zitat: { type: "string" },
            zone_im_text: { type: "string" },
            gilt_fuer_alle_zonen: { type: "boolean" },
          },
          required: ["feld", "zahl", "einheit", "text", "zusatz", "norm_index", "artikel", "zitat", "zone_im_text", "gilt_fuer_alle_zonen"],
          additionalProperties: false,
        },
      },
    },
    required: ["werte"],
    additionalProperties: false,
  },
};

export function buildKenndatenUserMessage(norms: KenndatenNorm[], zone: string, boundary: string): string {
  return `PROJEKTZONE: ${inlineData(zone)}\n\n${buildKennwerteBlock(norms, boundary)}`;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.replace(/['’\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const asText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const UNLESBAR = "Die Auswertung der Normen war nicht lesbar. Bitte erneut versuchen.";

/** Unbrauchbares fällt weg, ohne die übrigen Angaben zu gefährden. Nur eine unlesbare Antwort wirft. */
export function parseKenndatenAntwort(raw: string): KenndatenKandidat[] {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)(?:\s*```)?$/);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fence ? fence[1] : trimmed);
  } catch {
    throw new KenndatenFehler(UNLESBAR);
  }
  const list = (parsed as { werte?: unknown } | null)?.werte;
  if (!Array.isArray(list)) throw new KenndatenFehler(UNLESBAR);

  const out: KenndatenKandidat[] = [];
  for (const item of list as (Record<string, unknown> | null)[]) {
    const feld = KENNDATEN_FELDER.find((f) => f === item?.feld);
    const normIndex = Number(item?.norm_index);
    if (!item || !feld || !Number.isInteger(normIndex)) continue;
    const einheit = (["m", "cm", "mm", "%", ""] as ModellEinheit[]).find((e) => e === item.einheit) ?? "";
    out.push({
      feld,
      zahl: asNumber(item.zahl),
      einheit,
      text: asText(item.text),
      zusatz: asText(item.zusatz),
      normIndex,
      artikel: asText(item.artikel),
      zitat: asText(item.zitat) ?? "",
      zoneImText: asText(item.zone_im_text) ?? "",
      giltFuerAlleZonen: item.gilt_fuer_alle_zonen === true,
    });
  }
  return out;
}

// ── Aufruf ───────────────────────────────────────────────────────────────────

export interface KenndatenLauf {
  auswertung: KenndatenAuswertung;
  usage: UsageTotals;
  cost_usd: number;
  model: string;
}

/** Genau ein Modellaufruf. `client` lässt sich in Tests durch eine Attrappe ersetzen. */
export async function runKenndatenExtraction(
  norms: KenndatenNorm[],
  zone: string,
  client: { messages: Pick<Anthropic["messages"], "create"> } = anthropic,
): Promise<KenndatenLauf> {
  const boundary = newDataBoundary();
  const message = (await client.messages.create(
    {
      model: KENNDATEN_MODEL,
      max_tokens: MAX_TOKENS,
      // Der System-Text ist über alle Projekte gleich. Die Datenregel enthält die zufällige Grenze und steht dahinter.
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: buildDataRules(boundary) },
      ],
      messages: [{ role: "user", content: buildKenndatenUserMessage(norms, zone, boundary) }],
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: KENNDATEN_OUTPUT_SCHEMA },
    },
    { timeout: CALL_TIMEOUT_MS, maxRetries: 1 },
  )) as Anthropic.Message;

  if (message.stop_reason === "max_tokens") {
    throw new KenndatenFehler("Die Auswertung der Normen wurde abgeschnitten. Bitte erneut versuchen.");
  }
  if (message.stop_reason === "refusal") {
    throw new KenndatenFehler("Die Normen konnten nicht ausgewertet werden: Das Modell hat die Auswertung abgelehnt.");
  }

  const usage: UsageTotals = {
    input_tokens: message.usage.input_tokens ?? 0,
    cache_write_tokens: message.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: message.usage.cache_read_input_tokens ?? 0,
    output_tokens: message.usage.output_tokens ?? 0,
  };
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    auswertung: waehleWerte(parseKenndatenAntwort(text), norms, zone),
    usage,
    cost_usd: computeCost(usage, KENNDATEN_MODEL),
    model: KENNDATEN_MODEL,
  };
}
