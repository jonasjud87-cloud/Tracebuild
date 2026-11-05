/**
 * Alte und neue Fassung innerhalb EINES Auszugs. Rein: Die Aktionen setzt `version-sync.ts` um.
 *
 * Das Ergebnis hängt nur von den gespeicherten Messwerten ab, nie von der Reihenfolge der Importe.
 * Abgelehnte Dokumente behalten deshalb ihre Messwerte und nehmen weiter am Vergleich teil.
 * Der Vergleich geht nie über den Auszug hinaus: Nach einer Fusion stehen gleichnamige Reglemente
 * der Ortsteile in verschiedenen Auszügen und dürfen sich nicht gegenseitig verdrängen.
 */
import { isGone } from "./document-decisions";
import {
  OLDER_VERSION_REASON,
  assessContent,
  isAmendmentTitle,
  isAnnexTitle,
  type ImportFilterRules,
} from "./import-filter";
import { extractStandDate, sketchContainment, textSketch, type TextSketch } from "./text-measure";

export interface DocumentMeasures {
  article_run: number;
  article_first: number | null;
  article_hits: number;
  stand_date: string | null;
  text_sketch: TextSketch;
  content_reason: string | null;
}

/** Spalten aus 20261107000001. Fehlen sie noch, speichert der Import ohne sie. */
export const VERSION_COLUMNS = [
  "official_number", "article_run", "article_first", "article_hits", "stand_date", "text_sketch", "content_reason",
  "version_winner_id", "version_note",
] as const;

export function measureDocument(title: string, text: string, rules: ImportFilterRules): DocumentMeasures {
  const { rejection, sequence } = assessContent(text, rules, title);
  return {
    article_run: sequence.run,
    article_first: sequence.first,
    article_hits: sequence.hits,
    stand_date: extractStandDate(title, text, rules.version_date_markers),
    text_sketch: textSketch(text),
    content_reason: rejection?.reason ?? null,
  };
}

/** Leere und offensichtliche Platzhalter verbinden nichts. */
export function normalizeOfficialNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/\s+/g, " ").trim().toUpperCase();
  return value.length >= 2 && /[0-9]/.test(value) && !/^0+$/.test(value) ? value : null;
}

export interface VersionDocument {
  id: string;
  status: string;
  title: string;
  title_key: string;
  url_normalized: string;
  norm_id: string | null;
  reject_reason: string | null;
  official_number?: string | null;
  article_run?: number | null;
  article_hits?: number | null;
  stand_date?: string | null;
  text_sketch?: TextSketch | null;
  content_reason?: string | null;
  version_winner_id?: string | null;
  version_note?: string | null;
  last_seen_at?: string | null;
  last_update_status?: string | null;
  attempts?: number | null;
  scope?: string | null;
}

export type VersionAction =
  /** Importiert, aber eine bessere Fassung steht im selben Auszug: Norm zurücknehmen. */
  | { action: "retire"; docId: string; winnerId: string; detail: string }
  /** Schon abgelehnt: Grund und Gewinner nachführen. */
  | { action: "relabel"; docId: string; winnerId: string; detail: string }
  /** War `older_version`, ist es nicht mehr. */
  | { action: "restore"; docId: string }
  /** Hinweis setzen oder löschen. */
  | { action: "note"; docId: string; note: string | null };

const isOlder = (d: VersionDocument) => d.status === "rejected" && d.reject_reason === OLDER_VERSION_REASON;
const isMeasured = (d: VersionDocument) => typeof d.article_run === "number" && !!d.text_sketch;

/** Besteht den Inhaltstest und könnte gewinnen. */
const isContender = (d: VersionDocument) => isMeasured(d) && !d.content_reason && (d.status === "imported" || isOlder(d));

/**
 * Hat die Artikelprüfung nicht bestanden, ist aber erkennbar ein Stück Erlass (Quarten 10156:
 * Art. 42 und Genehmigungsunterlagen). Briefe und Scans behalten ihren eigenen Grund.
 */
const isFragment = (d: VersionDocument) =>
  isMeasured(d) && d.content_reason === "no_articles" && (d.article_hits ?? 0) > 0 && d.status === "rejected";

