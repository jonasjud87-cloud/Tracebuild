/**
 * Reine Logik der Geoportal-Oberfläche: Treffer-Zuordnung, Sync-Schleife, Statustexte.
 * Ohne React und ohne `@/`-Importe, damit sie mit node:test läuft.
 */
import type {
  DocumentSyncResponse,
  ExtractStatus,
  GeoSearchHit,
  OerebDocumentItem,
  ParcelCandidate,
} from "../lib/geoadmin/contract";

// ── Treffer und Parzelle ─────────────────────────────────────────────────────

export interface ParcelIdentityFields {
  egrid?: string;
  lv95_e?: number;
  lv95_n?: number;
  bfs_number?: number;
}

/** Was ein Treffer in das Formular schreibt. `null`: Feld bleibt, wie es ist. */
export interface ParcelFields {
  canton: string | null;
  municipality: string | null;
  parcelNumber: string | null;
  identity: ParcelIdentityFields;
}

/** Abfrage für GET /geo/parcel. Parzellentreffer mit EGRID und Koordinaten, das ist der schnelle Weg. */
export function parcelQueryFor(hit: Pick<GeoSearchHit, "egrid" | "e" | "n">): string {
  const params = new URLSearchParams();
  if (hit.egrid) params.set("egrid", hit.egrid);
  params.set("e", String(hit.e));
  params.set("n", String(hit.n));
  return params.toString();
}

/** Verbindliche Felder aus GET /geo/parcel. Koordinaten des Treffers nur, wenn dort welche fehlen. */
export function candidateToFields(
  candidate: ParcelCandidate,
  hit?: Pick<GeoSearchHit, "e" | "n"> | null,
): ParcelFields {
  const identity: ParcelIdentityFields = { egrid: candidate.egrid };
  const e = candidate.e ?? hit?.e ?? null;
  const n = candidate.n ?? hit?.n ?? null;
  if (e !== null && n !== null) {
    identity.lv95_e = e;
    identity.lv95_n = n;
  }
  if (candidate.bfs !== null) identity.bfs_number = candidate.bfs;
  return {
    canton: candidate.canton,
    municipality: candidate.municipality,
    parcelNumber: candidate.number,
    identity,
  };
}

/**
 * Rückfall, wenn GET /geo/parcel ausfällt: Ein Parzellentreffer kennt EGRID, Nummer und BFS.
 * `hit.municipality` ist nur eine Sprachform der Suche und wird bewusst nicht übernommen.
 */
export function parcelHitToFields(hit: GeoSearchHit): ParcelFields | null {
  if (hit.kind !== "parcel" || !hit.egrid) return null;
  const identity: ParcelIdentityFields = { egrid: hit.egrid, lv95_e: hit.e, lv95_n: hit.n };
  if (hit.bfs !== null) identity.bfs_number = hit.bfs;
  return { canton: hit.canton, municipality: null, parcelNumber: hit.number, identity };
}

