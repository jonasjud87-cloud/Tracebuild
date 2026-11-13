"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { AnalysisAutoParts, AnalysisSnapshots, OerebRefreshExtras } from "@/lib/geoadmin/contract";
import ProjectGeoPanel from "@/components/ProjectGeoPanel";
import { useOerebSync } from "@/components/useOerebDocumentSync";
import { formatDate } from "@/components/geoportal-logic";
import AnalysisRunProgress from "@/components/AnalysisRunProgress";
import { useAnalysisRun } from "@/components/useAnalysisRun";
import {
  buildPreflight,
  consolidationFailed,
  findActiveRun,
  preflightNoteText,
  readPreflight,
  runProgressView,
  safetyLimitHint,
  selectionAfterRun,
  sortAnalysisItems,
  type PreflightInput,
} from "@/components/analysis-run-view";
import { NOT_RETRYABLE_HINT, analysisFailure, failureReference } from "@/components/analysis-error-logic";
import type { AnalysisPreflight } from "@/lib/analysis-stages/contract";
import {
  MAX_PLAN_FILES,
  MAX_PLAN_FILE_BYTES,
  planMimeType,
  type UploadedPlanFile,
} from "@/lib/plan-files";
import { autoPartsWarning, downloadReportCsv, openReportForPrint, type ReportMeta } from "@/lib/analysis-report";
import { coverageGaps, type CoverageNorm } from "@/lib/norm-coverage";
import { hashFiles } from "@/lib/plan-hash-client";
import { DELTA_CHANGE_LABEL, type DeltaChange } from "@/lib/analysis-delta";
import {
  type AnalysisItem,
  type Category,
  type Confidence,
  CATEGORY_LABELS,
  CONFIDENCE_LABELS,
} from "@/lib/domains/bau";

import ProjectBanner from "@/components/project/ProjectBanner";
import p from "@/app/projects/project.module.css";
import g from "@/components/project-geo.module.css";
import a from "./analysis.module.css";

const S = {
  ok:   { label: "Konform",  title: "Konforme Punkte", chip: p.chipOk,   tone: a.toneOk,   text: "var(--ok-text)",  dot: "var(--ok)"  },
  fail: { label: "Verstoss", title: "Verstösse",        chip: p.chipErr,  tone: a.toneFail, text: "var(--err-text)", dot: "var(--err)" },
  warn: { label: "Unklar",   title: "Unklare Punkte",   chip: p.chipWarn, tone: a.toneWarn, text: "var(--warn-text)", dot: "var(--warn)" },
} as const;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" });

