/**
 * Kenndatenblatt: Zahlenformat, Berechnung der Geschossfläche und Aufbau des Blatts. Rein, läuft auf Server
 * und im Browser und kommt ohne Modell aus. Die Berechnung stammt immer von hier, nie vom Modell.
 * Die Prüfung der Modellangaben steht in kenndaten-beleg.ts.
 */

export const KENNDATEN_FELDER = [
  "vollgeschosse",
  "ausnuetzungsziffer",
  "baumassenziffer",
  "ueberbauungsziffer",
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

/** Geprüfter Wert: Masse in m, Ziffern als Zahl, Vollgeschosse als ganze Zahl, Dachform als Text. */
export interface KenndatenWert {
  zahl: number | null;
  text: string | null;
  zusatz: string | null;
  /** Wie die Norm das Mass nennt, etwa «Fassadenhöhe». Sonst vermischt das Blatt Messweisen. */
  bezeichnung: string | null;
  normTitle: string;
  artikel: string | null;
  layer: number;
}

export type KenndatenWerte = Partial<Record<KenndatenFeld, KenndatenWert>>;

export interface KenndatenAuswertung {
  werte: KenndatenWerte;
  /** Felder, zu denen Normen derselben Ebene verschiedene Werte nennen. Sie bleiben leer. */
  widerspruechlich: KenndatenFeld[];
  /** Felder, zu denen es eine Angabe gab, die sich nicht belegen oder an die Zone binden liess. */
  unbelegt: KenndatenFeld[];
  /** Anzahl verworfener Angaben, nur zur Nachvollziehbarkeit. */
  verworfen: number;
  /** Warum eine Gemeindenorm auf dem gespeicherten Text statt dem Original-PDF lief. */
  hinweise: string[];
  /** Das Original war nur vorübergehend nicht abrufbar. Das Ergebnis wird später neu berechnet. */
  vorbehalt: boolean;
}

export const LEER = "–";

// ── Schweizer Zahlenformat ───────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const groupThousands = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, "'");

/** 1'839.00. Mindestens zwei Stellen; mehr nur, wenn der Wert sie hat (AZ 0.375 bleibt 0.375). */
export function formatCh(n: number): string {
  const fixed = n.toFixed(4).replace(/(\.\d\d\d*?)0+$/, "$1");
  const [whole, decimals] = fixed.split(".");
  return `${groupThousands(whole)}.${decimals}`;
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

// ── Berechnung ───────────────────────────────────────────────────────────────

export const ANGENOMMENE_GESCHOSSHOEHE_M = 3;

export interface GeschossflaecheInput {
  landflaeche: number | null;
  az: number | null;
  /** Eine AZ ist genannt, aber widersprüchlich oder unbelegt. Sie fehlt also nicht wirklich. */
  azUnklar?: boolean;
  /** Das Reglement regelt die Dichte über eine andere Ziffer, etwa «Baumassenziffer». */
  andereZiffer?: string | null;
  laenge: number | null;
  breite: number | null;
  gebaeudehoehe: number | null;
  firsthoehe: number | null;
}

export type GeschossflaecheResult =
  | { art: "az" | "volumen"; titel: string; zeilen: string[]; ergebnis: number; hinweis: string }
  | { art: "keine"; titel: string; zeilen: string[]; ergebnis: null; hinweis: string };

const usable = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 0;

function keine(hinweis: string): GeschossflaecheResult {
  return { art: "keine", titel: "Geschossfläche", zeilen: [], ergebnis: null, hinweis };
}

export function berechneGeschossflaeche(i: GeschossflaecheInput): GeschossflaecheResult {
  if (!usable(i.landflaeche)) return keine("Eine Berechnung ist mangels Werten nicht möglich: Die Landfläche fehlt.");
  if (usable(i.az)) {
    const ergebnis = round2(i.landflaeche * i.az);
    return {
      art: "az",
      titel: "Max. anrechenbare Geschossfläche, theoretisch",
      zeilen: [`${formatM2(i.landflaeche)} x ${formatCh(i.az)} (AZ) = ${formatM2(ergebnis)}`],
      ergebnis,
      hinweis: "Grundbuchfläche, ohne Bestand und Boni; Anrechenbarkeit gemäss Reglement.",
    };
  }
  if (i.azUnklar) return keine("Eine Berechnung ist nicht möglich: Die Angabe zur Ausnützungsziffer ist widersprüchlich oder nicht belegt, bitte am Original prüfen.");
  if (i.andereZiffer) return keine(`Eine Berechnung der Geschossfläche ist nicht möglich: Das Reglement regelt die Dichte über die ${i.andereZiffer}.`);
  if (usable(i.laenge) && usable(i.breite) && usable(i.gebaeudehoehe) && usable(i.firsthoehe)) {
    const volumen = round2(i.laenge * i.breite * ((i.gebaeudehoehe + i.firsthoehe) / 2));
    const ergebnis = Math.round(volumen / ANGENOMMENE_GESCHOSSHOEHE_M / 10) * 10;
    return {
      art: "volumen",
      titel: "Geschossfläche, grober Richtwert",
      zeilen: [
        `${formatM(i.laenge)} x ${formatM(i.breite)} x ((${formatM(i.gebaeudehoehe)} + ${formatM(i.firsthoehe)}) : 2) = ${formatM3(volumen)}`,
        `${formatM3(volumen)} : ${formatM(ANGENOMMENE_GESCHOSSHOEHE_M)} = ca. ${groupThousands(String(ergebnis))} m²`,
      ],
      ergebnis,
      hinweis: `Grober Richtwert aus Gebäudehülle, inkl. Aussenwände, mit angenommener Geschosshöhe ${formatM(ANGENOMMENE_GESCHOSSHOEHE_M)}; keine zulässige Nutzung; Abstände, Parzelle, Geschosszahl ungeprüft.`,
    };
  }
  return keine("Eine Berechnung ist mangels Werten nicht möglich: Es fehlen die Ausnützungsziffer oder Gebäudelänge, Gebäudebreite, Gebäudehöhe und Firsthöhe.");
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
  hinweise: string[];
}

const WIDERSPRUCH = "Normen widersprechen sich, am Original prüfen";
const UNBELEGT = "Nicht eindeutig belegt, am Original prüfen";

function quelleVon(w: KenndatenWert | undefined): string {
  if (!w) return LEER;
  const title = w.normTitle.length > 60 ? `${w.normTitle.slice(0, 57).replace(/\s+\S*$/, "")} …` : w.normTitle;
  return w.artikel ? `${title}, ${w.artikel}` : title;
}

function mitZusatz(wert: string, w: KenndatenWert): string {
  return w.zusatz ? `${wert} (${w.zusatz})` : wert;
}

function masswert(w: KenndatenWert | undefined): string {
  if (!w) return LEER;
  if (w.zahl != null) return mitZusatz(formatM(w.zahl), w);
  return w.zusatz ?? LEER;
}

const squeeze = (s: string) => s.toLowerCase().replace(/[^a-zäöü]/g, "");

/** «Gebäudehöhe (Fassadenhöhe)», aber nicht «Firsthöhe (First)»: Nur eine andere Messweise ist eine Angabe wert. */
function mitBezeichnung(label: string, w: KenndatenWert | undefined): string {
  const b = w?.bezeichnung ? squeeze(w.bezeichnung) : "";
  const l = squeeze(label);
  if (!b || b.includes(l) || l.includes(b) || b.includes("grenzabstand")) return label;
  return `${label} (${w!.bezeichnung})`;
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
  const unklar = (feld: KenndatenFeld) => a.widerspruechlich.includes(feld) || a.unbelegt.includes(feld);

  const zeile = (bezeichnung: string, feld: KenndatenFeld, wert: string): KenndatenZeile => ({
    bezeichnung: mitBezeichnung(bezeichnung, w[feld]),
    wert,
    quelle: a.widerspruechlich.includes(feld) ? WIDERSPRUCH : a.unbelegt.includes(feld) ? UNBELEGT : quelleVon(w[feld]),
  });
  const massZeile = (bezeichnung: string, feld: KenndatenFeld) => zeile(bezeichnung, feld, masswert(w[feld]));
  const zifferZeile = (bezeichnung: string, feld: KenndatenFeld) => {
    const v = w[feld];
    return zeile(bezeichnung, feld, v?.zahl != null ? mitZusatz(formatCh(v.zahl), v) : LEER);
  };

  const zone = projekt.zoneConfidence === "low" ? `${projekt.bauzone} (unsicher)` : projekt.bauzone;
  const zoneQuelle = projekt.zoneSource === "oereb" ? "ÖREB-Auszug" : projekt.zoneSource === "manual" ? "Manuell erfasst" : "Projektangabe";

  // Die Breite ist kein eigener Posten, sondern steht wie in «20.00 m / Breite 12.00 m» bei der Länge.
  const laengeZeile = massZeile("Gebäudelänge", "gebaeudelaenge");
  if (w.gebaeudebreite?.zahl != null) {
    laengeZeile.wert = `${laengeZeile.wert} / Breite ${masswert(w.gebaeudebreite)}`;
    const quellen = [w.gebaeudelaenge, w.gebaeudebreite].filter(Boolean).map((x) => quelleVon(x));
    if (!unklar("gebaeudelaenge")) laengeZeile.quelle = Array.from(new Set(quellen)).join("; ");
  }

  const geschosse = w.vollgeschosse;
  const zeilen: KenndatenZeile[] = [
    { bezeichnung: "Zone", wert: zone, quelle: zoneQuelle },
    {
      bezeichnung: "Landfläche",
      wert: landflaeche != null ? formatM2(landflaeche) : LEER,
      quelle: landflaeche != null ? "ÖREB-Auszug (Grundbuch)" : LEER,
    },
    zeile("Vollgeschosse", "vollgeschosse", geschosse?.zahl != null ? mitZusatz(String(geschosse.zahl), geschosse) : LEER),
    zifferZeile("Ausnützungsziffer", "ausnuetzungsziffer"),
    ...(w.baumassenziffer ? [zifferZeile("Baumassenziffer", "baumassenziffer")] : []),
    ...(w.ueberbauungsziffer ? [zifferZeile("Überbauungsziffer", "ueberbauungsziffer")] : []),
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
  const andereZiffer = w.baumassenziffer ? "Baumassenziffer" : w.ueberbauungsziffer ? "Überbauungsziffer" : null;

  return {
    projektName: projekt.name,
    ort: ort || LEER,
    parzelle: projekt.parcel || LEER,
    datum: formatDateCh(input.jetzt.toISOString()) ?? LEER,
    zeilen,
    berechnung: berechneGeschossflaeche({
      landflaeche,
      az: w.ausnuetzungsziffer?.zahl ?? null,
      azUnklar: unklar("ausnuetzungsziffer"),
      andereZiffer,
      laenge: w.gebaeudelaenge?.zahl ?? null,
      breite: w.gebaeudebreite?.zahl ?? null,
      gebaeudehoehe: w.gebaeudehoehe?.zahl ?? null,
      firsthoehe: w.firsthoehe?.zahl ?? null,
    }),
    oerebStand,
    hinweise: a.hinweise ?? [],
  };
}

export function kenndatenDateiname(projektName: string): string {
  const safe = projektName.trim().replace(new RegExp("[^\\p{L}\\p{N}._-]+", "gu"), "_").replace(/^_+|_+$/g, "");
  return `Kenndatenblatt_${safe || "Projekt"}.pdf`;
}