/** Eigentliche Liegenschaften zuerst, Baurechte und Ähnliches danach. */
export function sortCandidates(candidates: ParcelCandidate[]): ParcelCandidate[] {
  const rank = (c: ParcelCandidate) => (c.type === "Liegenschaft" ? 0 : 1);
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

export function candidateLabel(c: ParcelCandidate): string {
  const place = [c.municipality, c.canton].filter(Boolean).join(" ");
  const parcel = c.number ? `Parzelle ${c.number}` : "Parzelle ohne Nummer";
  return place ? `${parcel}, ${place}` : parcel;
}

/** Tastaturbedienung der Trefferliste. -1 = keine Option aktiv. */
export function nextActiveIndex(active: number, count: number, key: string): number {
  if (count <= 0) return -1;
  switch (key) {
    case "ArrowDown": return active >= count - 1 ? 0 : active + 1;
    case "ArrowUp": return active <= 0 ? count - 1 : active - 1;
    case "Home": return 0;
    case "End": return count - 1;
    default: return active;
  }
}

// ── Sync-Schleife ────────────────────────────────────────────────────────────

export type SyncOutcome = NonNullable<DocumentSyncResponse["processed"]>["outcome"];
export type SyncEnd = "done" | "aborted" | "error" | "unavailable" | "busy" | "stalled";

export interface SyncProgress {
  processed: number;
  total: number;
  remaining: number;
  /** Ein anderer Request bearbeitet gerade ein Dokument dieses Projekts. */
  waiting: boolean;
  currentTitle: string | null;
  outcomes: Partial<Record<SyncOutcome, number>>;
}

export interface SyncRunResult {
  end: SyncEnd;
  progress: SyncProgress;
  error: string | null;
}

export interface SyncDeps {
  post: (signal: AbortSignal) => Promise<DocumentSyncResponse>;
  signal: AbortSignal;
  initialPending?: number;
  onProgress?: (progress: SyncProgress) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  inProgressWaitMs?: number;
  maxInProgressWaits?: number;
  /** Sicherung gegen eine Antwort, deren `remaining` nie sinkt. */
  maxRequests?: number;
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Seriell ein Dokument pro Request, bis nichts mehr offen ist. Wirft nie: Ein Fehler beendet
 * nur den Lauf, die offenen Dokumente kommen beim nächsten Öffnen wieder dran.
 */
export async function runDocumentSync(deps: SyncDeps): Promise<SyncRunResult> {
  const {
    post, signal, onProgress, initialPending = 0, sleep = abortableSleep,
    inProgressWaitMs = 5_000, maxInProgressWaits = 6, maxRequests = 200,
  } = deps;

  const progress: SyncProgress = {
    processed: 0, total: initialPending, remaining: initialPending,
    waiting: false, currentTitle: null, outcomes: {},
  };
  const finish = (end: SyncEnd, error: string | null = null): SyncRunResult => ({
    end, error, progress: { ...progress, outcomes: { ...progress.outcomes }, waiting: false },
  });
  const report = () => onProgress?.({ ...progress, outcomes: { ...progress.outcomes } });

  let waits = 0;
  for (let request = 0; request < maxRequests; request++) {
    if (signal.aborted) return finish("aborted");

    let res: DocumentSyncResponse;
    try {
      res = await post(signal);
    } catch (e) {
      if (signal.aborted) return finish("aborted");
      return finish("error", e instanceof Error ? e.message : "Unbekannter Fehler");
    }
    if (!res.available) return finish("unavailable");

    progress.remaining = Math.max(0, res.remaining);

    if (res.in_progress) {
      waits++;
      if (waits > maxInProgressWaits) return finish("busy");
      progress.waiting = true;
      progress.total = progress.processed + progress.remaining;
      report();
      await sleep(inProgressWaitMs, signal);
      continue;
    }
    waits = 0;
    progress.waiting = false;

    if (res.processed) {
      progress.processed++;
      progress.currentTitle = res.processed.title;
      const outcome = res.processed.outcome;
      progress.outcomes[outcome] = (progress.outcomes[outcome] ?? 0) + 1;
    }
    progress.total = progress.processed + progress.remaining;
    report();

    if (progress.remaining === 0) return finish("done");
    // Offen, aber nichts zu holen (etwa Wartezeit nach Fehler): nicht im Kreis fragen.
    if (!res.processed) return finish("stalled");
  }
  return finish("stalled");
}

// ── Dokumente ────────────────────────────────────────────────────────────────

/** Status `review`: nicht verworfen, ein Mensch soll den Erlass ansehen. */
export const REVIEW_LABEL = "zur Prüfung vorgemerkt";

const REJECT_REASON_LABELS: Record<string, string> = {
  manual_exclude: "von einem Admin ausgeschlossen",
  foreign_place: "Titel nennt einen anderen Ort, gilt vielleicht nur für einen Ortsteil",
  doc_type: "kein Reglement (Gesetz oder Hinweis)",
  authority: "Bundesrecht, bleibt als Link",
  title_exact: "Titel ausgeschlossen",
  title_negative: "Titel deutet auf Plan, Bericht oder Entscheid",
  not_in_force: "noch nicht rechtskräftig",
  host_not_allowed: "Quelle nicht freigegeben",
  private_address: "Quelle zeigt auf eine gesperrte Adresse",
  too_many_redirects: "Quelle leitet zu oft weiter",
  cap_reached: "Höchstzahl je Gemeinde erreicht",
  not_pdf: "kein PDF",
  too_large: "PDF zu gross",
  pdf_unreadable: "PDF nicht lesbar",
  scan_or_short: "Scan oder zu wenig Text",
  decision_document: "Entscheid oder Schreiben statt Reglement",
  duplicate_content: "gleicher Text wie ein anderes Dokument",
  kept_old: "neue Fassung abgelehnt, bisheriger Stand bleibt",
  no_articles: "keine Artikel erkannt",
  too_long: "Text zu lang",
  superseded: "durch eine neue Fassung ersetzt",
  older_version: "ältere Fassung, eine neuere steht im selben Auszug",
};

export function rejectReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "ohne Angabe";
  // Neue Gründe kommen als Daten vom Server: nie den Rohwert zeigen.
  return REJECT_REASON_LABELS[reason] ?? "anderer Filtergrund";
}

export interface DocumentSummary {
  imported: number;
  filtered: number;
  scans: number;
  failed: number;
  pending: number;
  duplicates: number;
  removed: number;
  /** Nicht herausgefiltert: Ein Mensch soll sie ansehen. */
  review: number;
  /** Herausgefilterte ohne Scans, je Grund. */
  filterReasons: { label: string; count: number }[];
}

export function summarizeDocuments(items: Pick<OerebDocumentItem, "status" | "reject_reason">[]): DocumentSummary {
  const out: DocumentSummary = {
    imported: 0, filtered: 0, scans: 0, failed: 0, pending: 0, duplicates: 0, removed: 0, review: 0, filterReasons: [],
  };
  const reasons = new Map<string, number>();
  for (const item of items) {
    switch (item.status) {
      case "imported": out.imported++; break;
      case "failed": out.failed++; break;
      case "pending": out.pending++; break;
      case "duplicate_manual": out.duplicates++; break;
      case "removed": out.removed++; break;
      case "review": out.review++; break;
      case "rejected":
        if (item.reject_reason === "scan_or_short") {
          out.scans++;
        } else {
          out.filtered++;
          const label = rejectReasonLabel(item.reject_reason);
          reasons.set(label, (reasons.get(label) ?? 0) + 1);
        }
        break;
    }
  }
  out.filterReasons = Array.from(reasons, ([label, count]) => ({ label, count }));
  return out;
}

/** Eine Zeile für die Statusleiste. Nur, was tatsächlich vorkommt. */
export function documentSummaryLine(s: DocumentSummary): string {
  const parts: string[] = [];
  if (s.imported) parts.push(`${s.imported} importiert`);
  if (s.duplicates) parts.push(`${s.duplicates} bereits von Hand erfasst`);
  if (s.filtered) {
    const reasons = s.filterReasons.map((r) => `${r.count} × ${r.label}`).join(", ");
    parts.push(`${s.filtered} herausgefiltert (${reasons})`);
  }
  if (s.review) parts.push(`${s.review} ${REVIEW_LABEL}`);
  if (s.scans) parts.push(`${s.scans} Scan${s.scans === 1 ? "" : "s"} ohne lesbaren Text`);
  if (s.failed) parts.push(`${s.failed} mit Fehler`);
  if (s.pending) parts.push(`${s.pending} noch offen`);
  return parts.join(" · ");
}

/** Externe Links nur über http und https: Die Adressen stammen aus fremden Daten. */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface DocumentNotices<T> {
  /** Ohne Norm und ohne Text: Das Reglement ist in keiner Analyse enthalten. */
  scans: T[];
  /** Status `review`: Ein Mensch soll den Erlass ansehen. */
  review: T[];
  rejected: { reason: string; label: string; items: T[] }[];
  bothKept: T[];
}

type NoticeItem = Pick<OerebDocumentItem, "status" | "reject_reason" | "norm_id" | "version_note">;

/** Scan-Hinweis nur, solange kein Text vorliegt: Mit Texterkennung wechselt das Dokument den Status. */
export function documentNotices<T extends NoticeItem>(items: T[]): DocumentNotices<T> {
  const out: DocumentNotices<T> = { scans: [], review: [], rejected: [], bothKept: [] };
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (item.version_note) out.bothKept.push(item);
    if (item.status === "review") out.review.push(item);
    if (item.status !== "rejected") continue;
    if (item.reject_reason === "scan_or_short") {
      if (!item.norm_id) out.scans.push(item);
      continue;
    }
    const key = item.reject_reason ?? "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  out.rejected = Array.from(groups, ([reason, group]) => ({ reason, label: rejectReasonLabel(reason || null), items: group }));
  return out;
}

// ── Eigene Uploads gegenüber dem amtlichen Text ──────────────────────────────

/** Antworten von PUT /standards/{id}/authoritative als Text für die Nutzer. */
export function authoritativeErrorText(status: number | undefined): string {
  switch (status) {
    case 400: return "Die Anfrage war ungültig. Bitte die Seite neu laden und erneut versuchen.";
    case 401: return "Sie sind nicht mehr angemeldet. Bitte erneut anmelden.";
    case 404: return "Diese Norm gibt es nicht mehr, oder sie gehört nicht zu Ihrer Organisation.";
    case 409: return "Massgebend festlegen geht nur bei eigenen Gemeinde-Normen.";
    default: return "Die Festlegung konnte nicht gespeichert werden. Bitte später erneut versuchen.";
  }
}

/** Anteil des Uploads im amtlichen Text als ganze Prozent. Ausserhalb von 0 bis 1 keine Angabe. */
export function similarityPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return Math.round(value * 100);
}

