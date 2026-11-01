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
 * stabilen Teil (System-Prompt + PDF + Referenzrahmen). Der variable Teil — der
 * Normtext — steht dahinter. Call 1 schreibt den Cache, die restlichen N-1 lesen ihn für 10 %.
 *
 * Referenzrahmen: Jeder Norm-Call sieht zusätzlich die kommunalen Normen (Baureglement,
 * Zonenschema) und die ÖREB-Fakten der Parzelle. Ohne das prüft der PBG-Call ein
 * Winkelmass, das die Gemeinde gar nicht kennt, und jede Ebene erzeugt ihre eigene
 * Gebäudehöhe — gemessen: 14 von 41 Prüfpunkten waren Dubletten. Mit Referenzrahmen
 * gilt die Hierarchieregel (Gemeinde konkretisiert, Rahmennorm schweigt), und ein
 * abschliessender Konsolidierungs-Call räumt die Reste weg.
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
const MAX_CONCURRENCY = Math.max(1, Number(process.env.ANALYSIS_MAX_CONCURRENCY) || 8);

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
const PER_CALL_BUDGET_MS = 150_000;

/** Ab so viel Restzeit lohnt sich ein zweiter Versuch für eine gescheiterte Norm. */
const RETRY_MIN_REMAINING_MS = 60_000;

/** Wie lange maximal auf den Cache-Write von Call 1 gewartet wird, bevor gefächert wird. */
const PREFILL_GATE_MAX_MS = 75_000;

/** Zeit, die für den Konsolidierungs-Call am Ende reserviert wird (nur wenn das Budget das hergibt). */
const CONSOLIDATION_RESERVE_MS = 40_000;
const CONSOLIDATION_CALL_MS = 35_000;
const CONSOLIDATION_MIN_BUDGET_MS = 150_000;

/** Referenzrahmen (kommunale Normtexte) wird gedeckelt, damit der Cache-Prefix nicht explodiert. */
const REFERENCE_MAX_CHARS = 160_000;

/**
 * Lange Normen werden an Artikelgrenzen in Teile geschnitten und parallel geprüft.
 * Gemessen: das Baureglement Mels (53'825 Zeichen) braucht als Ganzes mit der
 * Pflicht-Checkliste > 150 s Denkzeit — zwei Hälften laufen parallel in einem Bruchteil.
 * Bundesnormen bleiben ganz: sie sind Rahmenrecht, liefern wenige Prüfpunkte und sind
 * als Ganzes schnell (17–25 s). Schlüssel = layer.
 */
const CHUNK_CHARS_BY_LAYER: Record<number, number> = { 3: 50_000, 4: 25_000, 5: 25_000 };

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
  /** 1 = Bund/International, 3 = Kanton, 4 = Gemeinde, 5 = Spezial/Org. */
  layer?: number | null;
  jurisdiction_type?: string | null;
}

/** Fakten aus dem ÖREB-Auszug der Parzelle — der Prüfer soll wissen, was nachweislich (nicht) gilt. */
export interface OerebFacts {
  affects: { code: string; name: string; legend: string | null; typeCode: string | null; areaM2: number | null; areaPct: number | null }[];
  noData: string[];
  notAffected: string[];
  /** Grundbuchfläche der Parzelle in m² (aus dem Auszug), wenn bekannt. */
  parcelAreaM2: number | null;
}

export interface ConsolidationResult {
  applied: boolean;
  raw_count: number;
  merged: number;
  downgraded: number;
  error: string | null;
  duration_ms: number;
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
  /** Teil k von n, wenn die Norm in Teile geschnitten wurde; sonst 1/1. */
  part: number;
  parts: number;
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
  /** null = Konsolidierung war nicht vorgesehen (zu wenig Budget). */
  consolidation: ConsolidationResult | null;
}

export type FileBlock = Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam;

