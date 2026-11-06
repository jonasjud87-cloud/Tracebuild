/**
 * Auswertung der Normen fürs Kenndatenblatt: welche Textstellen das Modell sieht, Prompt, Schema und
 * Prüfung der Antwort. Die Route kennt Cache und Datenbank, dieses Modul nur den einen Modellaufruf.
 *
 * Modell: ANALYSIS_MODEL statt KENNWERTE_MODEL. Die Gefahr ist hier die falsche Spalte einer
 * Zonentabelle. Die Zahl steht dann in der richtigen Zeile und besteht die Beleg-Prüfung, nur eben als
 * Nachbarspalte. Das fängt kein Code ab, also braucht es das bessere Lesen.
 */
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { buildDataRules, buildKennwerteBlock, inlineData, newDataBoundary } from "@/lib/analysis-reference";
import { ANALYSIS_MODEL, computeCost, splitNormText, type NormInput, type UsageTotals } from "@/lib/analysis-engine";
import { normTextHash } from "@/lib/norm-hash";
import { KENNDATEN_FELDER, type KenndatenAuswertung } from "@/lib/kenndaten";
import { layerRank, waehleWerte, type BelegNorm, type KenndatenKandidat, type ModellEinheit } from "@/lib/kenndaten-beleg";

export const KENNDATEN_MODEL = ANALYSIS_MODEL;

/** Erhöhen, wenn sich Prompt oder Prüfung ändern: Alte Einträge im Cache gelten dann nicht mehr. */
const KENNDATEN_VERSION = "3";

const MAX_TOKENS = 12_000;
/** Ein Versuch: Ein Retry nach Timeout bezahlt die Auswertung ein zweites Mal. */
export const MAX_CALL_TIMEOUT_MS = 270_000;

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
  /ausn[üu]tzung/i, /\bAZ\b/, /baumassenziffer|\bBMZ\b/i, /[üu]berbauungsziffer|\b[ÜU]Z\b/i, /vollgeschoss|stockwerkzahl/i, /geschosszahl/i,
  /grenzabstand/i, /gr\.\s*GA|kl\.\s*GA/i, /geb[äa]udel[äa]nge/i, /geb[äa]udebreite/i, /mehrl[äa]ngenzuschlag|mehrh[öo]henzuschlag/i,
  /geb[äa]udeh[öo]he/i, /fassadenh[öo]he|traufh[öo]he/i, /firsth[öo]he/i, /gesamth[öo]he/i, /dachform|flachdach|satteldach|schr[äa]gdach/i,
  /strassenabstand|baulinie/i, /zonenschema|zonentabelle|masstabelle|grundmasse|baumasse|zonenvorschriften|regelbauweise/i,
  /indice d'utilisation|distance (?:à|a) la limite|hauteur de fa[çc]ade|hauteur totale|hauteur au fa[iî]te|alignement/i,
  /indice di sfruttamento|distanza dal confine|altezza di facciata|altezza totale|linea di arretramento/i,
];