// ── Status des ÖREB-Auszugs ──────────────────────────────────────────────────

export type NoticeTone = "error" | "warn" | "info";

export interface ExtractStatusInfo {
  title: string;
  text: string;
  tone: NoticeTone;
  /** Grundstück muss über die Einstellungen gewählt werden. */
  choose: boolean;
  /** Der amtliche PDF-Auszug hilft weiter, falls ein Link vorhanden ist. */
  offerPdf: boolean;
  /** Meldung des Dienstes zusätzlich anzeigen. */
  showDetail: boolean;
}

export function extractStatusInfo(status: ExtractStatus, canton: string | null | undefined): ExtractStatusInfo {
  const code = (canton ?? "").trim().toUpperCase();
  switch (status) {
    case "ok":
      return {
        title: "ÖREB-Auszug vorhanden",
        text: "Der Auszug des kantonalen Katasters liegt vor.",
        tone: "info", choose: false, offerPdf: true, showDetail: false,
      };
    case "no_egrid":
      return {
        title: "Grundstück nicht gefunden",
        text: "Zu Gemeinde und Parzellennummer gibt es keinen Treffer. Bitte die Angaben prüfen oder die Parzelle über die Suche wählen.",
        tone: "warn", choose: true, offerPdf: false, showDetail: false,
      };
    case "ambiguous":
      return {
        title: "Mehrere Grundstücke passen",
        text: "Die Nummer ist in dieser Gemeinde nicht eindeutig. TraceBuild wählt nicht selbst. Bitte das richtige Grundstück wählen.",
        tone: "warn", choose: true, offerPdf: false, showDetail: false,
      };
    case "unreachable":
      return code === "BS"
        ? {
            title: "ÖREB-Dienst Basel-Stadt antwortet instabil",
            text: "Der Dienst liefert zurzeit wechselnde Antworten. Bitte in einigen Minuten neu laden. Die Bauzone können Sie bis dahin von Hand eintragen.",
            tone: "warn", choose: false, offerPdf: true, showDetail: false,
          }
        : {
            title: "ÖREB-Dienst nicht erreichbar",
            text: "Der kantonale Dienst antwortet zurzeit nicht. Bitte später neu laden. Die Bauzone können Sie bis dahin von Hand eintragen.",
            tone: "warn", choose: false, offerPdf: true, showDetail: true,
          };
    case "parse_error":
      return {
        title: "Antwort des ÖREB-Dienstes nicht lesbar",
        text: "Der kantonale Dienst hat etwas geliefert, das TraceBuild nicht auswerten kann. Bitte später neu laden oder den amtlichen PDF-Auszug verwenden. Die Bauzone können Sie von Hand eintragen.",
        tone: "error", choose: false, offerPdf: true, showDetail: true,
      };
    case "no_cadastre":
      return {
        title: "Kein ÖREB-Dienst gefunden",
        text: "Für diesen Standort ist kein ÖREB-Kataster auffindbar. Bitte die Bauzone von Hand eintragen und den Standort prüfen.",
        tone: "warn", choose: false, offerPdf: false, showDetail: false,
      };
    case "access_restricted":
      return {
        title: code === "NE" ? "Neuenburg vorerst nicht automatisch angebunden" : "ÖREB-Daten nur mit Zugang",
        text: "Der Kanton gibt die Daten nur an registrierte Nutzer ab. Massgebend ist der amtliche PDF-Auszug. Bitte die Bauzone von Hand eintragen.",
        tone: "warn", choose: false, offerPdf: true, showDetail: false,
      };
  }
}