export interface ProjectContext {
  municipality: string;
  canton: string;
  bauzone: string;
  parcel?: string | null;
  /** 'oereb' | 'manual' | null — sagt dem Prüfer, wie belastbar die Zone ist. */
  zoneSource?: string | null;
  oereb?: OerebFacts | null;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_BASE = `Du bist ein Schweizer Baurechtsexperte (Architekt/Bauverwalter) und prüfst Baupläne auf Normkonformität.

Du erhältst in jedem Auftrag:
- den vollständigen Bauplan als PDF (alle Seiten, 1-basiert nummeriert)
- den Projektkontext (Gemeinde, Kanton, Bauzone, Parzelle)
- den REFERENZRAHMEN: ÖREB-Fakten der Parzelle und die kommunalen Normen (Baureglement,
  Zonenschema). Er dient der Einordnung — er ist NICHT selbst zu prüfen, ausser er ist die
  zu prüfende Norm.
- GENAU EINE zu prüfende Norm.

GRUNDREGEL: Prüfe den Bauplan ausschliesslich gegen die zu prüfende Norm.

HIERARCHIE (wichtigste Regel gegen Dubletten):
- Die Gemeinde konkretisiert Kanton und Bund. Regelt der Referenzrahmen einen Sachverhalt
  abschliessend (z.B. Gebäude-/Firsthöhe, Geschosszahl, Grenz- und Strassenabstände,
  Gebäudelänge, Ausnützung, Dachaufbauten, Parkierung, Terrainveränderung im Zonenschema
  oder in Artikeln des Baureglements), dann erzeugst du in einer kantonalen oder
  bundesrechtlichen Rahmennorm KEINEN eigenen Prüfpunkt zu diesem Sachverhalt. Der
  Prüfpunkt entsteht im Auftrag der kommunalen Norm.
- Nur wenn die Rahmennorm etwas Zusätzliches oder Strengeres verlangt, das kommunal nicht
  geregelt ist, prüfst du es — und sagst im Befund, warum die Rahmennorm hier greift.
- Prüfst du die kommunale Norm selbst: Sie ist massgebend; ziehe kantonale Begriffe nur
  heran, wenn das Baureglement auf sie verweist.
- Ein Messverfahren, das die Gemeinde nicht kennt (z.B. Winkelmass, wenn das Baureglement
  mit Gebäude- und Firsthöhe arbeitet), wird nicht geprüft.

RELEVANZ:
- Nur Prüfpunkte zu Sachverhalten, die im Plan sichtbar sind oder die der Referenzrahmen
  (ÖREB) belegt. Keine spekulativen Prüfpunkte über nicht ersichtliche Umstände
  (Altlasten, Rückbau, Inventare, Gewässerraum), wenn ÖREB sie als nicht betroffen ausweist
  oder nichts darauf hindeutet. Sagt ÖREB "nicht betroffen", darf ein einzelner
  ok-Prüfpunkt das festhalten — nicht mehrere.
- Bestimmungen, die auf dieses Projekt nicht anwendbar sind, lässt du weg. Gibt die Norm
  für diesen Plan keinen relevanten Prüfpunkt her, liefere eine leere Liste.
- Pro Sachverhalt genau ein Prüfpunkt. Keine drei Prüfpunkte zum selben Thema mit
  unterschiedlichem Status.

PFLICHT-CHECKLISTE für Bauten in Wohn-/Kern-/Mischzonen — für jeden Punkt, den DIE ZU
PRÜFENDE NORM regelt, MUSS ein Prüfpunkt entstehen (ok, warn oder fail):
  1. Geschosszahl inkl. Regeln für Dach- und Untergeschoss (Kniestock, Terrainhöhen,
     anrechenbare Geschosse) — Grenzfälle explizit benennen.
  2. Ausnützungs-/Überbauungs-/Baumassenziffer — fehlt die Berechnung oder die
     Parzellenfläche im Plansatz, ist das ein warn mit dem konkreten Hinweis, was fehlt.
  3. Gebäudehöhe und Firsthöhe (aus den Koten rechnen: Terrain, OK Fertigboden, First).
  4. Kleiner und grosser Grenzabstand je Fassade; Strassenabstand; welche Regel vorgeht.
  5. Gebäudelänge / Fassadenlänge.
  6. Vorbauten, Dachaufbauten, Dacheinschnitte (Masse und Anteilsregeln).
  7. Parkierung: Anzahl nach der massgebenden Bezugsgrösse (z.B. anrechenbare
     Geschossfläche, Wohnungen) inkl. Rundungsregel, Besucherplätze, Vorplatz vor
     Garagen/Unterständen, Anordnung, Zufahrt.
  8. Terrainveränderungen, Abgrabungen, Stützmauern.
  9. Lärmempfindlichkeitsstufe und daraus folgende Anforderungen.
 10. Wohnhygiene: Raumhöhen, Mindestflächen, Fensteranteile, Abstellräume, Treppen.
 11. Vollständigkeit der Baugesuchsunterlagen (Situationsplan, Kanalisation, Nachweise).
 12. Gewässer-, Wald-, Strassenabstände laut ÖREB/Referenzrahmen.

LESEN, BEVOR DU URTEILST:
- Bevor du "nicht kotiert / nicht bemasst / nicht ersichtlich" schreibst, hast du ALLE
  Schnitte, Fassaden, Grundrisse und den Situationsplan durchgesehen. Masse stehen oft nur
  im Schnitt (Kniestock, lichte Raumhöhe, Geschosshöhe) oder im Situationsplan (Abstände).
  Nenne im Befund die Seite, auf der das Mass steht — oder auf welchen Seiten du gesucht hast.
- Was aus Koten berechenbar ist, rechnest du (Terrain, Fertigboden, First; Fassadenmasse;
  Flächen aus dem Plan; Parzellenfläche aus dem Referenzrahmen). Schreibe die Rechnung.
- Behaupte keine Angaben, die nicht im Plan stehen (z.B. "Kanalisationsanschluss vorgesehen",
  wenn kein Kanalisationsplan da ist).
- Nennt die Norm mehrere Bezugsgrössen (z.B. Abstellplätze je 80 m² Geschossfläche UND je
  Wohnung), rechnest du beide; die höhere Anforderung gilt.
- Grenzt eine Fassade an eine Strasse, prüfst du, ob die Norm den Strassenabstand dem
  (grossen) Grenzabstand vorgehen lässt — und sagst es im Befund.
- Ein Bauteil innerhalb der Hauptfassaden (z.B. Autounterstand unter dem Obergeschoss) ist
  kein Anbau/Vorbau/Kleinbaute; Regeln für vorstehende Bauteile gelten nicht.

STATUS-REGELN:
- "ok" NUR, wenn der Plan die Einhaltung positiv belegt (Masse/Koten vorhanden und
  gerechnet). Fehlt der Nachweis oder muss etwas "nachgewiesen/ergänzt" werden → "warn".
  Ein "ok" hat deshalb nie eine Empfehlung.
- "fail" = anhand des Plans nachweislich verletzt (Zahl gegen Grenzwert). Das gilt auch,
  wenn das Mass nicht direkt beschriftet, aber aus Koten oder Massketten ableitbar ist
  (z.B. Vorplatz = Abstand Garagenfront zur Strassengrenze). "Nicht bemasst" ist kein
  Ausweg, wenn sich das Mass ableiten lässt.
- "warn" = nicht abschliessend beurteilbar, Nachweis fehlt, oder Grenzfall mit Auslegungsbedarf.
- Exakt am Grenzwert oder Reserve unter 5 cm: "ok", aber im Befund ausdrücklich
  "exakt am Limit / Reserve x cm" schreiben und in der confidence "medium" wählen, wenn
  die Messgenauigkeit des Plans das nicht hergibt.
- Rundungsregeln der Norm anwenden (z.B. Bruchteile aufrunden).

FORM:
- norm_title: Artikel und Absatz der geprüften Bestimmung plus Stichwort, z.B.
  "Art. 15 Abs. 2 BauR Mels – Geschosszahl / Kniestock".
- finding: was konkret im Plan gemessen/erkannt wurde — Masse, Koten, Bauteil, Seite,
  und der Vergleich mit dem Grenzwert. Maximal 400 Zeichen. Keine Wiederholung des
  Gesetzestextes, keine Floskeln. Ein Architekt liest das.
- suggestion: eine konkrete, umsetzbare Massnahme, maximal 250 Zeichen. Bei "ok" leer.
- page_reference: PDF-Seitenzahl 1-basiert. 0 nur, wenn kein Seitenbezug möglich ist.
- confidence: "high" nur, wenn der Plan die Angabe wirklich hergibt.
- Maximal ${MAX_CHECKS_PER_NORM} Prüfpunkte. Priorisiere fail vor warn vor ok.
- category aus der vorgegebenen Liste; "andere" nur, wenn nichts passt.`;

export function buildSystemPrompt(ctx: ProjectContext): string {
  const zoneNote =
    ctx.zoneSource === "oereb"
      ? " (aus dem ÖREB-Kataster, verbindlich)"
      : ctx.zoneSource === "manual"
        ? " (manuell erfasst)"
        : "";
  return (
    `${SYSTEM_BASE}\n\n` +
    `PROJEKTKONTEXT (gilt für alle Prüfungen):\n` +
    `- Gemeinde: ${ctx.municipality || "unbekannt"}\n` +
    `- Kanton: ${ctx.canton || "unbekannt"}\n` +
    `- Bauzone: ${ctx.bauzone || "unbekannt"}${ctx.bauzone ? zoneNote : ""}\n` +
    (ctx.parcel ? `- Parzelle: ${ctx.parcel}\n` : "")
  );
}

/** Kommunale Normen (Layer 4) bilden den Referenzrahmen — Baureglement, Zonenschema, Sondernutzungspläne. */
export function isReferenceNorm(norm: NormInput): boolean {
  return norm.layer === 4 || norm.jurisdiction_type === "municipal";
}

/**
 * Referenzrahmen: ÖREB-Fakten + Volltext der kommunalen Normen. Steht in jedem Call
 * VOR dem Cache-Breakpoint, ist also über alle Calls byte-identisch.
 */
export interface ReferenceBlock {
  text: string;
  /** Normen, deren Text VOLLSTÄNDIG im Block steht — nur die dürfen den Text im Norm-Call weglassen. */
  completeIds: Set<string>;
}

export function buildReferenceBlock(ctx: ProjectContext, referenceNorms: NormInput[]): ReferenceBlock {
  const lines: string[] = ["REFERENZRAHMEN (zur Einordnung — nicht selbst zu prüfen, ausser es ist die zu prüfende Norm)"];
  const completeIds = new Set<string>();

  const o = ctx.oereb;
  if (o) {
    lines.push("", "ÖREB-Kataster der Parzelle (amtlich):");
    if (o.parcelAreaM2 != null) lines.push(`- Parzellenfläche (Grundbuch): ${o.parcelAreaM2} m²`);
    if (o.affects.length) {
      lines.push("- Betroffen:");
      for (const a of o.affects) {
        const area = a.areaM2 != null ? ` — ${a.areaM2} m²${a.areaPct != null ? ` (${a.areaPct} % der Parzelle)` : ""}` : "";
        lines.push(`  · ${a.name}${a.legend ? `: ${a.legend}` : ""}${a.typeCode ? ` [${a.typeCode}]` : ""}${area}`);
      }
    } else {
      lines.push("- Betroffen: keine Einschränkung erfasst");
    }
    if (o.notAffected.length) lines.push(`- Nicht betroffen: ${o.notAffected.join(", ")}`);
    if (o.noData.length) lines.push(`- Ohne Daten im Kataster: ${o.noData.join(", ")}`);
    if (o.parcelAreaM2 != null) {
      lines.push("- Hinweis: Für Ausnützungs-/Überbauungsziffern ist die anrechenbare Fläche der Bauzone massgebend (Zonenanteil oben), nicht zwingend die ganze Parzelle.");
    }
  } else {
    lines.push("", "ÖREB-Kataster: kein Auszug vorhanden.");
  }

  if (referenceNorms.length === 0) {
    lines.push("", "Kommunale Normen: keine hinterlegt. Die Hierarchieregel entfällt — prüfe die Rahmennorm vollständig.");
    return { text: lines.join("\n"), completeIds };
  }

  // Nur Normen, die ganz hineinpassen, kommen in den Block — eine gekürzte Referenz
  // wäre für den Call der Norm selbst gefährlich (er würde gegen einen Torso prüfen).
  let budget = REFERENCE_MAX_CHARS;
  const included: NormInput[] = [];
  for (const n of referenceNorms) {
    if (n.text.length > budget) continue;
    budget -= n.text.length;
    included.push(n);
    completeIds.add(n.id);
  }
  const skipped = referenceNorms.length - included.length;
  lines.push("", `Kommunale Normen (${included.length}${skipped ? `, ${skipped} weitere aus Platzgründen nicht enthalten` : ""}):`);
  for (const n of included) {
    lines.push("", `=== ${n.title}${n.category ? ` (${n.category})` : ""} ===`, n.text, `=== ENDE ${n.title} ===`);
  }
  return { text: lines.join("\n"), completeIds };
}

/** Ein Prüfauftrag: eine Norm oder ein Artikel-Abschnitt davon. */
export interface NormPart {
  norm: NormInput;
  part: number;
  parts: number;
  text: string;
  /** Erster/letzter Artikel im Teil — nur zur Beschriftung. */
  range: string | null;
}

const ARTICLE_RE = /(?:^|\n)\s*(?:Art(?:ikel|\.)\s*\d+[a-z]?)\b/g;

/**
 * Schneidet einen Normtext an Artikelgrenzen in Stücke von höchstens `limit` Zeichen.
 * Findet sich keine Artikelstruktur, wird an Absatzgrenzen geschnitten.
 */
export function splitNormText(text: string, limit: number): string[] {
  if (!text.trim()) return [];
  if (text.length <= limit) return [text];

  const cuts: number[] = [];
  for (const m of Array.from(text.matchAll(ARTICLE_RE))) {
    const at = m.index! + (m[0].startsWith("\n") ? 1 : 0);
    if (at > 0) cuts.push(at);
  }
  // Ohne brauchbare Artikelgrenzen: Absätze.
  const boundaries = cuts.length >= 2 ? cuts : Array.from(text.matchAll(/\n\s*\n/g), (m) => m.index! + m[0].length);

  // Segmente zwischen den Grenzen; ein Segment, das allein das Limit sprengt, wird hart geteilt.
  const segments: string[] = [];
  let prev = 0;
  for (const b of boundaries.concat([text.length])) {
    if (b <= prev) continue;
    let seg = text.slice(prev, b);
    while (seg.length > limit) {
      segments.push(seg.slice(0, limit));
      seg = seg.slice(limit);
    }
    if (seg) segments.push(seg);
    prev = b;
  }

  // Segmente greedy zu Teilen ≤ limit zusammenfassen.
  const parts: string[] = [];
  let current = "";
  for (const seg of segments) {
    if (current && current.length + seg.length > limit) {
      parts.push(current);
      current = "";
    }
    current += seg;
  }
  if (current) parts.push(current);

  const clean = parts.filter((p) => p.trim().length > 0);
  // Ein winziger Schwanz (Änderungstabelle, Inkrafttreten) ist keinen eigenen Call wert —
  // aber nur, wenn er noch ins Limit des Vorgängers passt.
  if (clean.length > 1) {
    const tail = clean[clean.length - 1];
    if (tail.length < 2_000 && clean[clean.length - 2].length + tail.length <= limit * 1.1) {
      clean[clean.length - 2] += tail;
      clean.pop();
    }
  }
  return clean;
}

/** Erster Artikel, der im Text als Überschrift auftaucht (nicht ein Querverweis mitten im Satz). */
function firstArticle(text: string): string | null {
  const m = text.match(/(?:^|\n)\s*Art(?:ikel|\.)\s*(\d+[a-z]?)\b/);
  return m ? m[1] : null;
}

/** Zerlegt die Normen in Prüfaufträge (Teile) gemäss CHUNK_CHARS_BY_LAYER. */
export function toNormParts(norms: NormInput[]): NormPart[] {
  const out: NormPart[] = [];
  for (const norm of norms) {
    const limit = CHUNK_CHARS_BY_LAYER[norm.layer ?? 0];
    const pieces = limit ? splitNormText(norm.text, limit) : [norm.text];
    const starts = pieces.map(firstArticle);
    pieces.forEach((text, i) => {
      let range: string | null = null;
      if (pieces.length > 1) {
        const from = i === 0 ? "Anfang" : starts[i] ? `Art. ${starts[i]}` : `Teil ${i + 1}`;
        const next = starts[i + 1];
        range = i === pieces.length - 1 ? `${from} bis Ende` : next ? `${from} bis vor Art. ${next}` : `${from} ff.`;
      }
      out.push({ norm, part: i + 1, parts: pieces.length, text, range });
    });
  }
  return out;
}

export function partLabel(p: NormPart): string {
  return p.parts > 1 ? `${p.norm.title} (Teil ${p.part}/${p.parts}${p.range ? `, ${p.range}` : ""})` : p.norm.title;
}

export function buildNormBlock(p: NormPart, index: number, total: number, inReference: boolean = false): string {
  const norm = p.norm;
  const head =
    `ZU PRÜFENDE NORM (Auftrag ${index + 1} von ${total}):\n` +
    `Titel: ${norm.title}\n` +
    `Ebene: ${norm.layer === 4 ? "Gemeinde" : norm.layer === 3 ? "Kanton" : norm.layer === 1 ? "Bund" : "Spezialnorm"}\n` +
    `Kategorie: ${norm.category ?? "unbekannt"}\n`;
  const scope =
    p.parts > 1
      ? `Diese Norm ist in ${p.parts} Teile aufgeteilt; dieser Auftrag umfasst NUR Teil ${p.part}` +
        `${p.range ? ` (${p.range})` : ""}. Bestimmungen ausserhalb dieses Teils prüfen andere Aufträge — ` +
        `erzeuge dafür keine Prüfpunkte.\n`
      : "";
  if (inReference) {
    return (
      head + scope +
      `Der vollständige Text dieser Norm steht bereits im Referenzrahmen oben unter "=== ${norm.title} ==="; ` +
      `sie ist die massgebende kommunale Norm.\n` +
      (p.parts > 1 ? `--- ZU PRÜFENDER ABSCHNITT ANFANG ---\n${p.text}\n--- ZU PRÜFENDER ABSCHNITT ENDE ---\n\n` : "") +
      `Prüfe den beigefügten Bauplan gegen ${p.parts > 1 ? "diesen Abschnitt" : "diese Norm"}.`
    );
  }
  return (
    head + scope +
    `--- NORMTEXT ANFANG ---\n${p.text}\n--- NORMTEXT ENDE ---\n\n` +
    `Prüfe den beigefügten Bauplan gegen ${p.parts > 1 ? "diesen Abschnitt" : "diese Norm"}.`
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

// ── Konsolidierung ────────────────────────────────────────────────────────────

const CONSOLIDATION_SYSTEM = `Du konsolidierst die Prüfpunkte einer Bauplan-Analyse. Die Prüfpunkte stammen aus
getrennten Prüfungen je Norm (Bund, Kanton, Gemeinde) und wurden bereits gegen den Plan geprüft.

Aufgaben — und NUR diese:
1. DUBLETTEN: Zwei oder mehr Prüfpunkte prüfen denselben Sachverhalt am selben Bauteil
   (z.B. Gebäudehöhe nach PBG und nach Baureglement; kleiner Grenzabstand West aus zwei
   Normen). Lege sie zusammen: behalte den Prüfpunkt der spezifischsten Norm (Gemeinde vor
   Kanton vor Bund, bei Gleichstand den mit den konkreteren Zahlen), gib ihm den strengeren
   Status der Gruppe und einen Titel, der beide Artikel nennt.
2. WIDERSPRÜCHE: Ein "ok"-Prüfpunkt, dem ein anderer Prüfpunkt widerspricht (z.B.
   "Erschliessung gegeben, Kanalisationsanschluss vorgesehen" vs. "Kanalisationsplan fehlt";
   "Unterlagen vollständig" vs. "Berechnung fehlt") oder dessen eigene Empfehlung einen
   Nachweis fordert ("nachweisen", "ergänzen", "einreichen") → auf "warn" herabstufen mit
   kurzer Begründung. Prüfe dafür jeden "ok"-Punkt gegen alle "warn"/"fail"-Punkte.
   Herabstufen NUR, wenn der Widerspruch denselben Sachverhalt betrifft (gleiches Mass,
   gleiche Unterlage). Eine allgemeine Unsicherheit (z.B. "Niveaupunkt formell nicht
   nachgewiesen", "Berechnung fehlt") stuft einen rechnerisch belegten ok-Punkt NICHT herab.
3. Gleiche Sachverhalte über drei Ebenen (z.B. Terrainveränderung nach Baureglement, nach
   kantonalem Gesetz und nach Bundesrecht; Gewässerraum nach kantonalem und Bundesrecht)
   sind Dubletten, auch wenn die Artikel verschieden heissen — ausser sie prüfen wirklich
   verschiedene Anforderungen (z.B. Abgrabungshöhe vs. Grenzabstand einer Stützmauer).

Regeln:
- Erfinde keine Prüfpunkte, ändere keine Befundtexte, stufe nichts hoch.
- Begründungen und Titel in Klartext für den Architekten — nenne Artikel/Norm, nie die
  internen IDs (c1, c2 …).
- Verschiedene Bauteile/Fassaden/Seiten sind KEINE Dubletten.
- Im Zweifel nicht zusammenlegen.`;

const CONSOLIDATION_SCHEMA = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      merges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keep:  { type: "string", description: "ID des Prüfpunkts, der bleibt" },
            drop:  { type: "array", items: { type: "string" }, description: "IDs, die darin aufgehen" },
            title: { type: "string", description: "Neuer Titel mit beiden Artikeln; leer = unverändert" },
          },
          required: ["keep", "drop", "title"],
          additionalProperties: false,
        },
      },
      downgrades: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:     { type: "string" },
            reason: { type: "string", description: "Warum ok → warn, maximal 200 Zeichen" },
          },
          required: ["id", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["merges", "downgrades"],
    additionalProperties: false,
  },
};

