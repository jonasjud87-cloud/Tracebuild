/**
 * Ablauf einer Auswertung: Cache, Sperre pro Projekt, Kosten. Ohne Datenbank testbar. Zwei Tabs bezahlen
 * nicht doppelt: Der zweite Klick wartet, bis der erste fertig ist, und nimmt dessen Ergebnis. Scheitert der
 * erste, rechnet der zweite. Jeder bezahlte Aufruf wird gebucht, auch wenn danach etwas schiefgeht.
 */
import type { KenndatenAuswertung } from "@/lib/kenndaten";

/** Scheiterte der PDF-Abruf nur vorübergehend, wird das Ergebnis nach einem Tag neu berechnet. */
const VORBEHALT_MAX_MS = 24 * 60 * 60_000;

export interface KenndatenCacheZeile {
  norms_hash: string | null;
  items: KenndatenAuswertung | null;
  model: string | null;
  created_at: string | null;
}

export interface KenndatenSpeicher {
  lesen(): Promise<KenndatenCacheZeile | null>;
  sperren(token: string): Promise<boolean>;
  /** Gibt die Sperre frei, mit Ergebnis oder ohne. */
  abschliessen(token: string, ergebnis: { hash: string; auswertung: KenndatenAuswertung; model: string } | null): Promise<void>;
  kostenBuchen(costUsd: number, model: string): Promise<void>;
}

export interface KenndatenRechnung {
  auswertung: KenndatenAuswertung;
  model: string;
}

export interface LaufOptionen {
  speicher: KenndatenSpeicher;
  hash: string;
  token: string;
  /** `meldeKosten` ruft die Rechnung auf, sobald der Aufruf bezahlt ist. */
  rechnen: (meldeKosten: (costUsd: number, model: string) => void) => Promise<KenndatenRechnung>;
  warteMs: number;
  pollMs?: number;
  jetzt?: () => number;
  schlafen?: (ms: number) => Promise<void>;
}

export interface LaufErgebnis {
  auswertung: KenndatenAuswertung;
  model: string | null;
  cached: boolean;
}

export class KenndatenBesetzt extends Error {}

export function istTreffer(zeile: KenndatenCacheZeile | null, hash: string, jetzt: number): boolean {
  if (!zeile?.items || zeile.norms_hash !== hash) return false;
  if (!zeile.items.vorbehalt) return true;
  const alter = jetzt - Date.parse(zeile.created_at ?? "");
  return !(alter > VORBEHALT_MAX_MS);
}

export async function holeAuswertung(o: LaufOptionen): Promise<LaufErgebnis> {
  const jetzt = o.jetzt ?? Date.now;
  const schlafen = o.schlafen ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const bis = jetzt() + o.warteMs;

  for (;;) {
    const zeile = await o.speicher.lesen();
    if (istTreffer(zeile, o.hash, jetzt())) return { auswertung: zeile!.items!, model: zeile!.model, cached: true };

    if (await o.speicher.sperren(o.token)) {
      // Zwischen Lesen und Sperren kann ein anderer fertig geworden sein.
      const nochmal = await o.speicher.lesen();
      if (istTreffer(nochmal, o.hash, jetzt())) {
        await o.speicher.abschliessen(o.token, null);
        return { auswertung: nochmal!.items!, model: nochmal!.model, cached: true };
      }
      return rechneUnterSperre(o);
    }

    if (jetzt() >= bis) throw new KenndatenBesetzt("Das Kenndatenblatt wird gerade in einem anderen Fenster erstellt. Bitte gleich erneut versuchen.");
    await schlafen(o.pollMs ?? 2_500);
  }
}

async function rechneUnterSperre(o: LaufOptionen): Promise<LaufErgebnis> {
  const kosten: { costUsd: number; model: string }[] = [];
  let ergebnis: KenndatenRechnung | null = null;
  try {
    ergebnis = await o.rechnen((costUsd, model) => kosten.push({ costUsd, model }));
    return { auswertung: ergebnis.auswertung, model: ergebnis.model, cached: false };
  } finally {
    // Ein Fehler hier darf weder das fertige Blatt noch die ursprüngliche Fehlermeldung verdrängen.
    for (const k of kosten) {
      await o.speicher.kostenBuchen(k.costUsd, k.model).catch((e) => console.error("kenndaten: Kosten nicht gebucht", e));
    }
    const fertig = ergebnis ? { hash: o.hash, auswertung: ergebnis.auswertung, model: ergebnis.model } : null;
    await o.speicher.abschliessen(o.token, fertig).catch((e) => console.error("kenndaten: Cache nicht geschrieben", e));
  }
}
