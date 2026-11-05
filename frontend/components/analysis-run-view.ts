/**
 * Reine Logik zur laufenden Analyse in der Oberfläche: aktiver Lauf, Fortschritt, Polling,
 * Wiederaufnahme, Texte. Ohne React und ohne `@/`-Importe, damit sie mit node:test läuft.
 * Für den Nutzer gibt es nur eine durchgehende Analyse: Die Texte hier nennen nie Teilschritte
 * der Serverkette.
 */
import type {
  AnalysisPreflight,
  AnalysisRunProgress,
  AnalysisStatusResponse,
  PreflightDocuments,
  PreflightOereb,
} from "../lib/analysis-stages/contract";
import { formatDate, type SyncEnd } from "./geoportal-logic";

// ── Aktiver Lauf und Reihenfolge ─────────────────────────────────────────────

/** Neueste laufende Analyse. Der Zustand kommt aus der Liste, überlebt also Reload und zweiten Tab. */
export function findActiveRun<T extends { status: string; created_at: string }>(analyses: T[]): T | null {
  let active: T | null = null;
  for (const a of analyses) {
    if (a.status !== "running") continue;
    if (!active || Date.parse(a.created_at) > Date.parse(active.created_at)) active = a;
  }
  return active;
}

const SEVERITY: Record<string, number> = { fail: 0, warn: 1, ok: 2 };

/** Wie die Server-Sortierung: Norm-Reihenfolge des Laufs, dann Verstoss, Unklar, Konform. */
export function sortAnalysisItems<T extends { norm_id?: string | null; status: string }>(
  items: T[],
  normVersions: { norm_id: string }[] | null | undefined,
): T[] {
  const order = new Map((normVersions ?? []).map((n, i) => [n.norm_id, i]));
  return items.slice().sort((a, b) => {
    const byNorm = (order.get(a.norm_id ?? "") ?? 999) - (order.get(b.norm_id ?? "") ?? 999);
    if (byNorm !== 0) return byNorm;
    return (SEVERITY[a.status] ?? 9) - (SEVERITY[b.status] ?? 9);
  });
}

/**
 * Welche Version nach dem Ende eines Laufs offen ist. `typeList`: Versionen der geöffneten Prüfung,
 * neueste zuerst. Fertig oder fehlgeschlagen: diese Version zeigen, auch ein Fehler soll sichtbar sein.
 * Abgebrochen oder gelöscht: Sie steht nicht mehr in der Liste, also zurück zum letzten Ergebnis.
 */
export function selectionAfterRun<T extends { id: string; status: string }>(
  typeList: T[],
  runId: string,
  current: T | null,
): T | null {
  const ended = typeList.find((a) => a.id === runId);
  if (ended && ended.status !== "running") return ended;
  if (current?.id === runId && !ended) return typeList.find((a) => a.status === "done") ?? null;
  return current;
}

// ── Polling ──────────────────────────────────────────────────────────────────

export const POLL_VISIBLE_MS = 5_000;
/**
 * Verdeckter Tab: langsamer statt gar nicht, damit der Browser als Rückfall wirksam bleibt,
 * wenn die Serverkette stockt.
 */
export const POLL_HIDDEN_MS = 30_000;
export const POLL_INTERRUPTED_MS = 60_000;
export const RESUME_MIN_INTERVAL_MS = 30_000;
export const CONNECTION_LOST_AFTER_FAILURES = 5;
/** Altlauf ohne Fortschrittsdaten: Die alte Anfrage endet spätestens nach 300 s. Wie der Admin. */
export const INTERRUPTED_AFTER_MS = 6 * 60_000;

export type StatusPoll =
  | { kind: "status"; status: AnalysisStatusResponse }
  /** Analyse existiert nicht mehr (gelöscht). */
  | { kind: "gone" }
  /** Netz, Serverfehler oder HTML statt JSON (z. B. abgelaufene Sitzung). Sagt nichts über die Analyse. */
  | { kind: "failed" };

export function interpretStatusResponse(httpStatus: number, body: string, expectedId: string): StatusPoll {
  if (httpStatus === 404) return { kind: "gone" };
  if (httpStatus < 200 || httpStatus >= 300) return { kind: "failed" };
  try {
    const data = (JSON.parse(body) as { data?: Partial<AnalysisStatusResponse> | null }).data;
    if (data?.id !== expectedId || typeof data.status !== "string") return { kind: "failed" };
    return {
      kind: "status",
      status: {
        id: data.id,
        status: data.status,
        progress: data.progress ?? null,
        error_message: data.error_message ?? null,
      },
    };
  } catch {
    return { kind: "failed" };
  }
}