/** Der Server ruft bei `force` höchstens alle 30 s ab und antwortet dann 200 mit `fetched: false`. */
const FORCE_MIN_AGE_MS = 30_000;

export interface OerebReloadResponse {
  fetched?: boolean;
  used_stale?: boolean;
  stale_fetched_at?: string | null;
  extract?: {
    status?: ExtractStatus | null;
    status_detail?: string | null;
    fetched_at?: string | null;
    last_attempt_at?: string | null;
    last_error?: string | null;
  } | null;
}

/**
 * Meldung nach einem Abruf mit `force`. `fetched: false` hat mehrere Ursachen: Mindestabstand,
 * fehlendes Grundstück oder ein abgefangener Fehler. Der Zeitstempel des Auszugs trennt sie.
 * null: Abruf ist erfolgt; das Ergebnis steht im Status des Auszugs.
 */
export function oerebReloadNote(res: OerebReloadResponse, hasParcel: boolean, now = Date.now()): string | null {
  const staleDate = formatDate(res.stale_fetched_at);
  const staleText = `es gilt weiter der Stand${staleDate ? ` vom ${staleDate}` : ""}.`;
  if (res.fetched === false) {
    if (!hasParcel) return "Kein Abruf möglich: Dem Projekt fehlt eine Parzelle. Bitte in den Einstellungen wählen.";
    const last = Date.parse(res.extract?.last_attempt_at ?? res.extract?.fetched_at ?? "");
    if (Number.isFinite(last) && now - last < FORCE_MIN_AGE_MS) {
      const suffix = res.used_stale ? ` Dieser Abruf schlug fehl, ${staleText}` : " Angezeigt wird dessen Ergebnis.";
      return `Der letzte Abruf war vor weniger als 30 Sekunden.${suffix} Bitte danach erneut versuchen.`;
    }
    const detail = res.extract?.last_error ?? res.extract?.status_detail;
    return `Der ÖREB-Auszug konnte nicht abgerufen werden${detail ? `: ${detail}` : "."} Bitte später erneut versuchen.`;
  }
  if (res.used_stale) return `Aktualisierung fehlgeschlagen, ${staleText}`;
  return null;
}

// ── Bauzone ──────────────────────────────────────────────────────────────────

export interface ZoneRef {
  bauzone: string | null;
  zone_source?: "oereb" | "manual" | null;
  zone_confidence?: "exact" | "coarse" | "low" | null;
}

/** Keine sichere Zone: Es fehlt eine, oder sie stammt mit `low` aus dem ÖREB. Manuell gilt als sicher. */
export function zoneNeedsAttention(p: ZoneRef | null): boolean {
  if (!p) return false;
  if (!p.bauzone) return true;
  return p.zone_source !== "manual" && p.zone_confidence === "low";
}

export function zoneOriginLabel(p: ZoneRef | null): string | null {
  if (!p?.bauzone) return null;
  if (p.zone_source === "manual") return "manuell gesetzt";
  if (p.zone_confidence === "low") return "unsicher, bitte prüfen";
  if (p.zone_source === "oereb") return p.zone_confidence === "coarse" ? "Grobklasse aus ÖREB-Auszug" : "aus ÖREB-Auszug";
  return null;
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