function Icon({ size = 24, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const PlanIcon = <Icon><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 4v16M4 12h16" /></Icon>;
const FolderIcon = <Icon><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></Icon>;
const UploadIcon = <Icon size={28}><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></Icon>;
const ChevronRight = <Icon size={20}><path d="M9 5l7 7-7 7" /></Icon>;
const PlusIcon = <Icon size={18}><path d="M12 5v14M5 12h14" /></Icon>;


// ── Interfaces ────────────────────────────────────────────────────────────────

interface AnalysisWithDoc {
  id: string;
  status: string;
  created_at: string;
  versionNo: number | null;
  delta: DeltaMeta | null;
  deltaFallback: string | null;
  planType: string;
  /** Dateien des Plansatzes in Upload-Reihenfolge (ältere Analysen: eine Datei). */
  files: PlanFileRef[];
  items: AnalysisItem[];
  /** Nutzertext zum Fehlergrund bei status "error", nie der technische Grund selbst. */
  errorMessage: string | null;
  /** false: Kein «Erneut versuchen» (Kostengrenze, Konto gesperrt, Prüfung abgelehnt). */
  errorRetryable: boolean;
  /** Normen/Teile, die nicht geprüft werden konnten — das Ergebnis ist dann unvollständig. */
  failedNorms: { norm_title: string; error: string }[];
  /** Normteile ohne Prüfpunkte. Fehlt bei älteren Analysen. */
  emptyParts: string[];
  /** Stand von ÖREB, Geodaten und Normen dieser Analyse. Fehlt bei älteren Analysen. */
  snapshots: Partial<AnalysisSnapshots> | null;
  /** Vom Deckel oder der Sicherheitsgrenze ausgelassene Teile importierter Reglemente. */
  autoParts: (AnalysisAutoParts & { limit?: number }) | null;
  /** Stand der Aktualisierung vor dem Start. Fehlt bei älteren Analysen. */
  preflight: AnalysisPreflight | null;
  /** Doppelte Prüfpunkte konnten nicht zusammengeführt werden. */
  consolidationFailed: boolean;
}

/** So lange wartet der Analysestart höchstens auf ÖREB-Abruf und Reglemente. */
const PREFLIGHT_MAX_MS = 90_000;

interface PlanFileRef { name: string; url: string }

interface DeltaMeta {
  baseline_id: string;
  version_no: number | null;
  baseline_count: number;
  counts: Partial<Record<DeltaChange, number>>;
  same_project: boolean | null;
  mismatch_reason: string | null;
  recommend_full: boolean;
}

/** Name einer neuen Prüfung, wenn der Nutzer direkt Pläne hochlädt, ohne sie zu benennen. */
const DEFAULT_CHECK_NAME = "Baugesuch";

/** Prüfungen werden ohne Rücksicht auf Gross-/Kleinschreibung zusammengeführt ("baugesuch" = "Baugesuch"). */
function planKey(name: string): string {
  return name.trim().toLowerCase();
}

const RUN_LOCK_HINT = "Eine weitere Analyse können Sie starten, sobald diese abgeschlossen ist.";

const STATUS_BADGE: Record<string, { label: string; color: string; chip: string }> = {
  running: { label: "Läuft",  color: "var(--info-text)", chip: p.chipInfo },
  error:   { label: "Fehler", color: "var(--err-text)",  chip: p.chipErr },
};

interface ProjectInfo {
  name: string;
  location: { canton?: string; municipality?: string } | null;
  parcel_number: string | null;
  bauzone: string | null;
}

interface RawGetAnalysis {
  id: string;
  status: string;
  created_at: string;
  version_no?: number | null;
  documents?: { doc_type: string | null; file_url?: string | null } | null;
  files?: PlanFileRef[];
  analysis_items?: AnalysisItem[];
  items?: AnalysisItem[];
  result_json?: { error?: string | null; timed_out?: boolean | null; failed_norms?: { norm_title: string; error: string }[] | null; empty_parts?: string[] | null; auto_parts?: AnalysisAutoParts | null; preflight?: unknown; consolidation?: unknown; delta?: DeltaMeta | null; delta_fallback?: string | null } & Partial<AnalysisSnapshots> | null;
  failed_norms?: { norm_title: string; error: string }[];
}

function normalizeAnalysis(a: RawGetAnalysis, planType?: string): AnalysisWithDoc {
  return {
    id: a.id,
    status: a.status,
    created_at: a.created_at,
    versionNo: typeof a.version_no === "number" ? a.version_no : null,
    delta: a.result_json?.delta ?? null,
    deltaFallback: a.result_json?.delta_fallback ?? null,
    planType: planType ?? a.documents?.doc_type ?? DEFAULT_CHECK_NAME,
    files: a.files ?? (a.documents?.file_url ? [{ name: "Plan", url: a.documents.file_url }] : []),
    items: sortAnalysisItems(a.items ?? a.analysis_items ?? [], a.result_json?.norm_versions),
    errorMessage: a.status === "error" ? analysisFailure(a.result_json?.error, a.result_json?.timed_out === true).text : null,
    errorRetryable: a.status !== "error" || analysisFailure(a.result_json?.error, a.result_json?.timed_out === true).retryable,
    failedNorms: a.failed_norms ?? a.result_json?.failed_norms ?? [],
    emptyParts: a.result_json?.empty_parts ?? [],
    snapshots: a.result_json
      ? {
          oereb_snapshot: a.result_json.oereb_snapshot,
          geodata_snapshot: a.result_json.geodata_snapshot,
          norm_versions: a.result_json.norm_versions,
        }
      : null,
    autoParts: a.result_json?.auto_parts ?? null,
    preflight: readPreflight(a.result_json?.preflight),
    consolidationFailed: consolidationFailed(a.result_json?.consolidation),
  };
}

// ── CheckCard ─────────────────────────────────────────────────────────────────

function CheckCard({ item }: { item: AnalysisItem }) {
  const cfg = S[item.status as keyof typeof S] ?? S.warn;
  const [expanded, setExpanded] = useState(false);
  const title = item.norm_title || CATEGORY_LABELS[item.category as Category] || item.category || "Prüfpunkt";

  return (
    <div className={`${a.check} ${cfg.tone}`}>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className={a.checkHead}>
        <span className={`${cfg.chip} ${a.chipSm}`}>
          <span className={a.dot} style={{ background: cfg.dot }} />
          {cfg.label}
        </span>
        <span className={a.checkTitle}>{title}</span>
        {item.change_status && item.change_status !== "unchanged" && (
          <span className={`${p.chip} ${a.chipSm}`}>{DELTA_CHANGE_LABEL[item.change_status as DeltaChange] ?? item.change_status}</span>
        )}
        <svg className={a.checkChevron} style={{ transform: expanded ? "rotate(180deg)" : "none" }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className={a.checkBody}>
          <p className={a.checkNote} style={{ color: cfg.text }}>{item.note}</p>

          {item.suggestion && (
            <div className={a.suggestion}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <p>{item.suggestion}</p>
            </div>
          )}

          <div className={a.checkMeta}>
            {item.category && (
              <span className={`${p.chipInfo} ${a.chipSm}`}>
                {CATEGORY_LABELS[item.category as Category] ?? item.category}
              </span>
            )}
            {item.confidence && (
              <span className={`${p.chip} ${a.chipSm}`}>
                Konfidenz: {CONFIDENCE_LABELS[item.confidence as Confidence] ?? item.confidence}
              </span>
            )}
            {(item.source_file || item.page_reference != null) && (
              <span className={a.source}>
                {[item.source_file, item.page_reference != null ? `S. ${item.page_reference}` : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── FilterPill ────────────────────────────────────────────────────────────────

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`${p.pill} ${active ? p.pillActive : ""}`}>
      {children}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalysisPage({ params }: { params: { id: string } }) {
  const [analyses, setAnalyses]             = useState<AnalysisWithDoc[]>([]);
  const [localPlanTypes, setLocalPlanTypes] = useState<string[]>([]);
  const [view, setView]                     = useState<"overview" | "plantype">("overview");
  const [selectedPlanType, setSelectedPlanType] = useState<string>("");
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisWithDoc | null>(null);
  const [showNewTypeInput, setShowNewTypeInput] = useState(false);
  const [newTypeName, setNewTypeName]       = useState("");
  const [pendingFiles, setPendingFiles]     = useState<File[]>([]);
  /** Fortschritt während des Hochladens, z.B. "3 von 10"; null = Analyse läuft. */
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [previewIdx, setPreviewIdx]         = useState(0);
  const [uploading, setUploading]           = useState(false);
  const [cancelling, setCancelling]         = useState(false);
  const [cancelError, setCancelError]       = useState<string | null>(null);
  const [info, setInfo]                     = useState<string | null>(null);
  const [project, setProject]               = useState<ProjectInfo | null>(null);
  const [assignedNorms, setAssignedNorms]     = useState<CoverageNorm[] | null>(null);
  const [reuseOffer, setReuseOffer]             = useState<{ id: string; versionNo: number | null; createdAt: string } | null>(null);
  const skipReuseRef                            = useRef(false);
  const [error, setError]                   = useState<string | null>(null);
  const [dragOver, setDragOver]             = useState(false);
  const [menuOpenId, setMenuOpenId]         = useState<string | null>(null);
  const [overviewFilter, setOverviewFilter] = useState<"all" | "fail" | "warn">("all");
  const [overviewOpen, setOverviewOpen]     = useState(true);
  const [detailFilter, setDetailFilter]     = useState<"all" | "fail" | "warn" | "ok">("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  /** true, solange die Dateien hochgeladen werden — dann gibt es serverseitig noch nichts abzubrechen. */
  const uploadPhaseRef = useRef(false);
  /** Aktualisierung vor der Analyse: läuft, und «Ohne Warten starten» beendet das Warten. */
  const [preflight, setPreflight] = useState<"oereb" | "documents" | null>(null);
  const [preflightNote, setPreflightNote] = useState<string | null>(null);
  const skipPreflightRef = useRef<(() => void) | null>(null);
  const sync = useOerebSync();

  // Neue Version geöffnet → Vorschau beginnt bei der ersten Datei.
  useEffect(() => { setPreviewIdx(0); }, [selectedAnalysis?.id]);

  const loadAnalyses = useCallback(async () => {
    const data = await api.get<RawGetAnalysis[]>(`/projects/${params.id}/analyses`);
    const list = (data ?? []).map((a) => normalizeAnalysis(a));
    setAnalyses(list);
    // Die geöffnete Version ist ein Snapshot — nach dem Nachladen den frischen Stand
    // übernehmen (z.B. "läuft" → "done" mit Items), sonst bleibt der Hinweis stehen.
    setSelectedAnalysis((prev) => (prev ? list.find((a) => a.id === prev.id) ?? prev : prev));
    return list;
  }, [params.id]);

  /** Lauf zu Ende (auch abgebrochen oder gelöscht): Liste holen und das Ergebnis oder den Fehler zeigen. */
  async function settleRun(runId: string) {
    const list = await loadAnalyses();
    if (view !== "plantype") return;
    const typeList = list.filter((a) => planKey(a.planType) === planKey(selectedPlanType));
    if (typeList.some((a) => a.id === runId)) setDetailFilter("all");
    setSelectedAnalysis((prev) => selectionAfterRun(typeList, runId, prev));
  }

  // Der laufende Lauf kommt aus der Liste: Reload, Wiederöffnen und zweiter Tab zeigen denselben Stand.
  const activeRun = findActiveRun(analyses);
  const runState = useAnalysisRun(params.id, activeRun?.id ?? null, activeRun?.created_at ?? null, (runId) => {
    settleRun(runId).catch(() => {});
  });
  const runView = runProgressView(runState, activeRun?.created_at ?? null, Date.now());
  /** Sperrt neue Analysen. Ein unterbrochener Altlauf rechnet nicht mehr und sperrt deshalb nicht. */
  const lockingRun = activeRun && !runView.interrupted ? activeRun : null;
  const runNote = activeRun?.preflight ? preflightNoteText(activeRun.preflight) : preflightNote;
  const coverage = project && assignedNorms ? coverageGaps({ canton: project.location?.canton, municipality: project.location?.municipality }, assignedNorms) : [];

  useEffect(() => {
    api.get<ProjectInfo>(`/projects/${params.id}`).then(setProject).catch(() => {});
    let alive = true;
    api
      .get<{ norms: CoverageNorm | null }[]>(`/projects/${params.id}/norms`)
      .then((rows) => { if (alive) setAssignedNorms((rows ?? []).flatMap((r) => (r.norms ? [r.norms] : []))); })
      .catch(() => { if (alive) setAssignedNorms(null); });
    loadAnalyses().catch(() => {});
    return () => { alive = false; };
  }, [params.id, loadAnalyses]);

  useEffect(() => {
    if (!menuOpenId) return;
    const close = () => setMenuOpenId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpenId]);

  // Anzeigename je Prüfung = Schreibweise der neuesten Analyse; Schlüssel = kleingeschrieben.
  const labelByKey = new Map<string, string>();
  for (const a of analyses) {
    const k = planKey(a.planType);
    if (!labelByKey.has(k)) labelByKey.set(k, a.planType.trim());
  }
  const analysisTypes = Array.from(labelByKey.values());
  const allPlanTypes = [
    ...localPlanTypes.filter((t) => !labelByKey.has(planKey(t))),
    ...analysisTypes,
  ];

  /** Neueste abgeschlossene Analyse je Prüfung; Fehl-/Laufversionen zählen nicht als Ergebnis. */
  const latestByType: Record<string, AnalysisWithDoc> = {};
  /** Neueste Version überhaupt (auch error/running) — für den Status-Badge. */
  const newestByType: Record<string, AnalysisWithDoc> = {};
  for (const a of analyses) {
    const k = planKey(a.planType);
    if (!newestByType[k]) newestByType[k] = a;
    if (a.status === "done" && !latestByType[k]) latestByType[k] = a;
  }

  const typeAnalyses = analyses.filter((a) => planKey(a.planType) === planKey(selectedPlanType));
  const hasBaseline = !!latestByType[planKey(selectedPlanType)];

  function openPlanType(name: string) {
    setSelectedPlanType(name);
    // Vorhandenes Ergebnis direkt zeigen (wie die Übersichtskachel); die Upload-Zone erscheint
    // nur ohne abgeschlossene Analyse oder bewusst über "Neue Version".
    setSelectedAnalysis(latestByType[planKey(name)] ?? null);
    setView("plantype");
    setDetailFilter("all");
    setError(null);
    setInfo(null);
    setCancelError(null);
    setPendingFiles([]);
  }

  function createPlanType() {
    const name = newTypeName.trim();
    if (!name) return;
    setLocalPlanTypes((prev) => Array.from(new Set([...prev, name])));
    setNewTypeName("");
    setShowNewTypeInput(false);
    openPlanType(name);
  }

  async function deleteAnalysis(analysisId: string) {
    try {
      await api.delete(`/projects/${params.id}/analyses/${analysisId}`);
      setAnalyses((prev) => prev.filter((a) => a.id !== analysisId));
      if (selectedAnalysis?.id === analysisId) setSelectedAnalysis(null);
    } catch { /* ignore */ }
  }

  /** Dateien zum Plansatz hinzufügen. Doppelte (gleicher Name und Grösse) werden ignoriert. */
  function addFiles(files: File[]) {
    const rejected: string[] = [];
    const accepted = files.filter((f) => {
      if (!planMimeType(f.name, f.type)) { rejected.push(`${f.name}: nur PDF oder Bild`); return false; }
      if (f.size > MAX_PLAN_FILE_BYTES) { rejected.push(`${f.name}: grösser als ${MAX_PLAN_FILE_BYTES / 1024 / 1024} MB`); return false; }
      return true;
    });
    setInfo(null);
    setPendingFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
      const next = [...prev, ...accepted.filter((f) => !seen.has(`${f.name}|${f.size}`))];
      if (next.length > MAX_PLAN_FILES) rejected.push(`höchstens ${MAX_PLAN_FILES} Dateien pro Prüfung`);
      return next.slice(0, MAX_PLAN_FILES);
    });
    setError(rejected.length ? `Nicht übernommen: ${rejected.join("; ")}` : null);
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * ÖREB neu abrufen und offene Reglemente abwarten, damit die Analyse den frischen Stand
   * prüft. Blockiert nie: Fehler, Zeitlimit und «Ohne Warten starten» führen direkt weiter.
   * Das Ergebnis geht mit dem Start an den Server, der Hinweis überlebt so das Schliessen der Seite.
   */
  async function refreshBeforeAnalysis(signal: AbortSignal): Promise<AnalysisPreflight> {
    setPreflightNote(null);
    setPreflight("oereb");
    const seen: Pick<PreflightInput, "oereb" | "syncEnd"> = { oereb: null, syncEnd: null };

    const work = (async () => {
      const res = await api.post<OerebRefreshExtras>(`/projects/${params.id}/oereb`, { force: true }, signal);
      const documentsPending = res?.documents_pending ?? 0;
      seen.oereb = {
        usedStale: !!res?.used_stale,
        staleFetchedAt: res?.stale_fetched_at ?? null,
        documentsPending,
      };
      if (documentsPending > 0) {
        setPreflight("documents");
        seen.syncEnd = (await sync.run(documentsPending)).end;
      }
      return "done" as const;
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), PREFLIGHT_MAX_MS); });
    const skipped = new Promise<"skipped">((resolve) => { skipPreflightRef.current = () => resolve("skipped"); });
    const aborted = new Promise<"aborted">((resolve) => {
      if (signal.aborted) resolve("aborted");
      signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });

    let outcome: PreflightInput["outcome"] = "failed";
    try {
      const raced = await Promise.race([work, timeout, skipped, aborted]);
      if (raced === "aborted") throw new DOMException("Abgebrochen", "AbortError");
      outcome = raced;
    } catch (e) {
      if (signal.aborted) throw e;
    } finally {
      clearTimeout(timer);
      skipPreflightRef.current = null;
      work.catch(() => {});
      setPreflight(null);
    }

    const result = buildPreflight({ outcome, ...seen });
    setPreflightNote(preflightNoteText(result) || null);
    return result;
  }

  /**
   * Startet eine Analyse. Mit `retryOf` («Erneut versuchen») übernimmt der Server Pläne und Prüfung der
   * fehlgeschlagenen Analyse; Upload und Aktualisierung entfallen, der Start bleibt derselbe.
   * Während der Anfrage ist `uploading` gesetzt, das sperrt beide Knöpfe gegen Doppelklick.
   */
  async function runAnalysis(retryOf?: AnalysisWithDoc, mode: "full" | "delta" = "full") {
    const files = retryOf ? [] : pendingFiles;
    // Prüfung beim Start einfrieren: der Nutzer kann während der Minuten des Laufs
    // wechseln — das Ergebnis gehört trotzdem zur Prüfung, unter der es gestartet wurde.
    const planType = retryOf?.planType ?? selectedPlanType;
    if (uploading) return;
    if (retryOf ? lockingRun && lockingRun.id !== retryOf.id : files.length === 0 || lockingRun) return;
    setError(null);
    setInfo(null);
    setCancelError(null);
    setReuseOffer(null);

    if (!retryOf && !skipReuseRef.current) {
      const hashes = await hashFiles(files);
      if (hashes) {
        try {
          const decision = await api.post<{ reusable: { id: string; version_no: number | null; created_at: string } | null }>(
            `/projects/${params.id}/analyses/reuse-check`,
            { doc_type: planType, file_hashes: hashes },
          );
          if (decision.reusable) {
            setReuseOffer({ id: decision.reusable.id, versionNo: decision.reusable.version_no, createdAt: decision.reusable.created_at });
            return;
          }
        } catch {
          // Die Prüfung ist nur eine Abkürzung: Bei einem Fehler läuft die normale Analyse.
        }
      }
    }
    skipReuseRef.current = false;

    setUploading(true);
    setCancelling(false);

    // Lauf-ID vom Client: darüber kann der Server-Lauf abgebrochen werden, noch bevor
    // die Analyse-ID mit der Antwort zurückkommt.
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let startBody: Record<string, unknown> = { retry_of: retryOf?.id };
      if (!retryOf) {
        // 1. Dateien direkt in Storage laden — nicht durch die API-Route, deren Request-Body
        //    bei Vercel auf 4.5 MB begrenzt ist (daran scheiterten grössere Pläne mit HTTP 413).
        uploadPhaseRef.current = true;
        setUploadProgress(`0 von ${files.length}`);
        const slots = await api.post<{ name: string; path: string; token: string }[]>(
          `/projects/${params.id}/analyses/uploads`,
          { files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })) },
        );
        const storage = createClient().storage.from("documents");
        const uploaded: UploadedPlanFile[] = [];
        for (let i = 0; i < files.length; i++) {
          if (controller.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
          const f = files[i];
          const type = planMimeType(f.name, f.type)!;
          const { error: upErr } = await storage.uploadToSignedUrl(slots[i].path, slots[i].token, f, { contentType: type });
          if (upErr) throw new Error(`${f.name} konnte nicht hochgeladen werden: ${upErr.message}`);
          uploaded.push({ path: slots[i].path, name: f.name, type, size: f.size });
          setUploadProgress(`${i + 1} von ${files.length}`);
        }
        setUploadProgress(null);

        // 2. ÖREB und Reglemente auffrischen. Serverseitig läuft noch nichts, Abbrechen bleibt lokal.
        const preflightResult = await refreshBeforeAnalysis(controller.signal);
        uploadPhaseRef.current = false;
        startBody = { files: uploaded, doc_type: planType, preflight: preflightResult, mode };
      }

      // 3. Analyse über den ganzen Plansatz. Der Server antwortet sofort und rechnet im Hintergrund
      //    weiter (status "running"); ohne eingespielte Migration wartet diese Anfrage wie bisher.
      const raw = await api.post<RawGetAnalysis>(
        `/projects/${params.id}/analyses`,
        { ...startBody, run_id: runId },
        controller.signal,
      );
      const analysis = normalizeAnalysis(raw, planType);
      setAnalyses((prev) => [analysis, ...prev.filter((a) => a.id !== analysis.id)]);
      setLocalPlanTypes((prev) => prev.filter((t) => planKey(t) !== planKey(planType)));
      // Läuft sie noch, zeigt die Hauptfläche den Fortschritt; das Ergebnis folgt über settleRun.
      if (analysis.status !== "running" && planKey(planType) === planKey(selectedPlanType)) {
        setSelectedAnalysis(analysis);
        setDetailFilter("all");
      }
      if (!retryOf) setPendingFiles([]);
      // Die POST-Antwort enthält nicht sicher result_json; der Bericht braucht dessen Stände.
      loadAnalyses().catch(() => {});
    } catch (e: unknown) {
      if (controller.signal.aborted) {
        setInfo("Analyse abgebrochen.");
      } else {
        setError(e instanceof Error ? e.message : "Analyse fehlgeschlagen");
        // Fehlgeschlagene Version in die Liste holen, damit sie mit Status sichtbar ist.
        loadAnalyses().catch(() => {});
      }
    } finally {
      uploadPhaseRef.current = false;
      setUploadProgress(null);
      setUploading(false);
      setCancelling(false);
      abortRef.current = null;
      runIdRef.current = null;
    }
  }

  const preflightLabel = preflight === "documents"
    ? sync.state.progress?.total
      ? `Reglemente werden aktualisiert (${sync.state.progress.processed}/${sync.state.progress.total})…`
      : "Reglemente werden aktualisiert…"
    : preflight === "oereb"
      ? "ÖREB-Auszug wird aktualisiert…"
      : null;

  const skipPreflightButton = preflight && (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); skipPreflightRef.current?.(); }}
      className={`${p.btnGhost} ${p.btnSm}`}
    >
      Ohne Warten starten
    </button>
  );

  async function cancelAnalysis() {
    if (!uploading || cancelling) return;
    setCancelling(true);
    const runId = runIdRef.current;
    const controller = abortRef.current;

    // Noch beim Hochladen: serverseitig läuft nichts, also einfach lokal abbrechen.
    if (uploadPhaseRef.current) {
      controller?.abort();
      return;
    }

    // Den Server so lange informieren, bis er den Lauf gefunden hat: In den ersten
    // Augenblicken existiert die Analyse-Zeile noch nicht (Upload läuft) — ein einzelner
    // Cancel-Aufruf ginge dann ins Leere und der Lauf liefe voll durch.
    let confirmed = false;
    if (runId) {
      for (let attempt = 0; attempt < 20 && !confirmed; attempt++) {
        // Der Lauf ist inzwischen fertig (POST zurück, abortRef geräumt) → nichts mehr abzubrechen.
        if (abortRef.current !== controller) return;
        try {
          const r = await api.post<{ cancelled: number }>(`/projects/${params.id}/analyses/cancel`, { run_id: runId });
          confirmed = (r?.cancelled ?? 0) > 0;
        } catch {
          // nächster Versuch
        }
        if (!confirmed) await new Promise((res) => setTimeout(res, 1000));
      }
    }
    if (abortRef.current !== controller) return;
    controller?.abort();
    if (!confirmed) {
      setError("Der Abbruch konnte nicht bestätigt werden — die Analyse läuft möglicherweise im Hintergrund weiter. Bitte die Seite später neu laden.");
    }
  }

  /** Abbruch der laufenden Analyse; die ID kommt aus der Liste, geht also auch nach einem Reload. */
  async function cancelActiveRun() {
    if (!activeRun || cancelling) return;
    const runId = activeRun.id;
    setCancelling(true);
    setCancelError(null);
    try {
      const r = await api.post<{ cancelled: number }>(`/projects/${params.id}/analyses/cancel`, { analysis_id: runId });
      if ((r?.cancelled ?? 0) > 0) {
        // Abgebrochene Versionen stehen nicht in der Liste; auch ohne Nachladen gleich aus der Anzeige.
        setAnalyses((prev) => prev.filter((a) => a.id !== runId));
        setSelectedAnalysis((prev) => (prev?.id === runId ? null : prev));
        setInfo("Analyse abgebrochen.");
      }
      await settleRun(runId).catch(() => {});
    } catch {
      setCancelError("Der Abbruch konnte nicht bestätigt werden. Die Analyse läuft möglicherweise weiter, bitte versuchen Sie es erneut.");
    } finally {
      setCancelling(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (files && files.length > 0) addFiles(Array.from(files));
  }

  /** Ohne Namen direkt zum Upload: legt die Standard-Prüfung an (oder öffnet sie). */
  function startDefaultCheck() {
    const existing = allPlanTypes.find((t) => planKey(t) === planKey(DEFAULT_CHECK_NAME));
    if (!existing) setLocalPlanTypes((prev) => Array.from(new Set([...prev, DEFAULT_CHECK_NAME])));
    openPlanType(existing ?? DEFAULT_CHECK_NAME);
  }

  function reportMeta(a: AnalysisWithDoc): ReportMeta {
    const vIdx = typeAnalyses.findIndex((x) => x.id === a.id);
    return {
      projectName: project?.name ?? "Projekt",
      canton: project?.location?.canton ?? "",
      municipality: project?.location?.municipality ?? "",
      parcel: project?.parcel_number ?? null,
      bauzone: project?.bauzone ?? null,
      planType: a.planType,
      version: a.versionNo ?? (vIdx >= 0 ? typeAnalyses.length - vIdx : 1),
      createdAt: a.created_at,
      snapshots: a.snapshots,
      autoParts: a.autoParts,
      failedNorms: a.failedNorms,
      emptyParts: a.emptyParts,
      preflight: a.preflight,
      consolidationFailed: a.consolidationFailed,
    };
  }

  function exportPdf(a: AnalysisWithDoc) {
    if (!openReportForPrint(reportMeta(a), a.items)) {
      setError("Der Browser hat das Öffnen des Berichts blockiert (Pop-up-Blocker).");
    }
  }

  // ── OVERVIEW ──────────────────────────────────────────────────────────────

  if (view === "overview") {
    const typesWithAnalyses = allPlanTypes.filter((t) => !!latestByType[planKey(t)]);
    const totalFail = typesWithAnalyses.reduce((n, t) => n + (latestByType[planKey(t)]?.items.filter(i => i.status === "fail").length ?? 0), 0);
    const totalWarn = typesWithAnalyses.reduce((n, t) => n + (latestByType[planKey(t)]?.items.filter(i => i.status === "warn").length ?? 0), 0);

    return (
      <div>
        <ProjectBanner
          variant="analysis"
          title="Plan-Analyse"
          subtitle={allPlanTypes.length === 0
            ? "Alle Pläne eines Projekts werden gemeinsam geprüft"
            : `${allPlanTypes.length} Prüfung${allPlanTypes.length !== 1 ? "en" : ""}`}
          actions={
            <button type="button" onClick={() => setShowNewTypeInput(true)} className={p.btnSand}>
              {PlusIcon}
              Neue Prüfung
            </button>
          }
        />

        {lockingRun && !uploading && (
          <AnalysisRunProgress
            variant="banner"
            view={runView}
            title={lockingRun.planType}
            notes={[runNote]}
            cancelling={cancelling}
            cancelError={cancelError}
            onCancel={cancelActiveRun}
            onOpen={() => openPlanType(lockingRun.planType)}
          />
        )}

        <ProjectGeoPanel projectId={params.id} />

        {showNewTypeInput && (
          <div className={`${p.glassFlat} ${a.newType}`}>
            <input
              type="text"
              autoFocus
              aria-label="Name der Prüfung"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createPlanType();
                if (e.key === "Escape") { setShowNewTypeInput(false); setNewTypeName(""); }
              }}
              placeholder="z.B. Baugesuch, Vorabklärung, Projektänderung…"
              className={`${p.input} ${a.newTypeInput}`}
            />
            <button type="button" onClick={createPlanType} disabled={!newTypeName.trim()} className={p.btnNavy}>
              Erstellen
            </button>
            <button
              type="button"
              aria-label="Abbrechen"
              onClick={() => { setShowNewTypeInput(false); setNewTypeName(""); }}
              className={a.closeBtn}
            >
              ×
            </button>
          </div>
        )}

        {typesWithAnalyses.length > 0 && (
          <section aria-label="Offene Punkte" className={`${p.glass} ${a.panel}`}>
            <div className={`${p.sectionHead} ${overviewOpen ? "" : a.headClosed}`}>
              <h2 className={a.headH2}>
                <button type="button" aria-expanded={overviewOpen} onClick={() => setOverviewOpen((o) => !o)} className={a.collapse}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ transform: overviewOpen ? "none" : "rotate(-90deg)", transition: "transform .15s" }}>
                    <path d="M19 9l-7 7-7-7" />
                  </svg>
                  <span className={p.sectionTitle}>Offene Punkte</span>
                </button>
              </h2>
              {overviewOpen && (
                <div className={p.pillRow}>
                  {([
                    { key: "all" as const,  label: `Alle (${totalFail + totalWarn})` },
                    { key: "fail" as const, label: `Verstösse (${totalFail})` },
                    { key: "warn" as const, label: `Warnungen (${totalWarn})` },
                  ]).map(({ key, label }) => (
                    <FilterPill key={key} active={overviewFilter === key} onClick={() => setOverviewFilter(key)}>
                      {label}
                    </FilterPill>
                  ))}
                </div>
              )}
            </div>
            {overviewOpen && (
              <div className={a.listScroll}>
                {typesWithAnalyses.map((type) => {
                  const latest = latestByType[planKey(type)];
                  const count = analyses.filter((x) => planKey(x.planType) === planKey(type)).length;
                  const allItems = latest.items;
                  const visibleItems = allItems.filter(i =>
                    overviewFilter === "all" ? i.status !== "ok" : i.status === overviewFilter
                  );
                  const fCount = allItems.filter(i => i.status === "fail").length;
                  const wCount = allItems.filter(i => i.status === "warn").length;
                  const overallStatus = fCount > 0 ? "kritisch" : wCount > 0 ? "warnung" : "konform";
                  const badgeChip = { kritisch: p.chipErr, warnung: p.chipWarn, konform: p.chipOk }[overallStatus];
                  const badgeLabel = { kritisch: "Kritisch", warnung: "Warnung", konform: "Konform" }[overallStatus];

                  return (
                    <div key={type} className={a.group}>
                      <button type="button" onClick={() => openPlanType(type)} className={p.row}>
                        <span className={p.iconTile} aria-hidden="true">{PlanIcon}</span>
                        <span className={p.rowMain}>
                          <span className={p.rowTitle}>{type}</span>
                          {visibleItems.length === 0 && (
                            <span className={p.rowSub}>
                              {overviewFilter === "fail" ? "Keine Verstösse" : overviewFilter === "warn" ? "Keine Warnungen" : "Alle Prüfpunkte konform"}
                            </span>
                          )}
                        </span>
                        <span className={p.rowMeta}>
                          <span>V{count}</span>
                          <span>{shortDate(latest.created_at)}</span>
                          <span className={badgeChip}>{badgeLabel}</span>
                        </span>
                        <span className={p.rowChevron} aria-hidden="true">{ChevronRight}</span>
                      </button>
                      {visibleItems.length > 0 && (
                        <div className={a.subList}>
                          {visibleItems.map((item) => {
                            const cfg = S[item.status as keyof typeof S] ?? S.warn;
                            return (
                              <div key={item.id} className={`${a.subItem} ${cfg.tone}`}>
                                <span className={`${cfg.chip} ${a.chipSm}`}>
                                  <span className={a.dot} style={{ background: cfg.dot }} />
                                  {cfg.label}
                                </span>
                                {item.norm_title && <span className={a.subNorm}>{item.norm_title}</span>}
                                <p className={a.subNote} style={{ color: cfg.text }}>{item.note}</p>
                                <button type="button" aria-label={`${type} öffnen`} onClick={() => openPlanType(type)} className={a.iconBtn}>
                                  {ChevronRight}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {allPlanTypes.length === 0 ? (
          <div className={`${p.glass} ${a.empty}`}>
            <span className={p.iconTile} aria-hidden="true">{FolderIcon}</span>
            <p className={a.emptyTitle}>Noch keine Prüfung</p>
            <p className={a.emptyText}>Laden Sie alle Pläne des Projekts zusammen hoch: Situation, Grundrisse, Schnitte, Fassaden.</p>
            <button type="button" onClick={startDefaultCheck} className={`${p.btnNavy} ${p.btnSm}`}>
              + Pläne hochladen
            </button>
          </div>
        ) : (
          <div className={a.folderGrid}>
            {allPlanTypes.map((type) => {
              const latest = latestByType[planKey(type)];
              const newest = newestByType[planKey(type)];
              const newestBadge = newest && newest.status !== "done" ? STATUS_BADGE[newest.status] ?? STATUS_BADGE.error : null;
              const count = analyses.filter((x) => planKey(x.planType) === planKey(type)).length;
              const latestItems = latest?.items ?? [];
              const failCount = latestItems.filter((i) => i.status === "fail").length;
              const warnCount = latestItems.filter((i) => i.status === "warn").length;
              const okCount   = latestItems.filter((i) => i.status === "ok").length;

              return (
                <button key={type} type="button" onClick={() => openPlanType(type)} className={`${p.glass} ${a.folderCard}`}>
                  <span className={p.iconTile} aria-hidden="true">{FolderIcon}</span>
                  <span className={p.rowMain}>
                    <span className={p.rowTitle}>{type}</span>
                    {newestBadge && (
                      <span className={a.newest} style={{ color: newestBadge.color }}>
                        Neueste Version: {newestBadge.label}
                      </span>
                    )}
                    {latest ? (
                      <>
                        <span className={a.folderSub}>
                          {count} Version{count !== 1 ? "en" : ""} · {shortDate(latest.created_at)}
                        </span>
                        {(failCount > 0 || warnCount > 0) && (
                          <span className={a.counts}>
                            {failCount > 0 && (
                              <span className={a.count} style={{ color: "var(--err-text)" }}>
                                <span className={a.dot} style={{ background: "var(--err)" }} />{failCount}<span className={p.srOnly}> Verstösse</span>
                              </span>
                            )}
                            {warnCount > 0 && (
                              <span className={a.count} style={{ color: "var(--warn-text)" }}>
                                <span className={a.dot} style={{ background: "var(--warn)" }} />{warnCount}<span className={p.srOnly}> Warnungen</span>
                              </span>
                            )}
                            {okCount > 0 && (
                              <span className={a.count} style={{ color: "var(--ok-text)" }}>
                                <span className={a.dot} style={{ background: "var(--ok)" }} />{okCount}<span className={p.srOnly}> konform</span>
                              </span>
                            )}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className={a.folderSub}>{newest ? "Noch kein abgeschlossenes Ergebnis" : "Noch keine Pläne hochgeladen"}</span>
                    )}
                  </span>
                  <span className={p.rowChevron} aria-hidden="true">{ChevronRight}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── PLAN TYPE DETAIL ───────────────────────────────────────────────────────

  const items = selectedAnalysis?.items ?? [];
  const counts = selectedAnalysis ? {
    ok:   items.filter((i) => i.status === "ok").length,
    fail: items.filter((i) => i.status === "fail").length,
    warn: items.filter((i) => i.status === "warn").length,
  } : null;

  const filteredItems = detailFilter === "all"
    ? items
    : items.filter((i) => i.status === detailFilter);

  return (
    <div>
      <ProjectBanner
        variant="analysis"
        title={selectedPlanType}
        subtitle={typeAnalyses.length > 0 ? `Plan-Analyse · ${typeAnalyses.length} Version${typeAnalyses.length !== 1 ? "en" : ""}` : "Plan-Analyse"}
        actions={
          <button type="button" onClick={() => { setView("overview"); setSelectedAnalysis(null); }} className={p.btnGhost}>
            <Icon size={18}><path d="M15 19l-7-7 7-7" /></Icon>
            Prüfungen
          </button>
        }
      />

      <div className={a.detail}>
        <div className={a.side}>
          {typeAnalyses.length > 0 && (
            <>
              <p className={a.eyebrow}>Versionen · {typeAnalyses.length}</p>
              <div className={a.versionList}>
                {typeAnalyses.map((v, idx) => {
                  const isActive = selectedAnalysis?.id === v.id;
                  const aItems = v.items;
                  const f = aItems.filter((i) => i.status === "fail").length;
                  const w = aItems.filter((i) => i.status === "warn").length;
                  const o = aItems.filter((i) => i.status === "ok").length;
                  const badge = STATUS_BADGE[v.status] ?? STATUS_BADGE.error;
                  const vLabel = `V${v.versionNo ?? typeAnalyses.length - idx}`;
                  return (
                    <div key={v.id} className={a.versionWrap}>
                      <button
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => { setSelectedAnalysis(v); setDetailFilter("all"); }}
                        className={`${a.versionBtn} ${isActive ? a.versionActive : ""}`}
                      >
                        <span className={a.versionNr}>{vLabel}</span>
                        <span className={a.versionDate}>{shortDate(v.created_at)}</span>
                        {v.status !== "done" && (
                          <span title={v.errorMessage ?? undefined} className={`${badge.chip} ${a.chipXs}`}>
                            {badge.label}
                            {v.errorMessage && <span className={p.srOnly}>: {v.errorMessage}</span>}
                          </span>
                        )}
                        {v.status === "done" && (v.failedNorms.length > 0 || !!autoPartsWarning(v.autoParts)) && (
                          <span title={[...v.failedNorms.map((fn) => fn.norm_title), autoPartsWarning(v.autoParts)].filter(Boolean).join(", ")} className={`${p.chipWarn} ${a.chipXs}`}>
                            unvollständig
                          </span>
                        )}
                        {v.status === "done" && aItems.length > 0 && (
                          <span className={a.counts}>
                            {f > 0 && <span className={a.count} style={{ color: "var(--err-text)" }}><span className={a.dot} style={{ background: "var(--err)" }} />{f}<span className={p.srOnly}> Verstösse</span></span>}
                            {w > 0 && <span className={a.count} style={{ color: "var(--warn-text)" }}><span className={a.dot} style={{ background: "var(--warn)" }} />{w}<span className={p.srOnly}> Warnungen</span></span>}
                            {o > 0 && <span className={a.count} style={{ color: "var(--ok-text)" }}><span className={a.dot} style={{ background: "var(--ok)" }} />{o}<span className={p.srOnly}> konform</span></span>}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Optionen für Version ${vLabel}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenId === v.id}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === v.id ? null : v.id); }}
                        className={a.menuTrigger}
                      >
                        <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <circle cx="12" cy="5" r="1.7" />
                          <circle cx="12" cy="12" r="1.7" />
                          <circle cx="12" cy="19" r="1.7" />
                        </svg>
                      </button>
                      {menuOpenId === v.id && (
                        <div role="menu" onClick={(e) => e.stopPropagation()} className={a.menu}>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setMenuOpenId(null); deleteAnalysis(v.id); }}
                            className={a.menuItem}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Version löschen
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className={a.mainCol}>
          {!selectedAnalysis ? (
            <>
              {lockingRun && !uploading ? (
                <AnalysisRunProgress
                  variant="full"
                  view={runView}
                  title={planKey(lockingRun.planType) !== planKey(selectedPlanType) ? lockingRun.planType : null}
                  notes={[runNote, RUN_LOCK_HINT]}
                  cancelling={cancelling}
                  cancelError={cancelError}
                  onCancel={cancelActiveRun}
                  onRetry={() => runAnalysis(lockingRun)}
                  retrying={uploading}
                />
              ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!uploading) handleFiles(e.dataTransfer.files); }}
                onClick={() => !uploading && pendingFiles.length === 0 && fileRef.current?.click()}
                {...(!uploading && pendingFiles.length === 0 ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": "Pläne hochladen",
                  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fileRef.current?.click(); }
                  },
                } : {})}
                className={`${a.dropzone} ${dragOver ? a.dropzoneOver : ""} ${pendingFiles.length > 0 && !uploading ? a.dropzoneCompact : ""} ${!uploading && pendingFiles.length === 0 ? a.dropzoneIdle : ""}`}
              >
                <input ref={fileRef} type="file" multiple accept=".pdf,image/*" hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
                {!uploading && reuseOffer && (
                  <div role="status" className={`${g.alert} ${g.alertWarn}`} onClick={(e) => e.stopPropagation()} style={{ textAlign: "left", marginBottom: 16 }}>
                    <strong>Dieser Plan wurde bereits geprüft.</strong>
                    <p style={{ margin: "4px 0 0" }}>
                      Gleicher Plan, gleiche Normen: Version {reuseOffer.versionNo ?? "?"} vom {shortDate(reuseOffer.createdAt)} gilt weiter. Das Ergebnis bleibt gleich und kostet nichts.
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className={p.btnNavy}
                        onClick={() => {
                          const existing = analyses.find((x) => x.id === reuseOffer.id);
                          if (existing) { setSelectedAnalysis(existing); setPendingFiles([]); }
                          setReuseOffer(null);
                        }}
                      >
                        Ergebnis anzeigen
                      </button>
                      <button
                        type="button"
                        className={p.btnGhost}
                        onClick={() => { skipReuseRef.current = true; setReuseOffer(null); void runAnalysis(undefined, "full"); }}
                      >
                        Trotzdem neu prüfen
                      </button>
                    </div>
                  </div>
                )}
                {!uploading && coverage.length > 0 && (
                  <div role="status" className={`${g.alert} ${g.alertWarn}`} onClick={(e) => e.stopPropagation()} style={{ textAlign: "left", marginBottom: 16 }}>
                    <strong>Nicht alle Ebenen sind hinterlegt.</strong>
                    {coverage.map((c) => (
                      <p key={c.key} style={{ margin: "4px 0 0" }}>{c.text}</p>
                    ))}
                  </div>
                )}
                {uploading ? (
                  <div>
                    <div className={g.spinner} style={{ width: 44, height: 44, margin: "0 auto 16px" }} />
                    <p className={a.dzTitle}>
                      {uploadProgress ? `Pläne werden hochgeladen (${uploadProgress})…` : preflightLabel ?? "Analyse läuft – Pläne werden gegen die Normen geprüft…"}
                    </p>
                    <p className={a.dzText}>Das kann einige Minuten dauern</p>
                    {preflightNote && !preflight && (
                      <p role="status" className={`${g.alert} ${g.alertWarn} ${a.dzNote}`}>{preflightNote}</p>
                    )}
                    <div className={a.dzActions}>
                      {skipPreflightButton}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); cancelAnalysis(); }}
                        disabled={cancelling}
                        className={`${p.btnGhost} ${p.btnSm} ${g.cancelBtn}`}
                      >
                        {cancelling ? "Wird abgebrochen…" : "Analyse abbrechen"}
                      </button>
                    </div>
                  </div>
                ) : pendingFiles.length > 0 ? (
                  <div className={a.pending}>
                    <p className={a.dzTitle}>
                      {pendingFiles.length} Datei{pendingFiles.length !== 1 ? "en" : ""} · {selectedPlanType}
                    </p>
                    <p className={a.dzText}>
                      Alle Dateien werden zusammen geprüft. Fehlt noch etwas, ziehen Sie es hierher.
                    </p>
                    <ul className={a.fileList}>
                      {pendingFiles.map((f, i) => (
                        <li key={`${f.name}|${f.size}`} className={a.fileItem}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={a.fileIcon}>
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className={a.fileName}>{f.name}</span>
                          <span className={a.fileSize}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                          <button
                            type="button"
                            aria-label={`${f.name} entfernen`}
                            onClick={(e) => { e.stopPropagation(); removePendingFile(i); }}
                            className={a.closeBtn}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className={a.dzActions}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                        className={p.btnGhost}
                      >
                        + Weitere Dateien
                      </button>
                      {hasBaseline ? (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); runAnalysis(undefined, "delta"); }}
                            className={p.btnNavy}
                            title="Prüft die Befunde der letzten Version am neuen Plan nach und sucht Neues. Schneller und günstiger."
                          >
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" /></svg>
                            Änderungsprüfung
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); runAnalysis(undefined, "full"); }}
                            className={p.btnGhost}
                            title="Prüft den Plan komplett neu gegen alle Normen."
                          >
                            Vollprüfung
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); runAnalysis(); }}
                          className={p.btnNavy}
                        >
                          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" /></svg>
                          Analyse starten
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className={`${p.iconTile} ${a.bigTile}`} aria-hidden="true">{UploadIcon}</span>
                    <p className={a.dzTitle}>Pläne hochladen</p>
                    <p className={a.dzType}>{selectedPlanType}</p>
                    <p className={a.dzText}>
                      Alle Dateien des Plansatzes zusammen · PDF oder Bild · Drag & Drop oder klicken
                    </p>
                  </div>
                )}
              </div>
              )}
              {error && (
                <div role="alert" className={`${g.alert} ${g.alertErr} ${a.dzMsg}`}>
                  {error}
                </div>
              )}
              {info && (
                <div role="status" className={`${g.alert} ${g.alertInfo} ${a.dzMsg}`}>
                  {info}
                </div>
              )}
            </>
          ) : (() => {
            const vIdx = typeAnalyses.findIndex((x) => x.id === selectedAnalysis.id);
            const vNr  = selectedAnalysis.versionNo ?? typeAnalyses.length - vIdx;
            const isRunningVersion = selectedAnalysis.status === "running";
            const persistedNote = selectedAnalysis.preflight ? preflightNoteText(selectedAnalysis.preflight) : null;
            const sessionNote = !selectedAnalysis.preflight && !isRunningVersion && !lockingRun && !uploading ? preflightNote : null;
            const statusBadge = STATUS_BADGE[selectedAnalysis.status] ?? STATUS_BADGE.error;
            return (
              <div className={a.split}>
                <div className={a.preview}>
                  <div className={`${p.glassFlat} ${a.previewCard}`}>
                    <div className={a.previewHead}>
                      <Icon size={18}><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></Icon>
                      <span className={a.previewLabel}>Plan-Vorschau</span>
                      {selectedAnalysis.files.length > 1 && (
                        <select
                          aria-label="Datei für die Vorschau"
                          value={Math.min(previewIdx, selectedAnalysis.files.length - 1)}
                          onChange={(e) => setPreviewIdx(Number(e.target.value))}
                          className={`${p.select} ${a.previewSelect}`}
                        >
                          {selectedAnalysis.files.map((f, i) => (
                            <option key={f.url} value={i}>{i + 1}. {f.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {selectedAnalysis.files.length > 0 ? (
                      <iframe
                        key={selectedAnalysis.files[Math.min(previewIdx, selectedAnalysis.files.length - 1)].url}
                        src={selectedAnalysis.files[Math.min(previewIdx, selectedAnalysis.files.length - 1)].url}
                        title="Plan-Vorschau"
                        className={a.iframe}
                      />
                    ) : (
                      <div className={a.noPreview}>
                        <p>Keine Vorschau verfügbar für diesen Plan.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className={a.results}>
                  {uploading && (
                    <div className={`${p.glassFlat} ${a.inlineRun}`}>
                      <div className={g.spinner} style={{ width: 18, height: 18 }} />
                      <p>{preflightLabel ?? "Eine neue Analyse läuft im Hintergrund…"}</p>
                      {skipPreflightButton}
                      <button
                        type="button"
                        onClick={cancelAnalysis}
                        disabled={cancelling}
                        className={`${p.btnGhost} ${p.btnSm} ${g.cancelBtn}`}
                      >
                        {cancelling ? "Wird abgebrochen…" : "Abbrechen"}
                      </button>
                    </div>
                  )}
                  {activeRun && !uploading && (lockingRun || selectedAnalysis.id === activeRun.id) && (
                    <AnalysisRunProgress
                      variant="banner"
                      view={runView}
                      title={planKey(activeRun.planType) !== planKey(selectedPlanType) ? activeRun.planType : null}
                      notes={[runNote, lockingRun ? RUN_LOCK_HINT : null]}
                      cancelling={cancelling}
                      cancelError={cancelError}
                      onCancel={cancelActiveRun}
                      onRetry={() => runAnalysis(activeRun)}
                      retrying={uploading}
                    />
                  )}
                  {error && (
                    <p role="alert" className={`${g.alert} ${g.alertErr}`}>{error}</p>
                  )}
                  {info && (
                    <p role="status" className={`${g.alert} ${g.alertInfo}`}>{info}</p>
                  )}
                  <div className={a.resHead}>
                    <div>
                      <p className={a.eyebrow}>{selectedPlanType} · V{vNr}</p>
                      <h2 className={a.resTitle}>
                        {new Date(selectedAnalysis.created_at).toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                      </h2>
                    </div>
                    <div className={a.resActions}>
                      {!isRunningVersion && (
                        <>
                          <button
                            type="button"
                            onClick={() => exportPdf(selectedAnalysis)}
                            title="Prüfbericht als PDF (Druckansicht)"
                            className={`${p.btnGhost} ${p.btnSm}`}
                          >
                            <Icon size={16}><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></Icon>
                            Bericht (PDF)
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadReportCsv(reportMeta(selectedAnalysis), selectedAnalysis.items)}
                            title="Mängelliste als CSV (Excel)"
                            className={`${p.btnGhost} ${p.btnSm}`}
                          >
                            <Icon size={16}><path d="M3 10h18M3 14h18M10 4v16M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" /></Icon>
                            CSV
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedAnalysis(null)}
                        disabled={!!lockingRun}
                        title={lockingRun ? RUN_LOCK_HINT : undefined}
                        className={`${p.btnNavy} ${p.btnSm}`}
                      >
                        <Icon size={16}><path d="M12 5v14M5 12h14" /></Icon>
                        Neue Version
                      </button>
                    </div>
                  </div>

                  {selectedAnalysis.status !== "done" && selectedAnalysis.id !== activeRun?.id && (
                    <div className={`${g.alert} ${selectedAnalysis.status === "running" ? g.alertInfo : g.alertErr}`} style={{ color: statusBadge.color }}>
                      <p className={a.alertTitle}>
                        {selectedAnalysis.status === "running"
                          ? "Diese Analyse läuft noch — die Liste aktualisiert sich automatisch."
                          : "Diese Analyse ist fehlgeschlagen. Es liegen keine Prüfergebnisse vor."}
                      </p>
                      {selectedAnalysis.errorMessage && (
                        <p className={a.alertBody}>Grund: {selectedAnalysis.errorMessage}</p>
                      )}
                      {selectedAnalysis.status === "error" && (
                        <>
                          <p className={a.alertBody}>Referenz für den Support: {failureReference(selectedAnalysis.id)}</p>
                          {selectedAnalysis.errorRetryable ? (
                            <div className={a.alertActions}>
                              <button
                                type="button"
                                onClick={() => runAnalysis(selectedAnalysis)}
                                disabled={uploading || !!lockingRun}
                                title={lockingRun ? RUN_LOCK_HINT : "Startet eine neue Analyse mit denselben Plänen"}
                                className={`${p.btnNavy} ${p.btnSm}`}
                              >
                                {uploading ? "Wird gestartet…" : "Erneut versuchen"}
                              </button>
                            </div>
                          ) : (
                            <p className={a.alertBody}>{NOT_RETRYABLE_HINT}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {!isRunningVersion && (persistedNote || sessionNote) && (
                    <div role="status" className={`${g.alert} ${g.alertWarn} ${a.alertRow}`}>
                      <p>{persistedNote || sessionNote}</p>
                      {!persistedNote && (
                        <button type="button" aria-label="Hinweis schliessen" onClick={() => setPreflightNote(null)} className={a.closeBtn}>×</button>
                      )}
                    </div>
                  )}

                  {selectedAnalysis.snapshots?.oereb_snapshot?.fetched_at && (
                    <p className={a.stand} style={selectedAnalysis.snapshots.oereb_snapshot.stale ? { color: "var(--warn-text)", fontWeight: 600 } : undefined}>
                      ÖREB-Stand: {formatDate(selectedAnalysis.snapshots.oereb_snapshot.fetched_at) ?? "unbekannt"}
                      {selectedAnalysis.snapshots.oereb_snapshot.stale ? ". Die Aktualisierung war fehlgeschlagen, geprüft wurde dieser ältere Stand." : ""}
                    </p>
                  )}

                  {selectedAnalysis.deltaFallback && (
                    <div role="status" className={`${g.alert} ${g.alertWarn}`}>
                      <p className={a.alertTitle}>Es wurde eine Vollprüfung durchgeführt</p>
                      <p className={a.alertBody}>Die Änderungsprüfung war nicht möglich: {selectedAnalysis.deltaFallback}</p>
                    </div>
                  )}

                  {selectedAnalysis.delta && (
                    <div role="status" className={`${g.alert} ${selectedAnalysis.delta.recommend_full ? g.alertWarn : ""}`}>
                      <p className={a.alertTitle}>Änderungsprüfung gegenüber Version {selectedAnalysis.delta.version_no ?? "?"}</p>
                      <p className={a.alertBody}>
                        {(["resolved", "improved", "worse", "updated", "unchanged", "not_checkable", "new"] as DeltaChange[])
                          .filter((k) => (selectedAnalysis.delta?.counts?.[k] ?? 0) > 0)
                          .map((k) => `${selectedAnalysis.delta?.counts?.[k]} ${DELTA_CHANGE_LABEL[k].toLowerCase()}`)
                          .join(", ") || "Keine Änderungen festgestellt."}
                      </p>
                      {selectedAnalysis.delta.recommend_full && (
                        <p className={a.alertBody}>
                          Der Plan weicht stark von der Vorversion ab{selectedAnalysis.delta.mismatch_reason ? `: ${selectedAnalysis.delta.mismatch_reason}` : ""}. Wir empfehlen eine Vollprüfung über «Neue Version».
                        </p>
                      )}
                    </div>
                  )}

                  {autoPartsWarning(selectedAnalysis.autoParts) && (
                    <div role="alert" className={`${g.alert} ${g.alertWarn}`}>
                      <p className={a.alertTitle}>Ergebnis unvollständig</p>
                      <p className={a.alertBody}>{autoPartsWarning(selectedAnalysis.autoParts)} {safetyLimitHint(selectedAnalysis.autoParts)}</p>
                    </div>
                  )}

                  {selectedAnalysis.status === "done" && selectedAnalysis.failedNorms.length > 0 && (
                    <div className={`${g.alert} ${g.alertWarn}`}>
                      <p className={a.alertTitle}>
                        Ergebnis unvollständig — {selectedAnalysis.failedNorms.length === 1 ? "eine Norm konnte" : `${selectedAnalysis.failedNorms.length} Normen konnten`} nicht geprüft werden:
                      </p>
                      <ul className={a.alertList}>
                        {selectedAnalysis.failedNorms.map((f, i) => (
                          <li key={i}><strong className={a.ink}>{f.norm_title}</strong> — {f.error}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedAnalysis.status === "done" && selectedAnalysis.consolidationFailed && (
                    <p role="status" className={`${g.alert} ${g.alertWarn}`}>
                      Doppelte Prüfpunkte konnten nicht zusammengeführt werden. Dieselbe Feststellung kann deshalb mehrfach erscheinen.
                    </p>
                  )}

                  {!isRunningVersion && (
                    <>
                      <div className={a.stats}>
                        {(["fail", "warn", "ok"] as const).map((s) => {
                          const cfg = S[s];
                          const isActive = detailFilter === s;
                          return (
                            <button
                              key={s}
                              type="button"
                              aria-pressed={isActive}
                              onClick={() => setDetailFilter(detailFilter === s ? "all" : s)}
                              className={`${a.stat} ${cfg.tone} ${isActive ? a.statActive : ""}`}
                              style={{ color: cfg.text }}
                            >
                              <span className={a.statHead}>
                                <span className={a.dot} style={{ background: cfg.dot }} />
                                <span className={a.statTitle}>{cfg.title}</span>
                              </span>
                              <span className={a.statNr}>{counts![s]}</span>
                              <span className={a.statSub}>{counts![s] === 1 ? "Prüfpunkt" : "Prüfpunkte"}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className={p.pillRow}>
                        {([
                          { key: "all" as const,  label: `Alle (${items.length})` },
                          { key: "fail" as const, label: `Verstösse (${counts!.fail})` },
                          { key: "warn" as const, label: `Warnungen (${counts!.warn})` },
                          { key: "ok" as const,   label: `Konform (${counts!.ok})` },
                        ]).map(({ key, label }) => (
                          <FilterPill key={key} active={detailFilter === key} onClick={() => setDetailFilter(key)}>
                            {label}
                          </FilterPill>
                        ))}
                      </div>

                      <div className={a.list}>
                        {filteredItems.length === 0 ? (
                          <p className={a.listEmpty}>
                            Keine Prüfpunkte in dieser Kategorie.
                          </p>
                        ) : (
                          filteredItems.map((item) => <CheckCard key={item.id} item={item} />)
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