export interface RunPollState {
  /** Letzter bekannter Fortschritt. Bleibt stehen, wenn der Job beim Abschluss verschwindet. */
  progress: AnalysisRunProgress | null;
  /** Nur steigend; null = noch unbekannt. */
  percent: number | null;
  /** Fehlversuche in Folge. */
  failures: number;
  /** Der Server hat mindestens einmal geantwortet. */
  statusKnown: boolean;
  /** Der Server meldet ein Ende oder die Analyse fehlt: Liste neu laden. */
  ended: boolean;
  /** Wiederaufnahmen in Folge, die nichts bewirkt haben. */
  resumeFailures: number;
}

export const INITIAL_RUN_POLL: RunPollState = {
  progress: null,
  percent: null,
  failures: 0,
  statusKnown: false,
  ended: false,
  resumeFailures: 0,
};

/** Bei 30 s Abstand rund 90 Sekunden ohne Erfolg. */
export const RESUME_STUCK_AFTER_FAILURES = 3;

/** Der Balken läuft nie rückwärts, auch wenn ein Teil neu geprüft werden muss. */
export function nextPercent(previous: number | null, reported: number): number {
  const clamped = Number.isFinite(reported) ? Math.min(100, Math.max(0, reported)) : 0;
  return Math.max(previous ?? 0, clamped);
}

export function applyPoll(state: RunPollState, poll: StatusPoll): RunPollState {
  if (poll.kind === "failed") return { ...state, failures: state.failures + 1 };
  if (poll.kind === "gone") return { ...state, failures: 0, ended: true };
  const { status, progress } = poll.status;
  if (status !== "running") return { ...state, failures: 0, statusKnown: true, ended: true };
  return {
    progress: progress ?? state.progress,
    percent: progress ? nextPercent(state.percent, progress.percent) : state.percent,
    failures: 0,
    statusKnown: true,
    ended: false,
    // Wartet der Server nicht mehr, hat die Kette wieder gegriffen.
    resumeFailures: progress?.needs_resume ? state.resumeFailures : 0,
  };
}

/** Ergebnis einer Wiederaufnahme: Fehler oder «nichts übernommen», obwohl der Server wartet. */
export function applyResumeResult(state: RunPollState, resumed: boolean): RunPollState {
  return { ...state, resumeFailures: resumed ? 0 : state.resumeFailures + 1 };
}

/** Browser als Rückfall: nur wenn der Server wartet, höchstens alle 30 s. */
export function shouldResume(
  progress: AnalysisRunProgress | null | undefined,
  lastResumeAt: number | null,
  now: number,
): boolean {
  if (!progress?.needs_resume) return false;
  return lastResumeAt === null || now - lastResumeAt >= RESUME_MIN_INTERVAL_MS;
}

/**
 * Altlauf: `running`, aber nie Fortschrittsdaten, und älter als die alte Anfrage leben kann.
 * Er rechnet nicht mehr und darf neue Analysen nicht dauerhaft sperren.
 */
export function isInterruptedRun(state: RunPollState, createdAt: string | null, now: number): boolean {
  if (!state.statusKnown || state.progress || state.ended || !createdAt) return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created > INTERRUPTED_AFTER_MS;
}

export function pollDelayMs(hidden: boolean, interrupted: boolean): number {
  if (interrupted) return POLL_INTERRUPTED_MS;
  return hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
}

// ── Texte zum Fortschritt ────────────────────────────────────────────────────

export function progressLabel(progress: AnalysisRunProgress | null): string {
  switch (progress?.phase) {
    case "preparing":
      return "Analyse wird vorbereitet…";
    case "checking":
      return progress.parts_total > 0
        ? `Pläne werden gegen die Normen geprüft (${progress.parts_done} von ${progress.parts_total})…`
        : "Pläne werden gegen die Normen geprüft…";
    case "consolidating":
      return "Ergebnisse werden zusammengeführt…";
    case "finalizing":
      return "Ergebnis wird gespeichert…";
    default:
      return "Analyse läuft…";
  }
}

export interface RunProgressView {
  label: string;
  /** null: unbestimmter Balken. */
  percent: number | null;
  hints: string[];
  /** Läuft nicht mehr, Balken entfällt. */
  interrupted: boolean;
}

export function runProgressView(state: RunPollState, createdAt: string | null, now: number): RunProgressView {
  if (isInterruptedRun(state, createdAt, now)) {
    return {
      label: "Diese Analyse wurde unterbrochen und läuft nicht weiter.",
      percent: null,
      hints: ["Sie können sie entfernen und eine neue Analyse starten."],
      interrupted: true,
    };
  }
  const hints: string[] = [];
  if (state.failures >= CONNECTION_LOST_AFTER_FAILURES) {
    hints.push("Verbindung unterbrochen. Der Stand wird aktualisiert, sobald die Verbindung zurück ist.");
  }
  const stuck = state.resumeFailures >= RESUME_STUCK_AFTER_FAILURES;
  if (stuck) {
    // Keine Zusage mehr, die wir nicht halten können.
    hints.push("Die Analyse kommt zurzeit nicht weiter. Lassen Sie diese Seite offen oder versuchen Sie es später erneut.");
  } else if (state.progress?.stalled) {
    hints.push("Das dauert länger als üblich. Die Analyse wird automatisch fortgesetzt.");
  }
  if (state.progress?.background && !stuck) {
    hints.push("Sie können diese Seite schliessen, die Analyse läuft weiter.");
  }
  return { label: progressLabel(state.progress), percent: state.percent, hints, interrupted: false };
}

