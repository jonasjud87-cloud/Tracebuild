/**
 * Reine Entscheide des Imports: Identität eines Dokuments und Umgang mit einem neuen Text.
 * Keine Datenbank, keine Netzwerkzugriffe.
 */
import { decideContent, type ImportFilterRules } from "./import-filter";

export interface IdentityDocument {
  id: string;
  status: string;
  norm_id: string | null;
  url_normalized: string;
  title_key: string;
  scope: string | null;
  text_sha256?: string | null;
  last_seen_at?: string | null;
  last_update_status?: string | null;
  attempts?: number | null;
}

export interface ManualNormRef {
  id: string;
  title_key: string;
  text_sha256: string | null;
}

/** Gemeindeweit lange nicht mehr gesehen oder wiederholt nicht abrufbar. */
export function isGone(s: IdentityDocument, nowMs: number, graceMs: number): boolean {
  if (s.last_update_status === "fetch_failed" && (s.attempts ?? 0) >= 3) return true;
  const seen = s.last_seen_at ? Date.parse(s.last_seen_at) : NaN;
  return Number.isFinite(seen) && nowMs - seen > graceMs;
}

export type IdentityDecision =
  | { action: "removed"; detail: string }
  | { action: "duplicate_manual"; normId: string; detail: string }
  | { action: "new_version"; normId: string; supersededDocId: string }
  | { action: "duplicate_content"; normId: string; detail: string }
  | { action: "update"; normId: string }
  | { action: "insert" };

/**
 * Reihenfolge wie Spezifikation 5.5. `textSha` fehlt vor dem Download: Dann entscheidet nur der
 * Titel, sodass ein bekanntes Duplikat gar nicht erst geladen wird.
 *
 * - Admin hat die Norm gelöscht: nie neu anlegen. Bei `municipal` gilt das auch für eine andere
 *   URL desselben Titels, sonst käme die gelöschte Norm über eine neue oereblex-ID zurück. Der
 *   Geschwister-Eintrag kann noch `imported` mit norm_id null sein (nie erneut geprüft).
 * - Neue Version nur bei `municipal`: Bei objektbezogenen Vorschriften belegt ein gleicher Titel
 *   («Plan», «Reglement») keine Nachfolge, sondern meist ein anderes Grundstück.
 * - Dass die alte URL im Auszug dieses Projekts fehlt, genügt nicht: Nach einer Gemeindefusion
 *   gelten mehrere Reglemente gleichen Titels je Ortsteil. Abgelöst wird erst, wenn die alte URL
 *   gemeindeweit lange in keinem Auszug mehr stand oder dauerhaft nicht mehr abrufbar ist.
 */
export function decideIdentity(input: {
  doc: IdentityDocument;
  siblings: IdentityDocument[];
  manualNorms: ManualNormRef[];
  currentUrls: Set<string>;
  textSha?: string | null;
  nowMs?: number;
  /** Frist, nach der eine URL ohne Sichtung als abgelöst gilt. */
  supersedeAfterDays?: number;
}): IdentityDecision {
  const { doc, siblings, manualNorms, currentUrls, textSha } = input;
  const nowMs = input.nowMs ?? Date.now();
  const graceMs = (input.supersedeAfterDays ?? 30) * 86_400_000;

  if (doc.status === "imported" && !doc.norm_id) {
    return { action: "removed", detail: "Norm wurde gelöscht und wird nicht neu angelegt" };
  }
  if (doc.norm_id) return { action: "update", normId: doc.norm_id };

  const others = siblings.filter((s) => s.id !== doc.id);
  const deleted = (s: IdentityDocument) => s.status === "removed" || (s.status === "imported" && !s.norm_id);
  if (doc.scope === "municipal" && others.some((s) => deleted(s) && s.scope === "municipal" && s.title_key === doc.title_key)) {
    return { action: "removed", detail: "Norm gleichen Titels wurde gelöscht und wird nicht neu angelegt" };
  }

  const manual = manualNorms.find(
    (m) => m.title_key === doc.title_key || (!!textSha && !!m.text_sha256 && m.text_sha256 === textSha)
  );
  if (manual) {
    return { action: "duplicate_manual", normId: manual.id, detail: `Manuell gepflegte Norm ${manual.id} bleibt massgebend` };
  }

  if (doc.scope === "municipal") {
    const predecessor = others.find(
      (s) =>
        s.status === "imported" &&
        !!s.norm_id &&
        s.scope === "municipal" &&
        s.title_key === doc.title_key &&
        !currentUrls.has(s.url_normalized) &&
        isGone(s, nowMs, graceMs)
    );
    if (predecessor?.norm_id) {
      return { action: "new_version", normId: predecessor.norm_id, supersededDocId: predecessor.id };
    }
  }

  // Derselbe Text unter anderer URL (VS Sion: zwei Titel, ein PDF) ergäbe eine zweite Prüfung zum
  // gleichen Inhalt. Nur gegen `municipal`: Die gilt ohnehin für alle Grundstücke der Gemeinde.
  if (textSha) {
    const same = others.find(
      (s) => s.status === "imported" && !!s.norm_id && s.scope === "municipal" && s.text_sha256 === textSha
    );
    if (same?.norm_id) {
      return { action: "duplicate_content", normId: same.norm_id, detail: `Gleicher Text wie Dokument ${same.id}` };
    }
  }
  return { action: "insert" };
}

