/**
 * Kenndatenblatt: Beleg-Prüfung, Auswahl der Werte und Berechnung der Geschossfläche. Rein, läuft auf
 * Server und im Browser und kommt ohne Modell aus. Die Berechnung stammt immer von hier, nie vom Modell.
 */

export const KENNDATEN_FELDER = [
  "vollgeschosse",
  "ausnuetzungsziffer",
  "grenzabstand_gross",
  "grenzabstand_klein",
  "gebaeudelaenge",
  "gebaeudebreite",
  "gebaeudehoehe",
  "firsthoehe",
  "dachform",
  "strassenabstand",
] as const;

export type KenndatenFeld = (typeof KENNDATEN_FELDER)[number];
export type ModellEinheit = "m" | "cm" | "mm" | "%" | "";

/** Eine Angabe des Modells, noch ungeprüft. `normIndex` ist 1-basiert. */
export interface KenndatenKandidat {
  feld: KenndatenFeld;
  zahl: number | null;
  einheit: ModellEinheit;
  text: string | null;
  zusatz: string | null;
  normIndex: number;
  artikel: string | null;
  zitat: string;
  zoneImText: string;
  giltFuerAlleZonen: boolean;
}

/** Eine dem Modell vorgelegte Norm. `text` ist genau das, was das Modell gesehen hat. */
export interface BelegNorm {
  title: string;
  layer: number;
  text: string;
}

/** Geprüfter Wert: Masse in m, AZ als Zahl, Vollgeschosse als ganze Zahl, Dachform als Text. */
export interface KenndatenWert {
  zahl: number | null;
  text: string | null;
  zusatz: string | null;
  normTitle: string;
  artikel: string | null;
  layer: number;
}

export type KenndatenWerte = Partial<Record<KenndatenFeld, KenndatenWert>>;

export interface KenndatenAuswertung {
  werte: KenndatenWerte;
  /** Felder, zu denen Normen derselben Ebene verschiedene Werte nennen. Sie bleiben leer. */
  widerspruechlich: KenndatenFeld[];
  /** Anzahl verworfener Angaben, nur zur Nachvollziehbarkeit. */
  verworfen: number;
}

export const LEER = "–";