// ── Aktualisierung vor der Analyse ───────────────────────────────────────────

export interface PreflightInput {
  outcome: "done" | "timeout" | "skipped" | "failed";
  /** Antwort des ÖREB-Abrufs; fehlt, wenn er nicht rechtzeitig oder gar nicht zurückkam. */
  oereb: { usedStale: boolean; staleFetchedAt: string | null; documentsPending: number } | null;
  /** Rückgabewert der Reglement-Synchronisation; fehlt, wenn sie nicht fertig wurde. */
  syncEnd: SyncEnd | null;
}

/** Hält ehrlich fest, auf welchem Stand die Analyse startet. Nur Aufzählungswerte, kein freier Text. */
export function buildPreflight({ outcome, oereb, syncEnd }: PreflightInput): AnalysisPreflight {
  const interrupted: "timeout" | "skipped" | null =
    outcome === "timeout" || outcome === "skipped" ? outcome : null;

  let oerebState: PreflightOereb;
  if (oereb) oerebState = oereb.usedStale ? "stale" : "ok";
  else oerebState = interrupted ?? "failed";

  let documents: PreflightDocuments;
  if (syncEnd) documents = syncEnd;
  else if (interrupted && (!oereb || oereb.documentsPending > 0)) documents = interrupted;
  else if (oereb && oereb.documentsPending > 0) documents = "error";
  else documents = "not_needed";

  return {
    oereb: oerebState,
    documents,
    stale_fetched_at: oerebState === "stale" ? oereb?.staleFetchedAt ?? null : null,
  };
}

const DOCUMENTS_TEXT: Partial<Record<PreflightDocuments, string>> = {
  timeout: "Die Aktualisierung der Reglemente dauerte zu lange. Geprüft wird der bisherige Stand, der Rest läuft im Hintergrund weiter.",
  skipped: "Ohne Warten gestartet: Geprüft wird der bisherige Stand der Reglemente.",
  error: "Die Reglemente konnten nicht vollständig aktualisiert werden. Geprüft wird der bisherige Stand.",
  stalled: "Die Aktualisierung der Reglemente kam nicht voran. Geprüft wird der bisherige Stand.",
  unavailable: "Die Aktualisierung der Reglemente war nicht verfügbar. Geprüft wird der bisherige Stand.",
  busy: "Die Reglemente wurden gerade anderweitig aktualisiert. Geprüft wird möglicherweise noch der bisherige Stand.",
  aborted: "Die Aktualisierung der Reglemente wurde beendet, bevor sie fertig war. Geprüft wird der bisherige Stand.",
};

/** Leer, wenn alles aktuell war. */
export function preflightNoteText(p: AnalysisPreflight | null | undefined): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.oereb === "stale") {
    const date = formatDate(p.stale_fetched_at);
    parts.push(`Der ÖREB-Auszug konnte nicht aktualisiert werden. Geprüft wird der Stand${date ? ` vom ${date}` : ""}.`);
  } else if (p.oereb === "failed") {
    parts.push("Der ÖREB-Auszug konnte nicht aktualisiert werden. Geprüft wird der bisherige Stand.");
  } else if ((p.oereb === "timeout" || p.oereb === "skipped") && p.documents !== p.oereb) {
    parts.push("Der ÖREB-Auszug wurde nicht abgewartet. Geprüft wird der bisherige Stand.");
  }
  const documents = DOCUMENTS_TEXT[p.documents];
  if (documents) parts.push(documents);
  return parts.join(" ");
}

/** result_json.preflight tolerant lesen: fehlt bei älteren Analysen. */
export function readPreflight(value: unknown): AnalysisPreflight | null {
  const p = value as Partial<AnalysisPreflight> | null | undefined;
  if (!p || typeof p.oereb !== "string" || typeof p.documents !== "string") return null;
  return { oereb: p.oereb, documents: p.documents, stale_fetched_at: p.stale_fetched_at ?? null };
}

// ── Vollständigkeit des Ergebnisses ──────────────────────────────────────────

/** Zusatz zur Warnung über ausgelassene Teile, wenn die Sicherheitsgrenze der Grund ist. */
export function safetyLimitHint(p: { skipped: number; limit?: number } | null | undefined): string {
  if (!p || !(p.skipped > 0) || !p.limit) return "";
  return `Grund ist die Sicherheitsgrenze von ${p.limit} automatisch importierten Reglementsteilen je Analyse.`;
}

/** Dubletten konnten nicht zusammengeführt werden. Ältere Analysen ohne `applied` gelten als in Ordnung. */
export function consolidationFailed(value: unknown): boolean {
  return (value as { applied?: unknown } | null | undefined)?.applied === false;
}