export function passageScore(text: string, zone: string): number {
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

/** Volle Normtexte, Titel, Ebene, Quelle und Zone. Prompt und Prüfung über die Version. */
export function kenndatenCacheKey(
  norms: { id: string; title?: string; layer?: number | null; text: string; quelle?: string | null }[],
  zone: string,
): string {
  const entries = norms.map((n) => [n.id, n.title ?? "", n.layer ?? "", n.quelle ?? "", normTextHash(n.text)].join(":")).sort();
  return createHash("sha256")
    .update([KENNDATEN_VERSION, KENNDATEN_MODEL, zone.trim().toUpperCase(), ...entries].join("|"))
    .digest("hex");
}

// ── Prompt und Schema ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du liest Schweizer Baureglemente und Baugesetze (de, fr, it) und suchst die Grundmasse EINER Bauzone für ein
Kenndatenblatt. Ein Architekt verlässt sich auf das Blatt. Ein fehlender Wert ist in Ordnung, ein falscher nicht.

Felder (feld), mit den Begriffen, unter denen sie vorkommen:
- vollgeschosse: Vollgeschosse, Geschosszahl, Stockwerkzahl. Ganze Zahl. Aus «W2» allein darfst du nichts schliessen.
- ausnuetzungsziffer: nur die Ausnützungsziffer (AZ), indice d'utilisation, indice di sfruttamento. Die Grundnutzung, nie ein Bonus.
- baumassenziffer, ueberbauungsziffer: nur wenn die Norm sie für die Zone nennt. Sie sind keine AZ und werden nie umgerechnet.
- grenzabstand_gross, grenzabstand_klein: grosser und kleiner Grenzabstand, distance à la limite, distanza dal confine. Regelt die Norm nur einen einheitlichen Grenzabstand, nenne ihn bei beiden Feldern.
- gebaeudelaenge: zulässige Gebäudelänge.
- gebaeudebreite: nur, wenn die Norm eine Gebäudebreite ausdrücklich regelt.
- gebaeudehoehe: Gebäudehöhe, Fassadenhöhe, Traufhöhe, hauteur de façade, altezza di facciata.
- firsthoehe: Firsthöhe, Gesamthöhe, hauteur totale, hauteur au faîte, altezza totale.
- dachform: zulässige Dachform als kurzer Text in text, mit den Worten der Norm. Nur wenn die Norm sie für diese Zone vorschreibt.
- strassenabstand: Mindestabstand von Strassen. Immer nur EINE Angabe. Gilt je Strassenart ein anderer Wert: zahl null, die Kategorien mit Massen in zusatz, etwa «Staatsstrassen 4.00 m, Gemeindewege 2.00 m». Eine Baulinie (alignement, linea di arretramento) geht vor: dann endet zusatz mit «Baulinie geht vor».

Für jede Angabe gilt:
- Nenne nur, was im Text der jeweiligen Norm steht. Rechne nichts aus, ergänze nichts aus Fachwissen, schätze nicht.
- Zone: Der Wert muss für die unten genannte Projektzone gelten. Eine Zone mit Zusatz ist eine andere Zone: W2-B ist nicht W2. Tabellenzeilen stehen im Text zeilen- und spaltengetreu: Ordne über die Spaltenköpfe darüber zu. Im Zweifel lässt du das Feld weg. Gib NIE den Wert einer anderen Zone an.
- zone_im_text: die Zonenbezeichnung genau so, wie die Norm sie für diesen Wert verwendet.
- gilt_fuer_alle_zonen: true nur, wenn die Bestimmung ausdrücklich oder als allgemeine Regel für alle Zonen gilt. zone_im_text ist dann genau "alle". Bei «alle Wohnzonen» oder «alle ausser …» ist es false.
- zitat: PFLICHT. Wörtlich und zusammenhängend aus dem Normtext kopiert, ohne Auslassung, höchstens 200 Zeichen, mit der Zahl des Werts. Bei einer Tabelle die ganze Zeile der Zone, samt Zonenbezeichnung.
- artikel: Fundstelle wie «Art. 12» oder «Anhang 1», sonst null.
- norm_index: die Nummer der Norm aus der Liste, exakt wie vorgegeben.
- zahl und einheit: die Zahl und ihre Einheit, wie sie im Text stehen. Masse: "m", "cm" oder "mm". Ziffern und Vollgeschosse: "". Dachform: zahl null, einheit "".
- text: nur bei dachform, sonst null.
- bezeichnung_im_text: wie die Norm das Mass nennt, etwa «Fassadenhöhe» oder «Stockwerkzahl».
- zusatz: nur wenn der Wert an eine Bedingung geknüpft ist, kurz und ohne Klammern, z. B. «Mehrlängenzuschlag ab 15.00 m», sonst null. Jede Zahl darin muss im Text stehen. Boni und Fussnoten gehören NUR hierher, nie in zahl: Eine Mehrausnützung von 20 % ist keine AZ. Eine Fussnote gilt nur, wenn ihr Zeichen bei der Projektzone steht oder ihr Text diese Zone nennt; «4)» an WG2 gilt nicht für W2.