// ── Schweizer Zahlenformat ───────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 1'839.00. Mindestens zwei Stellen; mehr nur, wenn der Wert sie hat (AZ 0.375 bleibt 0.375). */
export function formatCh(n: number): string {
  const fixed = n.toFixed(4).replace(/(\.\d\d\d*?)0+$/, "$1");
  const [whole, decimals] = fixed.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${decimals}`;
}

export const formatM = (n: number) => `${formatCh(n)} m`;
export const formatM2 = (n: number) => `${formatCh(n)} m²`;
export const formatM3 = (n: number) => `${formatCh(n)} m³`;

export function formatDateCh(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich" });
}

// ── Beleg-Prüfung ────────────────────────────────────────────────────────────

const NUMBER_RE = /\d{1,3}(?:['’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

function canonicalNumber(raw: string): number {
  return Number(raw.replace(/['’]/g, "").replace(",", "."));
}

/** Alle Zahlen eines Texts als Werte: 3.50, 3,50 und 3.5 sind dieselbe Zahl, 13.50 enthält nicht 3.50. */
export function numbersIn(text: string): Set<number> {
  return new Set(Array.from(text.matchAll(NUMBER_RE), (m) => canonicalNumber(m[0])));
}

export function numberInText(value: number, text: string): boolean {
  return numbersIn(text).has(value);
}

const ZAHLWORTE = ["ein", "zwei", "drei", "vier", "fünf", "sechs"];
const ROEMISCH = ["I", "II", "III", "IV", "V", "VI"];

/** Geschosse stehen in Reglementen auch als «dreigeschossig» oder römisch in der Zonentabelle. */
function geschossInText(value: number, text: string): boolean {
  if (numberInText(value, text)) return true;
  const wort = ZAHLWORTE[value - 1];
  if (!wort) return false;
  if (new RegExp(`(?:^|[^\\p{L}])${wort}(?:e|es|er)?[\\s-]*(?:voll)?gesch`, "iu").test(text)) return true;
  if (value > 1 && new RegExp(`(?:^|[^\\p{L}])${wort}(?:[^\\p{L}]|$)`, "iu").test(text)) return true;
  return new RegExp(`(?:^|[^A-Za-z])${ROEMISCH[value - 1]}(?:[^A-Za-z]|$)`).test(text);
}

const WORD_RE = new RegExp("[\\p{L}\\p{N}]+", "gu");

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

/** Das Zitat muss im Normtext stehen. PDF-Text bricht Wörter um, deshalb wortweise und mit Toleranz. */
export function zitatInText(zitat: string, text: string): boolean {
  const words = wordsOf(zitat);
  if (words.length === 0) return false;
  const known = new Set(wordsOf(text));
  return words.filter((w) => known.has(w)).length / words.length >= 0.8;
}

/** «Art. 12» muss es im Normtext geben. Freie Angaben wie «Zonentabelle» bleiben ungeprüft. */
export function artikelInText(artikel: string, text: string): boolean {
  const m = artikel.match(/(art(?:ikel|\.)?|§|anhang|ziff(?:er|\.)?)\s*(\d+[a-z]?)/i);
  if (!m) return true;
  const word = m[1].toLowerCase();
  const family = word.startsWith("art") ? "art(?:ikel|\\.)?" : word === "§" ? "§" : word === "anhang" ? "anhang" : "ziff(?:er|\\.)?";
  return new RegExp(`${family}\\s*${m[2]}(?![\\da-z])`, "i").test(text);
}

// ── Zonenabgleich ────────────────────────────────────────────────────────────

function zoneTokens(zone: string): string[] {
  const s = zone
    .toLowerCase()
    .replace(/wohn[\s-]*(?:und[\s-]*)?gewerbe\s*zone|misch\s*zone/g, "wg")
    .replace(/wohn\s*zone/g, "w")
    .replace(/kern\s*zone/g, "k")
    .replace(/zentrums?\s*zone/g, "z")
    .replace(/gewerbe\s*zone/g, "g")
    .replace(/industrie\s*zone/g, "i")
    .replace(/\b(?:bau)?zone\b/g, " ")
    .replace(/\b([a-z]{1,3})[\s-]+(?=\d)/g, "$1");
  const tokens = s.split(new RegExp("[^\\p{L}\\p{N}]+", "u")).filter(Boolean);
  // «Wohnzone W2» heisst nur W2.
  return tokens.filter((t) => !(/^[a-z]{1,3}$/.test(t) && tokens.some((o) => o !== t && o.startsWith(t) && /\d/.test(o))));
}

/** Im Zweifel nein: W2 passt zu «Wohnzone 2» und «W2, W3», aber nicht zu W3, W21, W2a oder «Wohnzone». */
export function zoneMatches(projectZone: string, zoneImText: string): boolean {
  const a = zoneTokens(projectZone);
  const b = new Set(zoneTokens(zoneImText));
  return a.length > 0 && a.every((t) => b.has(t));
}

const ALLE_ZONEN_RE = /^(?:in\s+)?(?:alle|allgemein|sämtliche|jede)/i;

// ── Prüfung eines Kandidaten ─────────────────────────────────────────────────

/** `zone`: Wert gehört zu einer anderen Zone. `beleg`: Wert ist im Normtext nicht belegt. */
export type Verwerfung = "zone" | "beleg";

function normalize(k: KenndatenKandidat): { zahl: number | null; text: string | null } | null {
  if (k.feld === "dachform") {
    const text = (k.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    return text ? { zahl: null, text } : null;
  }
  if (k.zahl == null || !Number.isFinite(k.zahl) || k.zahl <= 0) return null;
  if (k.feld === "vollgeschosse") {
    return Number.isInteger(k.zahl) && k.zahl <= 30 && k.einheit === "" ? { zahl: k.zahl, text: null } : null;
  }
  if (k.feld === "ausnuetzungsziffer") {
    if (k.einheit !== "" && k.einheit !== "%") return null;
    const az = k.einheit === "%" ? k.zahl / 100 : k.zahl;
    return az <= 10 ? { zahl: az, text: null } : null;
  }
  if (k.einheit === "%") return null;
  const metres = k.einheit === "cm" ? k.zahl / 100 : k.einheit === "mm" ? k.zahl / 1000 : k.zahl;
  return metres <= 300 ? { zahl: metres, text: null } : null;
}

export function pruefeKandidat(
  k: KenndatenKandidat,
  norm: BelegNorm | undefined,
  projectZone: string,
): { ok: true; wert: KenndatenWert } | { ok: false; grund: Verwerfung } {
  if (!norm) return { ok: false, grund: "beleg" };

  const zone = k.zoneImText.trim();
  const zoneOk = k.giltFuerAlleZonen ? !zone || ALLE_ZONEN_RE.test(zone) || zoneMatches(projectZone, zone) : zoneMatches(projectZone, zone);
  if (!zoneOk) return { ok: false, grund: "zone" };

  const value = normalize(k);
  if (!value) return { ok: false, grund: "beleg" };

  const zitat = k.zitat.trim();
  const artikel = (k.artikel ?? "").trim();
  if (!zitat && !artikel) return { ok: false, grund: "beleg" };
  if (zitat && !zitatInText(zitat, norm.text)) return { ok: false, grund: "beleg" };
  if (!zitat && !artikelInText(artikel, norm.text)) return { ok: false, grund: "beleg" };

  // Geprüft wird die Zahl, wie sie im Text steht (50 %, 750 cm), nicht die umgerechnete.
  if (value.zahl != null) {
    const found = k.feld === "vollgeschosse"
      ? (t: string) => geschossInText(k.zahl!, t)
      : (t: string) => numberInText(k.zahl!, t);
    if (!found(norm.text)) return { ok: false, grund: "beleg" };
    if (zitat && !found(zitat)) return { ok: false, grund: "beleg" };
  } else {
    const known = new Set(wordsOf(norm.text));
    if (!wordsOf(value.text!).some((w) => w.length >= 4 && known.has(w))) return { ok: false, grund: "beleg" };
  }

  // Jede Zahl aus Zusatz und Dachform muss ebenfalls im Normtext stehen.
  const zusatz = (k.zusatz ?? "").replace(/^\(|\)$/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const normNumbers = numbersIn(norm.text);
  for (const n of Array.from(numbersIn(`${zusatz ?? ""} ${value.text ?? ""}`))) {
    if (!normNumbers.has(n)) return { ok: false, grund: "beleg" };
  }

  return {
    ok: true,
    wert: {
      ...value,
      zusatz,
      normTitle: norm.title,
      artikel: artikel && artikelInText(artikel, norm.text) ? artikel.slice(0, 40) : null,
      layer: norm.layer,
    },
  };
}

// ── Vorrang der Ebenen ───────────────────────────────────────────────────────

/** Gemeinde vor projektbezogener Spezialnorm vor Kanton vor Bund. */
export function layerRank(layer: number): number {
  return layer === 4 ? 0 : layer === 5 ? 1 : layer === 3 ? 2 : 3;
}

function sameValue(a: KenndatenWert, b: KenndatenWert): boolean {
  return a.zahl === b.zahl && (a.text ?? "").toLowerCase() === (b.text ?? "").toLowerCase();
}

/**
 * Pro Feld der Wert der höchsten Ebene, die einen hat. Ein Wert einer anderen Zone sagt nichts über
 * diese Zone, die nächste Ebene darf einspringen. Eine unbelegte Angabe heisst dagegen: Die Gemeinde
 * regelt es vermutlich, wir können es nur nicht belegen. Dann bleibt das Feld leer, sonst stünde
 * dort der Kantonswert, den die Gemeinde womöglich verschärft hat.
 */
export function waehleWerte(kandidaten: KenndatenKandidat[], normen: BelegNorm[], projectZone: string): KenndatenAuswertung {
  const werte: KenndatenWerte = {};
  const widerspruechlich: KenndatenFeld[] = [];
  let verworfen = 0;

  for (const feld of KENNDATEN_FELDER) {
    const ranks = new Map<number, { ok: KenndatenWert[]; unbelegt: boolean }>();
    for (const k of kandidaten.filter((c) => c.feld === feld)) {
      const norm = normen[k.normIndex - 1];
      const result = pruefeKandidat(k, norm, projectZone);
      if (!result.ok) verworfen += 1;
      if (!norm) continue;
      const rank = layerRank(norm.layer);
      const entry = ranks.get(rank) ?? { ok: [], unbelegt: false };
      if (result.ok) entry.ok.push(result.wert);
      else if (result.grund === "beleg") entry.unbelegt = true;
      ranks.set(rank, entry);
    }
    for (const rank of Array.from(ranks.keys()).sort((a, b) => a - b)) {
      const { ok, unbelegt } = ranks.get(rank)!;
      if (ok.length > 0) {
        if (ok.every((w) => sameValue(w, ok[0]))) werte[feld] = ok[0];
        else widerspruechlich.push(feld);
        break;
      }
      if (unbelegt) break;
    }
  }
  return { werte, widerspruechlich, verworfen };
}

// ── Berechnung ───────────────────────────────────────────────────────────────

export const ANGENOMMENE_GESCHOSSHOEHE_M = 3;

export interface GeschossflaecheInput {
  landflaeche: number | null;
  az: number | null;
  laenge: number | null;
  breite: number | null;
  gebaeudehoehe: number | null;
  firsthoehe: number | null;
}

export type GeschossflaecheResult =
  | { art: "az" | "volumen"; zeilen: string[]; ergebnis: number; hinweis: string }
  | { art: "keine"; zeilen: string[]; ergebnis: null; hinweis: string };

const usable = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 0;

export function berechneGeschossflaeche(i: GeschossflaecheInput): GeschossflaecheResult {
  if (!usable(i.landflaeche)) {
    return { art: "keine", zeilen: [], ergebnis: null, hinweis: "Eine Berechnung ist mangels Werten nicht möglich: Die Landfläche fehlt." };
  }
  if (usable(i.az)) {
    const ergebnis = round2(i.landflaeche * i.az);
    return {
      art: "az",
      zeilen: [`${formatM2(i.landflaeche)} x ${formatCh(i.az)} (AZ) = ${formatM2(ergebnis)}`],
      ergebnis,
      hinweis: "Berechnet mit der ganzen Landfläche, ohne Bestandesabzug.",
    };
  }
  if (usable(i.laenge) && usable(i.breite) && usable(i.gebaeudehoehe) && usable(i.firsthoehe)) {
    const volumen = round2(i.laenge * i.breite * ((i.gebaeudehoehe + i.firsthoehe) / 2));
    const ergebnis = round2(volumen / ANGENOMMENE_GESCHOSSHOEHE_M);
    return {
      art: "volumen",
      zeilen: [
        `${formatM(i.laenge)} x ${formatM(i.breite)} x ((${formatM(i.gebaeudehoehe)} + ${formatM(i.firsthoehe)}) : 2) = ${formatM3(volumen)}`,
        `${formatM3(volumen)} : ${formatM(ANGENOMMENE_GESCHOSSHOEHE_M)} = ${formatM2(ergebnis)}`,
      ],
      ergebnis,
      hinweis: `Richtwert mit angenommener Geschosshöhe ${formatM(ANGENOMMENE_GESCHOSSHOEHE_M)}, ohne Bestandesabzug. Keine Ausnützungsziffer gefunden.`,
    };
  }
  return {
    art: "keine",
    zeilen: [],
    ergebnis: null,
    hinweis: "Eine Berechnung ist mangels Werten nicht möglich: Es fehlen die Ausnützungsziffer oder Gebäudelänge, Gebäudebreite, Gebäudehöhe und Firsthöhe.",
  };
}

// ── Blatt ────────────────────────────────────────────────────────────────────

export interface KenndatenProjekt {
  name: string;
  municipality: string | null;
  canton: string | null;
  parcel: string | null;
  bauzone: string;
  zoneSource: string | null;
  zoneConfidence: string | null;
}

export interface KenndatenZeile {
  bezeichnung: string;
  wert: string;
  quelle: string;
}

export interface KenndatenBlatt {
  projektName: string;
  ort: string;
  parzelle: string;
  datum: string;
  zeilen: KenndatenZeile[];
  berechnung: GeschossflaecheResult;
  oerebStand: string;
}

const WIDERSPRUCH = "Normen widersprechen sich, am Original prüfen";

function quelleVon(w: KenndatenWert | undefined): string {
  if (!w) return LEER;
  const title = w.normTitle.length > 60 ? `${w.normTitle.slice(0, 57).replace(/\s+\S*$/, "")} …` : w.normTitle;
  return w.artikel ? `${title}, ${w.artikel}` : title;
}

function mitZusatz(wert: string, w: KenndatenWert): string {
  return w.zusatz ? `${wert} (${w.zusatz})` : wert;
}

function masswert(w: KenndatenWert | undefined): string {
  return w?.zahl != null ? mitZusatz(formatM(w.zahl), w) : LEER;
}

export function baueKenndatenBlatt(input: {
  projekt: KenndatenProjekt;
  landflaeche: number | null;
  oerebFetchedAt: string | null;
  oerebStale: boolean;
  auswertung: KenndatenAuswertung;
  jetzt: Date;
}): KenndatenBlatt {
  const { projekt, landflaeche, auswertung: a } = input;
  const w = a.werte;

  const zeile = (bezeichnung: string, feld: KenndatenFeld, wert: string): KenndatenZeile => ({
    bezeichnung,
    wert,
    quelle: a.widerspruechlich.includes(feld) ? WIDERSPRUCH : quelleVon(w[feld]),
  });
  const massZeile = (bezeichnung: string, feld: KenndatenFeld) => zeile(bezeichnung, feld, masswert(w[feld]));

  const zone = projekt.zoneConfidence === "low" ? `${projekt.bauzone} (unsicher)` : projekt.bauzone;
  const zoneQuelle = projekt.zoneSource === "oereb" ? "ÖREB-Auszug" : projekt.zoneSource === "manual" ? "Manuell erfasst" : "Projektangabe";

  // Die Breite ist kein eigener Posten, sondern steht wie in «20.00 m / Breite 12.00 m» bei der Länge.
  const laengeZeile = massZeile("Gebäudelänge", "gebaeudelaenge");
  if (w.gebaeudebreite?.zahl != null) {
    laengeZeile.wert = `${laengeZeile.wert} / Breite ${masswert(w.gebaeudebreite)}`;
    const quellen = [w.gebaeudelaenge, w.gebaeudebreite].filter(Boolean).map((x) => quelleVon(x));
    if (!a.widerspruechlich.includes("gebaeudelaenge")) laengeZeile.quelle = Array.from(new Set(quellen)).join("; ");
  }

  const az = w.ausnuetzungsziffer;
  const geschosse = w.vollgeschosse;
  const zeilen: KenndatenZeile[] = [
    { bezeichnung: "Zone", wert: zone, quelle: zoneQuelle },
    {
      bezeichnung: "Landfläche",
      wert: landflaeche != null ? formatM2(landflaeche) : LEER,
      quelle: landflaeche != null ? "ÖREB-Auszug (Grundbuch)" : LEER,
    },
    zeile("Vollgeschosse", "vollgeschosse", geschosse?.zahl != null ? mitZusatz(String(geschosse.zahl), geschosse) : LEER),
    zeile("Ausnützungsziffer", "ausnuetzungsziffer", az?.zahl != null ? mitZusatz(formatCh(az.zahl), az) : LEER),
    massZeile("Grenzabstand gross", "grenzabstand_gross"),
    massZeile("Grenzabstand klein", "grenzabstand_klein"),
    laengeZeile,
    massZeile("Gebäudehöhe", "gebaeudehoehe"),
    massZeile("Firsthöhe", "firsthoehe"),
    zeile("Dachform", "dachform", w.dachform?.text ? mitZusatz(w.dachform.text, w.dachform) : LEER),
    massZeile("Strassenabstand", "strassenabstand"),
  ];

  const stand = formatDateCh(input.oerebFetchedAt);
  const oerebStand = !stand
    ? "Stand ÖREB-Auszug: kein Auszug vorhanden"
    : `Stand ÖREB-Auszug: ${stand}${input.oerebStale ? " (letzte Aktualisierung fehlgeschlagen, älterer Stand)" : ""}`;

  const ort = [projekt.municipality, projekt.canton ? `Kanton ${projekt.canton}` : null].filter(Boolean).join(", ");

  return {
    projektName: projekt.name,
    ort: ort || LEER,
    parzelle: projekt.parcel || LEER,
    datum: formatDateCh(input.jetzt.toISOString()) ?? LEER,
    zeilen,
    berechnung: berechneGeschossflaeche({
      landflaeche,
      az: az?.zahl ?? null,
      laenge: w.gebaeudelaenge?.zahl ?? null,
      breite: w.gebaeudebreite?.zahl ?? null,
      gebaeudehoehe: w.gebaeudehoehe?.zahl ?? null,
      firsthoehe: w.firsthoehe?.zahl ?? null,
    }),
    oerebStand,
  };
}

export function kenndatenDateiname(projektName: string): string {
  const safe = projektName.trim().replace(new RegExp("[^\\p{L}\\p{N}._-]+", "gu"), "_").replace(/^_+|_+$/g, "");
  return `Kenndatenblatt_${safe || "Projekt"}.pdf`;
}