/**
 * Alte Fassungen, die eine bereits importierte neue Fassung ablöst. Sonst würde dauerhaft auch gegen
 * aufgehobenes Recht geprüft. Der Fusionsfall bleibt geschützt: Eine URL gilt erst als weg, wenn sie
 * in keinem frischen Abruf mehr vorkam oder wiederholt nicht abrufbar war.
 */
export function findSuperseded(
  all: IdentityDocument[],
  currentUrls: Set<string>,
  nowMs: number,
  supersedeAfterDays: number
): { oldDocId: string; oldNormId: string; newDocId: string }[] {
  const graceMs = supersedeAfterDays * 86_400_000;
  const live = all.filter((d) => d.status === "imported" && !!d.norm_id && d.scope === "municipal");
  const out: { oldDocId: string; oldNormId: string; newDocId: string }[] = [];
  for (const old of live) {
    if (currentUrls.has(old.url_normalized) || !isGone(old, nowMs, graceMs)) continue;
    const successor = live.find(
      (d) => d.id !== old.id && d.title_key === old.title_key && d.norm_id !== old.norm_id && currentUrls.has(d.url_normalized)
    );
    if (successor) out.push({ oldDocId: old.id, oldNormId: old.norm_id as string, newDocId: successor.id });
  }
  return out;
}

export type UpdateDecision =
  | { action: "unchanged" }
  | { action: "update" }
  | { action: "kept_old"; detail: string };

/**
 * Schutz vor Leeren: Ein neuer Text ersetzt den alten nur, wenn er lang genug ist, nicht massiv
 * schrumpft und den Inhaltsfilter besteht. Sonst bleibt der alte Stand.
 */
export function decideUpdate(input: {
  oldTextSha: string | null;
  oldChars: number;
  newTextSha: string;
  newText: string;
  rules: ImportFilterRules;
  /** Änderungserlasse haben eine tiefere Artikelgrenze. */
  title?: string;
}): UpdateDecision {
  const { oldTextSha, oldChars, newTextSha, newText, rules, title } = input;
  if (oldTextSha && oldTextSha === newTextSha) return { action: "unchanged" };
  const chars = newText.trim().length;
  if (chars < rules.min_text_chars) {
    return { action: "kept_old", detail: `Neuer Text hat nur ${chars} Zeichen (Minimum ${rules.min_text_chars})` };
  }
  if (chars < rules.shrink_min_ratio * oldChars) {
    return { action: "kept_old", detail: `Neuer Text schrumpft von ${oldChars} auf ${chars} Zeichen` };
  }
  const rejected = decideContent(newText, rules, title);
  if (rejected) return { action: "kept_old", detail: `${rejected.reason}: ${rejected.detail}` };
  return { action: "update" };
}

/** Nächste Prüfung nach einem Fehler: 2^Versuche Stunden, höchstens 24 h. */
export function backoffUntil(attempts: number, nowMs: number): string {
  const hours = Math.min(24, 2 ** Math.max(0, attempts));
  return new Date(nowMs + hours * 3_600_000).toISOString();
}

export function nextRecheck(rules: ImportFilterRules, nowMs: number): string {
  return new Date(nowMs + rules.recheck_hours * 3_600_000).toISOString();
}