Ebenen: Werte werden später nach Ebene gewichtet, das machst nicht du. Nennt ausser der Gemeindenorm auch eine kantonale Norm einen Wert, gib beide Angaben einzeln an. Nennen zwei Normen unterschiedliche Werte, gib beide an und wähle nicht aus.
Ein Feld ohne Beleg lässt du einfach weg. Findest du gar nichts, ist werte leer.`;

const EINHEITEN: ModellEinheit[] = ["m", "cm", "mm", ""];

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
            einheit: { type: "string", enum: EINHEITEN },
            text: { anyOf: [{ type: "string" }, { type: "null" }] },
            zusatz: { anyOf: [{ type: "string" }, { type: "null" }] },
            bezeichnung_im_text: { anyOf: [{ type: "string" }, { type: "null" }] },
            norm_index: { type: "integer" },
            artikel: { anyOf: [{ type: "string" }, { type: "null" }] },
            zitat: { type: "string" },
            zone_im_text: { type: "string" },
            gilt_fuer_alle_zonen: { type: "boolean" },
          },
          required: ["feld", "zahl", "einheit", "text", "zusatz", "bezeichnung_im_text", "norm_index", "artikel", "zitat", "zone_im_text", "gilt_fuer_alle_zonen"],
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
    // Eine unbekannte Einheit wie «%» darf nicht still zur Zahl ohne Einheit werden.
    const einheit = EINHEITEN.find((e) => e === (item.einheit ?? ""));
    if (einheit === undefined) continue;
    out.push({
      feld,
      zahl: asNumber(item.zahl),
      einheit,
      text: asText(item.text),
      zusatz: asText(item.zusatz),
      bezeichnung: asText(item.bezeichnung_im_text),
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

export interface ExtraktionsOptionen {
  /** In Tests eine Attrappe. */
  client?: { messages: Pick<Anthropic["messages"], "create"> };
  timeoutMs?: number;
  /** Wird aufgerufen, sobald die Antwort da ist, also auch wenn sie danach unbrauchbar ist. */
  onKosten?: (costUsd: number, model: string) => void;
}

/** Genau ein Modellaufruf. */
export async function runKenndatenExtraction(norms: KenndatenNorm[], zone: string, opts: ExtraktionsOptionen = {}): Promise<KenndatenLauf> {
  const client = opts.client ?? anthropic;
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
    { timeout: Math.min(opts.timeoutMs ?? MAX_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS), maxRetries: 0 },
  ).catch((e: unknown) => {
    // Ohne Antwort keine Usage: Ein Timeout kann trotzdem kosten, also wenigstens im Log nachvollziehbar.
    console.error("kenndaten: Modellaufruf ohne Antwort, Kosten nicht gebucht", {
      normen: norms.length,
      zeichen: norms.reduce((sum, n) => sum + n.text.length, 0),
      fehler: e instanceof Error ? e.message : String(e),
    });
    throw e;
  })) as Anthropic.Message;

  const usage: UsageTotals = {
    input_tokens: message.usage.input_tokens ?? 0,
    cache_write_tokens: message.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: message.usage.cache_read_input_tokens ?? 0,
    output_tokens: message.usage.output_tokens ?? 0,
  };
  const cost_usd = computeCost(usage, KENNDATEN_MODEL);
  opts.onKosten?.(cost_usd, KENNDATEN_MODEL);

  if (message.stop_reason === "max_tokens") {
    throw new KenndatenFehler("Die Auswertung der Normen wurde abgeschnitten. Bitte erneut versuchen.");
  }
  if (message.stop_reason === "refusal") {
    throw new KenndatenFehler("Die Normen konnten nicht ausgewertet werden: Das Modell hat die Auswertung abgelehnt.");
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    auswertung: waehleWerte(parseKenndatenAntwort(text), norms, zone),
    usage,
    cost_usd,
    model: KENNDATEN_MODEL,
  };
}