const SEVERITY: Record<Status, number> = { fail: 0, warn: 1, ok: 2 };

function layerOf(norms: NormInput[], normId: string | null): number {
  return norms.find((n) => n.id === normId)?.layer ?? 9;
}

/**
 * Ein Call, kein PDF, kein Cache: bekommt alle Prüfpunkte kompakt und liefert nur
 * Anweisungen (zusammenlegen / herabstufen), die deterministisch angewendet werden.
 * Wirft nie; ohne Ergebnis bleiben die Items unverändert.
 */
async function consolidateItems(
  items: CheckItem[],
  norms: NormInput[],
  deadlineAt: number,
  cancelSignal: AbortSignal | null,
): Promise<{ items: CheckItem[]; result: ConsolidationResult; usage: UsageTotals }> {
  const startedAt = Date.now();
  const usage: UsageTotals = { input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
  const base: ConsolidationResult = { applied: false, raw_count: items.length, merged: 0, downgraded: 0, error: null, duration_ms: 0 };
  const done = (error: string | null, out: CheckItem[], merged = 0, downgraded = 0) => ({
    items: out,
    result: { ...base, applied: error === null, merged, downgraded, error, duration_ms: Date.now() - startedAt },
    usage,
  });

  if (items.length < 2) return done(null, items);
  if (cancelSignal?.aborted) return done("Analyse abgebrochen", items);

  const ids = new Map<string, CheckItem>();
  const listing = items.map((it, i) => {
    const key = `c${i + 1}`;
    ids.set(key, it);
    const layer = layerOf(norms, it.norm_id);
    const ebene = layer === 4 ? "Gemeinde" : layer === 3 ? "Kanton" : layer === 1 ? "Bund" : "Spezial";
    return `${key} | ${ebene} | ${it.status} | ${it.category} | ${it.norm_title} | ${it.finding.slice(0, 300)}` +
      (it.suggestion ? ` | Empfehlung: ${it.suggestion.slice(0, 150)}` : "");
  });

  const controller = new AbortController();
  const onCancel = () => controller.abort();
  cancelSignal?.addEventListener("abort", onCancel, { once: true });
  const remaining = Math.min(CONSOLIDATION_CALL_MS, deadlineAt - Date.now());
  const killTimer = setTimeout(() => controller.abort(), Math.max(1_000, remaining));

  try {
    if (remaining < 8_000) return done("Zeitbudget für Konsolidierung aufgebraucht", items);

    const message = await anthropic.messages.create(
      {
        model: ANALYSIS_MODEL,
        max_tokens: 4_000,
        system: [{ type: "text", text: CONSOLIDATION_SYSTEM }],
        messages: [{ role: "user", content: `PRÜFPUNKTE (id | Ebene | status | category | Titel | Befund | Empfehlung):
${listing.join("\n")}` }],
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: CONSOLIDATION_SCHEMA },
      },
      { timeout: Math.max(5_000, remaining), signal: controller.signal },
    );
    usage.input_tokens = message.usage.input_tokens ?? 0;
    usage.output_tokens = message.usage.output_tokens ?? 0;

    if (message.stop_reason !== "end_turn") return done(`Konsolidierung: stop_reason ${message.stop_reason}`, items);
    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text) as {
      merges: { keep: string; drop: string[]; title: string }[];
      downgrades: { id: string; reason: string }[];
    };

    const dropped = new Set<string>();
    /** Wohin ein gedroppter Punkt aufgegangen ist — damit ein Downgrade darauf beim Behaltenen landet. */
    const mergedInto = new Map<string, string>();
    let merged = 0;
    for (const m of parsed.merges ?? []) {
      if (!ids.has(m.keep) || dropped.has(m.keep)) continue;
      const group = Array.from(new Set([m.keep, ...(m.drop ?? [])])).filter((d) => ids.has(d) && !dropped.has(d));
      if (group.length < 2) continue;

      // Status und Text gehören zusammen: Behalten wird der Punkt mit dem strengsten
      // Status (bei Gleichstand der vom Modell gewählte). Ein "fail"-Befund darf nie
      // unter einem "eingehalten"-Text stehen.
      let keepId = m.keep;
      for (const g of group) {
        if (SEVERITY[ids.get(g)!.status] < SEVERITY[ids.get(keepId)!.status]) keepId = g;
      }
      const keep = ids.get(keepId)!;
      for (const g of group) {
        if (g === keepId) continue;
        const it = ids.get(g)!;
        if (!keep.suggestion && it.suggestion && keep.status !== "ok") keep.suggestion = it.suggestion;
        dropped.add(g);
        mergedInto.set(g, keepId);
        merged++;
      }
      if (keep.status === "ok") keep.suggestion = null;
      const title = (m.title ?? "").trim();
      if (title) keep.norm_title = title.slice(0, 500);
    }

    // Interne IDs (c12) haben im Text nichts verloren — durch den Titel des Punkts ersetzen.
    const deId = (text: string) =>
      text.replace(/\bc(\d{1,3})\b/g, (m, n) => {
        const ref = ids.get(`c${n}`);
        return ref ? `«${ref.norm_title.split(" – ")[0].slice(0, 60)}»` : m;
      });

    let downgraded = 0;
    for (const d of parsed.downgrades ?? []) {
      let id = d.id;
      while (mergedInto.has(id)) id = mergedInto.get(id)!;
      const it = ids.get(id);
      if (!it || it.status !== "ok") continue;
      it.status = "warn";
      const reason = deId((d.reason ?? "").trim()).slice(0, 200);
      if (reason && !it.suggestion) it.suggestion = reason;
      if (it.confidence === "high") it.confidence = "medium";
      downgraded++;
    }
    for (const it of Array.from(ids.values())) {
      it.norm_title = deId(it.norm_title);
      if (it.suggestion) it.suggestion = deId(it.suggestion);
    }

    const out = items.filter((_, i) => !dropped.has(`c${i + 1}`));
    return done(null, out, merged, downgraded);
  } catch (e) {
    const msg = cancelSignal?.aborted
      ? "Analyse abgebrochen"
      : controller.signal.aborted
        ? "Zeitbudget für Konsolidierung überschritten"
        : e instanceof Error ? e.message : String(e);
    return done(msg, items);
  } finally {
    clearTimeout(killTimer);
    cancelSignal?.removeEventListener("abort", onCancel);
  }
}

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
  part: NormPart,
  index: number,
  total: number,
  system: string,
  fileBlock: FileBlock,
  referenceBlock: string,
  inReference: boolean,
  runDeadlineAt: number,
  onPrefillDone: (() => void) | null,
  effort: "low" | "medium" | "high" = EFFORT,
  cancelSignal: AbortSignal | null = null,
): Promise<CallOutcome> {
  const norm = part.norm;
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
    // (system + PDF + Referenzrahmen). Der Normtext steht dahinter und variiert pro Call.
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: referenceBlock, cache_control: { type: "ephemeral" } },
          { type: "text", text: buildNormBlock(part, index, total, inReference) },
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

  // Bergung greift, wenn eine Antwort vollständig ankam, aber nicht sauber parst.
  // Bei Abbruch/Timeout vor finalMessage() ist text leer — dann gibt es nichts zu bergen.
  let items: CheckItem[] = [];
  if (text.trim().length > 0) {
    items = parseChecks(text)
      .map((raw) => toCheckItem(raw, norm))
      .filter((it) => it.finding.length > 0)
      .slice(0, MAX_CHECKS_PER_NORM);
  }
  // 0 Prüfpunkte bei sauberem end_turn sind ein gültiges Ergebnis: Die Norm hat für
  // diesen Plan nichts Relevantes (der Prompt erlaubt die leere Liste ausdrücklich).

  return {
    items,
    result: {
      norm_id: norm.id,
      norm_title: partLabel(part),
      part: part.part,
      parts: part.parts,
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
  normsInput: NormInput[],
  fileBlock: FileBlock,
  ctx: ProjectContext,
  budgetMs: number = RUN_BUDGET_MS,
  cancelSignal: AbortSignal | null = null,
): Promise<AnalysisRunResult> {
  const startedAt = Date.now();
  const runDeadlineAt = startedAt + budgetMs;
  // Konsolidierung nur, wenn das Budget sie hergibt — sonst bekommt die Norm-Phase alles.
  const withConsolidation = budgetMs >= CONSOLIDATION_MIN_BUDGET_MS;
  const deadlineAt = withConsolidation ? runDeadlineAt - CONSOLIDATION_RESERVE_MS : runDeadlineAt;
  const system = buildSystemPrompt(ctx);
  // Reihenfolge: kommunale Normen zuerst (längste Calls, sie schreiben ohnehin den
  // Cache), dann nach Textlänge — der langsamste Call bekommt das grösste Zeitfenster.
  const norms = normsInput.slice().sort((a, b) => {
    const ra = isReferenceNorm(a) ? 0 : 1, rb = isReferenceNorm(b) ? 0 : 1;
    return ra - rb || b.text.length - a.text.length;
  });
  const referenceNorms = norms.filter(isReferenceNorm);
  const reference = buildReferenceBlock(ctx, referenceNorms);
  const units = toNormParts(norms);
  const total = units.length;
  const call = (
    unit: NormPart, index: number, gate: (() => void) | null, effort?: "low" | "medium" | "high",
  ) => analyseOneNorm(
    unit, index, total, system, fileBlock, reference.text, reference.completeIds.has(unit.norm.id),
    deadlineAt, gate, effort ?? EFFORT, cancelSignal,
  );

  const outcomes: CallOutcome[] = [];

  if (total > 0) {
    // Torwächter: löst auf, sobald Call 1 den Cache geschrieben hat (oder scheitert).
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => { openGate = resolve; });

    const firstPromise = call(units[0], 0, openGate);

    let gateTimer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      gate,
      new Promise<void>((resolve) => { gateTimer = setTimeout(resolve, PREFILL_GATE_MAX_MS); }),
    ]);
    if (gateTimer) clearTimeout(gateTimer);

    const rest = units.slice(1);
    const restOutcomes: CallOutcome[] = [];
    for (let offset = 0; offset < rest.length; offset += MAX_CONCURRENCY) {
      if (cancelSignal?.aborted) break;
      const wave = rest.slice(offset, offset + MAX_CONCURRENCY);
      const settled = await Promise.all(
        wave.map((n, k) => call(n, offset + k + 1, null)),
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

      // outcomes[i] gehört zu units[i] (gleiche Reihenfolge: erster Call + Wellen).
      const unit = units[i];
      if (!unit) continue;
      // Hinweis: ein anderer effort invalidiert den Prompt-Cache (Doku) — der Retry
      // schreibt den Prefix neu. Bewusst in Kauf genommen, sonst läuft er in dieselbe Wand.
      const retryEffort = isTimeoutError(o.result.error) ? "low" : EFFORT;
      const retry = await call(unit, i, null, retryEffort);
      retry.result.retried = true;
      if (!retry.result.ok && o.result.error) retry.result.error = `${retry.result.error} (1. Versuch: ${o.result.error})`;
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

  // Konsolidierung: Dubletten über Normen hinweg zusammenlegen, widersprüchliche "ok" abstufen.
  let items = outcomes.flatMap((o) => o.items);
  let consolidation: ConsolidationResult | null = null;
  if (withConsolidation && !cancelSignal?.aborted) {
    const c = await consolidateItems(items, norms, runDeadlineAt, cancelSignal);
    items = c.items;
    consolidation = c.result;
    usage.input_tokens += c.usage.input_tokens;
    usage.output_tokens += c.usage.output_tokens;
  }

  return {
    items,
    calls: outcomes.map((o) => o.result),
    usage,
    cost_usd: computeCost(usage),
    duration_ms: Date.now() - startedAt,
    model: ANALYSIS_MODEL,
    failed_norms: outcomes
      .filter((o) => !o.result.ok)
      .map((o) => ({ norm_id: o.result.norm_id, norm_title: o.result.norm_title, error: o.result.error ?? "unbekannt" })),
    consolidation,
  };
}