function groupByIdentity(docs: VersionDocument[]): VersionDocument[][] {
  const parent = new Map(docs.map((d) => [d.id, d.id]));
  const find = (id: string): string => {
    const p = parent.get(id) as string;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const owners = new Map<string, string>();
  for (const d of docs) {
    const keys = [`t:${d.title_key}`];
    if (d.official_number) keys.push(`n:${d.official_number}`);
    for (const key of keys) {
      const owner = owners.get(key);
      if (owner) parent.set(find(d.id), find(owner));
      else owners.set(key, d.id);
    }
  }
  const groups = new Map<string, VersionDocument[]>();
  for (const d of docs) {
    const root = find(d.id);
    groups.set(root, [...(groups.get(root) ?? []), d]);
  }
  return Array.from(groups.values());
}

/** Meiste fortlaufende Artikel; bei fast gleich langer Folge der jüngste Stand. URL als letzte, feste Reihenfolge. */
export function pickWinner<T extends VersionDocument>(docs: T[], rules: ImportFilterRules): T {
  const longest = Math.max(...docs.map((d) => d.article_run ?? 0));
  const tied = docs.filter((d) => (d.article_run ?? 0) >= longest * rules.version_run_tie_ratio);
  return tied.slice().sort((a, b) =>
    (b.stand_date ?? "").localeCompare(a.stand_date ?? "") ||
    (b.article_run ?? 0) - (a.article_run ?? 0) ||
    (b.text_sketch?.n ?? 0) - (a.text_sketch?.n ?? 0) ||
    a.url_normalized.localeCompare(b.url_normalized)
  )[0];
}

/**
 * `own` sind die Dokumente eines Auszugs, `all` die der ganzen Gemeinde. Eine ältere Fassung, deren
 * Gewinner nur in einem anderen Auszug steht, bleibt abgelehnt, solange er gilt: Sonst würden sich
 * zwei Projekte derselben Gemeinde die Fassung gegenseitig hin- und herschalten.
 */
export function planVersionActions(
  own: VersionDocument[],
  all: VersionDocument[],
  rules: ImportFilterRules,
  nowMs: number
): VersionAction[] {
  const actions: VersionAction[] = [];
  const graceMs = rules.supersede_after_days * 86_400_000;
  const ownIds = new Set(own.map((d) => d.id));
  const winnerElsewhereStands = (d: VersionDocument) => {
    if (!isOlder(d) || !d.version_winner_id || ownIds.has(d.version_winner_id)) return false;
    const winner = all.find((x) => x.id === d.version_winner_id);
    return !!winner && winner.status === "imported" && !!winner.norm_id && !isGone(winner as never, nowMs, graceMs);
  };

  const inPlay = own.filter(
    (d) =>
      !winnerElsewhereStands(d) &&
      !isAmendmentTitle(d.title, rules) &&
      !isAnnexTitle(d.title, rules) &&
      (isContender(d) || isFragment(d) || isOlder(d))
  );

  for (const group of groupByIdentity(inPlay)) {
    const contenders = group.filter(isContender);
    const notes = new Map<string, string>();
    const winner = contenders.length ? pickWinner(contenders, rules) : null;

    for (const d of group) {
      let loses = false;
      if (winner && d.id !== winner.id) {
        const newer = !!d.stand_date && (!winner.stand_date || d.stand_date > winner.stand_date);
        if (isContender(d)) {
          loses = !newer && sketchContainment(d.text_sketch, winner.text_sketch) >= rules.version_min_overlap;
          if (!loses) {
            // Im Zweifel beide: eigener Inhalt, oder neuer Stand bei kürzerer Folge.
            notes.set(d.id, `Mögliche weitere Fassung von «${winner.title}», beide übernommen`);
            notes.set(winner.id, `Mögliche weitere Fassung von «${d.title}», beide übernommen`);
          }
        } else if (isFragment(d)) {
          // Nur bei gleichem Titel: Unter einer Nummer stehen auch Beilagen (AI: Liste Kulturobjekte).
          loses = !newer && d.title_key === winner.title_key;
        }
      }
      if (loses && winner) {
        // Der Gewinner hat noch keine Norm: Die geltende Fassung bleibt, bis er importiert ist.
        if (d.status === "imported" && isOlder(winner) && !winner.norm_id) continue;
        const stand = winner.stand_date ? `, Stand ${winner.stand_date}` : "";
        const detail = `Ältere Fassung von «${winner.title}» (${winner.article_run} fortlaufende Artikel${stand})`;
        if (d.status === "imported") actions.push({ action: "retire", docId: d.id, winnerId: winner.id, detail });
        else if (!isOlder(d) || d.version_winner_id !== winner.id) actions.push({ action: "relabel", docId: d.id, winnerId: winner.id, detail });
      } else if (isOlder(d)) {
        actions.push({ action: "restore", docId: d.id });
      }
    }

    for (const d of group) {
      const note = notes.get(d.id) ?? null;
      if ((d.version_note ?? null) !== note) actions.push({ action: "note", docId: d.id, note });
    }
  }
  return actions;
}
