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
import type { AnalysisPreflight } from "@/lib/analysis-stages/contract";
import {
  MAX_PLAN_FILES,
  MAX_PLAN_FILE_BYTES,
  planMimeType,
  type UploadedPlanFile,
} from "@/lib/plan-files";
import { autoPartsWarning, downloadReportCsv, openReportForPrint, type ReportMeta } from "@/lib/analysis-report";
import {
  type AnalysisItem,
  type Category,
  type Confidence,
  CATEGORY_LABELS,
  CONFIDENCE_LABELS,
} from "@/lib/domains/bau";

// ── Config ────────────────────────────────────────────────────────────────────

const S = {
  ok:   { label: "Konform",  title: "Konforme Punkte", color: "#4ADE80", bg: "rgba(74,222,128,0.08)",  border: "rgba(74,222,128,0.2)"  },
  fail: { label: "Verstoss", title: "Verstösse",        color: "#F87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)" },
  warn: { label: "Unklar",   title: "Unklare Punkte",   color: "#FBBF24", bg: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.2)"  },
} as const;

const CARD = {
  background: "rgba(23,37,64,0.55)",
  border: "1px solid rgba(133,166,233,0.18)",
  borderRadius: 14,
};

const SECONDARY_BTN: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#ABAEBB",
  background: "rgba(133,166,233,0.08)", border: "1px solid rgba(133,166,233,0.18)",
  padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
  transition: "all .15s", whiteSpace: "nowrap",
};
const secondaryHoverIn = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.background = "rgba(40,98,215,0.12)";
  e.currentTarget.style.borderColor = "#2862D7";
  e.currentTarget.style.color = "#85A6E9";
};
const secondaryHoverOut = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.background = "rgba(133,166,233,0.08)";
  e.currentTarget.style.borderColor = "rgba(133,166,233,0.18)";
  e.currentTarget.style.color = "#ABAEBB";
};

// ── Interfaces ────────────────────────────────────────────────────────────────

interface AnalysisWithDoc {
  id: string;
  status: string;
  created_at: string;
  planType: string;
  /** Dateien des Plansatzes in Upload-Reihenfolge (ältere Analysen: eine Datei). */
  files: PlanFileRef[];
  items: AnalysisItem[];
  /** Fehlertext aus result_json bei status "error". */
  errorMessage: string | null;
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

/** Name einer neuen Prüfung, wenn der Nutzer direkt Pläne hochlädt, ohne sie zu benennen. */
const DEFAULT_CHECK_NAME = "Baugesuch";

/** Prüfungen werden ohne Rücksicht auf Gross-/Kleinschreibung zusammengeführt ("baugesuch" = "Baugesuch"). */
function planKey(name: string): string {
  return name.trim().toLowerCase();
}

const RUN_LOCK_HINT = "Eine weitere Analyse können Sie starten, sobald diese abgeschlossen ist.";

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  running: { label: "Läuft",  color: "#85A6E9" },
  error:   { label: "Fehler", color: "#F87171" },
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
  documents?: { doc_type: string | null; file_url?: string | null } | null;
  files?: PlanFileRef[];
  analysis_items?: AnalysisItem[];
  items?: AnalysisItem[];
  result_json?: { error?: string | null; failed_norms?: { norm_title: string; error: string }[] | null; empty_parts?: string[] | null; auto_parts?: AnalysisAutoParts | null; preflight?: unknown; consolidation?: unknown } & Partial<AnalysisSnapshots> | null;
  failed_norms?: { norm_title: string; error: string }[];
}

function normalizeAnalysis(a: RawGetAnalysis, planType?: string): AnalysisWithDoc {
  return {
    id: a.id,
    status: a.status,
    created_at: a.created_at,
    planType: planType ?? a.documents?.doc_type ?? DEFAULT_CHECK_NAME,
    files: a.files ?? (a.documents?.file_url ? [{ name: "Plan", url: a.documents.file_url }] : []),
    items: sortAnalysisItems(a.items ?? a.analysis_items ?? [], a.result_json?.norm_versions),
    errorMessage: a.status === "error" ? (a.result_json?.error ?? null) : null,
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
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 12,
      padding: "14px 16px",
    }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          background: "none", border: "none", padding: 0, margin: 0,
          cursor: "pointer", fontFamily: "inherit", textAlign: "left",
        }}
      >
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: cfg.bg, border: `1px solid ${cfg.border}`,
          color: cfg.color, fontSize: 11, fontWeight: 600,
          padding: "3px 8px", borderRadius: 50, flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
          {cfg.label}
        </span>
        <p style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "#fff", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </p>
        <svg style={{ width: 13, height: 13, color: "#7B8299", flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div style={{ marginTop: 10, paddingLeft: 0 }}>
          <p style={{ fontSize: 13.5, fontWeight: 500, color: cfg.color, lineHeight: 1.45 }}>{item.note}</p>

          {item.suggestion && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "flex-start", gap: 6 }}>
              <svg style={{ width: 14, height: 14, color: "#7B8299", flexShrink: 0, marginTop: 1 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <p style={{ fontSize: 13, color: "#ABAEBB", lineHeight: 1.5 }}>{item.suggestion}</p>
            </div>
          )}

          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {item.category && (
              <span style={{ fontSize: 11, background: "rgba(133,166,233,0.1)", color: "#85A6E9", padding: "2px 8px", borderRadius: 50, border: "1px solid rgba(133,166,233,0.2)" }}>
                {CATEGORY_LABELS[item.category as Category] ?? item.category}
              </span>
            )}
            {item.confidence && (
              <span style={{ fontSize: 11, background: "rgba(23,37,64,0.8)", color: "#7B8299", padding: "2px 8px", borderRadius: 50, border: "1px solid rgba(133,166,233,0.12)" }}>
                Konfidenz: {CONFIDENCE_LABELS[item.confidence as Confidence] ?? item.confidence}
              </span>
            )}
            {(item.source_file || item.page_reference != null) && (
              <span style={{ fontSize: 11, color: "#7B8299", overflowWrap: "anywhere" }}>
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
    <button
      onClick={onClick}
      style={{
        padding: "5px 14px", borderRadius: 50, fontSize: 12, fontWeight: 500,
        background: active ? "#2862D7" : "rgba(133,166,233,0.08)",
        color: active ? "#fff" : "#7B8299",
        border: `1px solid ${active ? "#2862D7" : "rgba(133,166,233,0.15)"}`,
        cursor: "pointer", transition: "all .15s", fontFamily: "inherit",
      }}
    >
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

  useEffect(() => {
    api.get<ProjectInfo>(`/projects/${params.id}`).then(setProject).catch(() => {});
    loadAnalyses().catch(() => {});
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

  async function runAnalysis() {
    const files = pendingFiles;
    // Prüfung beim Start einfrieren: der Nutzer kann während der Minuten des Laufs
    // wechseln — das Ergebnis gehört trotzdem zur Prüfung, unter der es gestartet wurde.
    const planType = selectedPlanType;
    if (files.length === 0 || uploading || lockingRun) return;
    setError(null);
    setInfo(null);
    setCancelError(null);
    setUploading(true);
    setCancelling(false);

    // Lauf-ID vom Client: darüber kann der Server-Lauf abgebrochen werden, noch bevor
    // die Analyse-ID mit der Antwort zurückkommt.
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
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

      // 3. Analyse über den ganzen Plansatz. Der Server antwortet sofort und rechnet im Hintergrund
      //    weiter (status "running"); ohne eingespielte Migration wartet diese Anfrage wie bisher.
      const raw = await api.post<RawGetAnalysis>(
        `/projects/${params.id}/analyses`,
        { files: uploaded, doc_type: planType, run_id: runId, preflight: preflightResult },
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
      setPendingFiles([]);
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
      style={{ fontSize: 13, fontWeight: 500, color: "#ABAEBB", background: "rgba(133,166,233,0.08)", border: "1px solid rgba(133,166,233,0.18)", padding: "8px 18px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" }}
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
      version: vIdx >= 0 ? typeAnalyses.length - vIdx : 1,
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
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>Plan-Analyse</h2>
            <p style={{ fontSize: 13, color: "#7B8299", marginTop: 3 }}>
              {allPlanTypes.length === 0
                ? "Alle Pläne eines Projekts werden gemeinsam geprüft"
                : `${allPlanTypes.length} Prüfung${allPlanTypes.length !== 1 ? "en" : ""}`}
            </p>
          </div>
          <button
            onClick={() => setShowNewTypeInput(true)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "linear-gradient(90deg,#4fd1ff,#38bdf8 55%,#2862D7)",
              color: "#fff", padding: "9px 18px", borderRadius: 10,
              fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
              fontFamily: "inherit", boxShadow: "0 4px 16px rgba(40,98,215,0.35)",
              transition: "filter .15s",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.filter = "none"}
          >
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Neue Prüfung
          </button>
        </div>

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

        {/* New type input */}
        {showNewTypeInput && (
          <div style={{ ...CARD, padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="text"
              autoFocus
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createPlanType();
                if (e.key === "Escape") { setShowNewTypeInput(false); setNewTypeName(""); }
              }}
              placeholder="z.B. Baugesuch, Vorabklärung, Projektänderung…"
              style={{
                flex: 1, background: "rgba(23,37,64,0.8)", border: "1px solid rgba(133,166,233,0.25)",
                borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#fff",
                outline: "none", fontFamily: "inherit",
              }}
            />
            <button
              onClick={createPlanType}
              disabled={!newTypeName.trim()}
              style={{
                background: "#2862D7", color: "#fff", padding: "8px 16px", borderRadius: 8,
                fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                fontFamily: "inherit", opacity: !newTypeName.trim() ? 0.4 : 1,
              }}
            >
              Erstellen
            </button>
            <button
              onClick={() => { setShowNewTypeInput(false); setNewTypeName(""); }}
              style={{ color: "#7B8299", background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        )}

        {/* Offene Punkte panel */}
        {typesWithAnalyses.length > 0 && (
          <div style={{ ...CARD, marginBottom: 24, overflow: "hidden" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", borderBottom: "1px solid rgba(133,166,233,0.1)",
            }}>
              <button
                onClick={() => setOverviewOpen((o) => !o)}
                style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
              >
                <svg style={{ width: 12, height: 12, color: "#7B8299", transform: overviewOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#7B8299", textTransform: "uppercase", letterSpacing: "0.1em" }}>Offene Punkte</span>
              </button>
              {overviewOpen && (
                <div style={{ display: "flex", gap: 4 }}>
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
              <div style={{ overflowY: "auto", maxHeight: 360 }}>
                {typesWithAnalyses.map((type) => {
                  const latest = latestByType[planKey(type)];
                  const count = analyses.filter((a) => planKey(a.planType) === planKey(type)).length;
                  const allItems = latest.items;
                  const visibleItems = allItems.filter(i =>
                    overviewFilter === "all" ? i.status !== "ok" : i.status === overviewFilter
                  );
                  const fCount = allItems.filter(i => i.status === "fail").length;
                  const wCount = allItems.filter(i => i.status === "warn").length;
                  const overallStatus = fCount > 0 ? "kritisch" : wCount > 0 ? "warnung" : "konform";
                  const badgeColor = { kritisch: "#F87171", warnung: "#FBBF24", konform: "#4ADE80" }[overallStatus];
                  const badgeLabel = { kritisch: "Kritisch", warnung: "Warnung", konform: "Konform" }[overallStatus];

                  return (
                    <div key={type} style={{ borderBottom: "1px solid rgba(133,166,233,0.08)" }}>
                      <button
                        onClick={() => openPlanType(type)}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 16px", background: "none", border: "none", cursor: "pointer",
                          fontFamily: "inherit", textAlign: "left",
                          transition: "background .15s",
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.05)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "none"}
                      >
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{type}</span>
                        <span style={{ fontSize: 11, color: "#7B8299" }}>V{count}</span>
                        <span style={{ fontSize: 11, color: "#7B8299" }}>
                          {new Date(latest.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: badgeColor, background: `${badgeColor}18`, border: `1px solid ${badgeColor}40`, padding: "2px 8px", borderRadius: 50, flexShrink: 0 }}>
                          {badgeLabel}
                        </span>
                        <svg style={{ width: 12, height: 12, color: "#7B8299", flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      {visibleItems.length === 0 ? (
                        <div style={{ padding: "0 16px 10px" }}>
                          <p style={{ fontSize: 12, color: "#7B8299", fontStyle: "italic" }}>
                            {overviewFilter === "fail" ? "Keine Verstösse" : overviewFilter === "warn" ? "Keine Warnungen" : "Alle Prüfpunkte konform"}
                          </p>
                        </div>
                      ) : (
                        <div style={{ padding: "0 16px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                          {visibleItems.map((item) => {
                            const cfg = S[item.status as keyof typeof S] ?? S.warn;
                            return (
                              <div key={item.id} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, padding: "6px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, padding: "1px 7px", borderRadius: 50, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
                                  {cfg.label}
                                </span>
                                {item.norm_title && (
                                  <span style={{ fontSize: 11, color: "#7B8299", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{item.norm_title}</span>
                                )}
                                <p style={{ fontSize: 12.5, fontWeight: 500, color: cfg.color, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{item.note}</p>
                                <button onClick={() => openPlanType(type)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7B8299", flexShrink: 0 }}>
                                  <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
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
          </div>
        )}

        {/* Plan type grid */}
        {allPlanTypes.length === 0 ? (
          <div style={{ ...CARD, padding: "64px 16px", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, background: "rgba(133,166,233,0.1)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <svg style={{ width: 28, height: 28, color: "#7B8299" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#ABAEBB", margin: "0 0 4px" }}>Noch keine Prüfung</p>
            <p style={{ fontSize: 12.5, color: "#7B8299", margin: 0 }}>Laden Sie alle Pläne des Projekts zusammen hoch: Situation, Grundrisse, Schnitte, Fassaden.</p>
            <button
              onClick={startDefaultCheck}
              style={{ marginTop: 16, fontSize: 13, color: "#85A6E9", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
            >
              + Pläne hochladen
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {allPlanTypes.map((type) => {
              const latest = latestByType[planKey(type)];
              const newest = newestByType[planKey(type)];
              const newestBadge = newest && newest.status !== "done" ? STATUS_BADGE[newest.status] ?? STATUS_BADGE.error : null;
              const count = analyses.filter((a) => planKey(a.planType) === planKey(type)).length;
              const latestItems = latest?.items ?? [];
              const failCount = latestItems.filter((i) => i.status === "fail").length;
              const warnCount = latestItems.filter((i) => i.status === "warn").length;
              const okCount   = latestItems.filter((i) => i.status === "ok").length;
              const borderColor = !latest
                ? "rgba(133,166,233,0.18)"
                : failCount > 0 ? "rgba(248,113,113,0.35)"
                : warnCount > 0 ? "rgba(251,191,36,0.35)"
                : "rgba(74,222,128,0.35)";

              return (
                <button
                  key={type}
                  onClick={() => openPlanType(type)}
                  style={{
                    textAlign: "left", background: "rgba(23,37,64,0.55)", border: `1px solid ${borderColor}`,
                    borderRadius: 14, padding: "18px", cursor: "pointer", transition: "all .2s",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(40,98,215,0.08)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(23,37,64,0.55)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{type}</p>
                    <svg style={{ width: 14, height: 14, color: "#7B8299", flexShrink: 0, marginLeft: 8, marginTop: 2 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  {newestBadge && (
                    <p style={{ fontSize: 11, fontWeight: 600, color: newestBadge.color, margin: "0 0 8px" }}>
                      Neueste Version: {newestBadge.label}
                    </p>
                  )}
                  {latest ? (
                    <>
                      <p style={{ fontSize: 11.5, color: "#7B8299", marginBottom: 10 }}>
                        {count} Version{count !== 1 ? "en" : ""} · {new Date(latest.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {failCount > 0 && (
                          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#F87171" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F87171" }} />{failCount}
                          </span>
                        )}
                        {warnCount > 0 && (
                          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#FBBF24" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#FBBF24" }} />{warnCount}
                          </span>
                        )}
                        {okCount > 0 && (
                          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#4ADE80" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80" }} />{okCount}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <p style={{ fontSize: 12, color: "#7B8299" }}>{newest ? "Noch kein abgeschlossenes Ergebnis" : "Noch keine Pläne hochgeladen"}</p>
                  )}
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
    <div style={{ display: "flex", gap: 20, minHeight: 520 }}>
      {/* Sidebar */}
      <div style={{ width: 212, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={() => { setView("overview"); setSelectedAnalysis(null); }}
          style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#7B8299",
            background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
            padding: "4px 0", transition: "color .15s",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#ABAEBB"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#7B8299"}
        >
          <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Prüfungen
        </button>

        <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", padding: "0 0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedPlanType}
        </p>

        {typeAnalyses.length > 0 && (
          <>
            <p style={{ fontSize: 10, fontWeight: 700, color: "#7B8299", textTransform: "uppercase", letterSpacing: "0.1em", padding: "0 0 2px" }}>
              Versionen · {typeAnalyses.length}
            </p>
            {typeAnalyses.map((a, idx) => {
              const isActive = selectedAnalysis?.id === a.id;
              const aItems = a.items;
              const f = aItems.filter((i) => i.status === "fail").length;
              const w = aItems.filter((i) => i.status === "warn").length;
              const o = aItems.filter((i) => i.status === "ok").length;
              return (
                <div key={a.id} style={{ position: "relative" }}>
                  <button
                    onClick={() => { setSelectedAnalysis(a); setDetailFilter("all"); }}
                    style={{
                      width: "100%", textAlign: "left", padding: "12px", borderRadius: 12,
                      border: `1px solid ${isActive ? "#2862D7" : "rgba(133,166,233,0.18)"}`,
                      background: isActive ? "rgba(40,98,215,0.12)" : "rgba(23,37,64,0.55)",
                      cursor: "pointer", fontFamily: "inherit", transition: "all .15s",
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = "rgba(133,166,233,0.4)"; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = "rgba(133,166,233,0.18)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: isActive ? "#85A6E9" : "#7B8299", margin: 0 }}>
                        V{typeAnalyses.length - idx}
                      </p>
                      <div
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === a.id ? null : a.id); }}
                        style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, cursor: "pointer", color: "#7B8299" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(133,166,233,0.1)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "none"}
                      >
                        <svg style={{ width: 13, height: 13 }} fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="5" r="1.5" />
                          <circle cx="12" cy="12" r="1.5" />
                          <circle cx="12" cy="19" r="1.5" />
                        </svg>
                      </div>
                    </div>
                    <p style={{ fontSize: 12.5, fontWeight: 500, color: "#fff", margin: 0 }}>
                      {new Date(a.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </p>
                    {a.status !== "done" && (
                      <span style={{ display: "inline-block", marginTop: 6, fontSize: 10, fontWeight: 700, color: (STATUS_BADGE[a.status] ?? STATUS_BADGE.error).color, background: `${(STATUS_BADGE[a.status] ?? STATUS_BADGE.error).color}18`, border: `1px solid ${(STATUS_BADGE[a.status] ?? STATUS_BADGE.error).color}40`, padding: "1px 7px", borderRadius: 50 }}>
                        {(STATUS_BADGE[a.status] ?? STATUS_BADGE.error).label}
                      </span>
                    )}
                    {a.status === "done" && (a.failedNorms.length > 0 || !!autoPartsWarning(a.autoParts)) && (
                      <span title={[...a.failedNorms.map((f) => f.norm_title), autoPartsWarning(a.autoParts)].filter(Boolean).join(", ")} style={{ display: "inline-block", marginTop: 6, fontSize: 10, fontWeight: 700, color: "#FBBF24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", padding: "1px 7px", borderRadius: 50 }}>
                        unvollständig
                      </span>
                    )}
                    {a.status === "done" && aItems.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        {f > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "#F87171" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#F87171" }} />{f}</span>}
                        {w > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "#FBBF24" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FBBF24" }} />{w}</span>}
                        {o > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "#4ADE80" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ADE80" }} />{o}</span>}
                      </div>
                    )}
                  </button>
                  {menuOpenId === a.id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute", right: 0, top: 4, zIndex: 20,
                        background: "#0E111B", border: "1px solid rgba(133,166,233,0.18)",
                        borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", padding: "4px 0", minWidth: 148,
                      }}
                    >
                      <button
                        onClick={() => { setMenuOpenId(null); deleteAnalysis(a.id); }}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                          padding: "8px 12px", fontSize: 13, color: "#F87171", background: "none",
                          border: "none", cursor: "pointer", fontFamily: "inherit", transition: "background .1s",
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.08)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "none"}
                      >
                        <svg style={{ width: 13, height: 13, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Version löschen
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Main area */}
      <div style={{ flex: 1, minWidth: 0 }}>
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
              />
            ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!uploading) handleFiles(e.dataTransfer.files); }}
              onClick={() => !uploading && pendingFiles.length === 0 && fileRef.current?.click()}
              style={{
                width: "100%", border: `2px dashed ${dragOver ? "#2862D7" : "rgba(133,166,233,0.25)"}`,
                borderRadius: 18, padding: pendingFiles.length > 0 && !uploading ? "28px 16px" : "64px 16px", textAlign: "center", cursor: uploading || pendingFiles.length > 0 ? "default" : "pointer",
                background: dragOver ? "rgba(40,98,215,0.08)" : "rgba(23,37,64,0.3)",
                transition: "all .2s", boxSizing: "border-box",
              }}
            >
              <input ref={fileRef} type="file" multiple accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
              {uploading ? (
                <div>
                  <div style={{ width: 44, height: 44, border: "2px solid #2862D7", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite", margin: "0 auto 16px" }} />
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#fff", margin: "0 0 6px" }}>
                    {uploadProgress ? `Pläne werden hochgeladen (${uploadProgress})…` : preflightLabel ?? "Analyse läuft – Pläne werden gegen die Normen geprüft…"}
                  </p>
                  <p style={{ fontSize: 13, color: "#7B8299", margin: "0 0 18px" }}>Das kann einige Minuten dauern</p>
                  {preflightNote && !preflight && (
                    <p role="status" style={{ fontSize: 12.5, color: "#FBBF24", margin: "-8px auto 16px", maxWidth: 480 }}>{preflightNote}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  {skipPreflightButton}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); cancelAnalysis(); }}
                    disabled={cancelling}
                    style={{
                      fontSize: 13, fontWeight: 600, color: "#F87171",
                      background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)",
                      padding: "8px 18px", borderRadius: 10, cursor: cancelling ? "wait" : "pointer",
                      fontFamily: "inherit", opacity: cancelling ? 0.6 : 1, transition: "all .15s",
                    }}
                  >
                    {cancelling ? "Wird abgebrochen…" : "Analyse abbrechen"}
                  </button>
                  </div>
                </div>
              ) : pendingFiles.length > 0 ? (
                <div style={{ textAlign: "left", maxWidth: 560, margin: "0 auto" }}>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 4px", textAlign: "center" }}>
                    {pendingFiles.length} Datei{pendingFiles.length !== 1 ? "en" : ""} · {selectedPlanType}
                  </p>
                  <p style={{ fontSize: 12.5, color: "#7B8299", margin: "0 0 14px", textAlign: "center" }}>
                    Alle Dateien werden zusammen geprüft. Fehlt noch etwas, ziehen Sie es hierher.
                  </p>
                  <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    {pendingFiles.map((f, i) => (
                      <li key={`${f.name}|${f.size}`} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(23,37,64,0.6)", border: "1px solid rgba(133,166,233,0.15)", borderRadius: 10, padding: "8px 12px" }}>
                        <svg style={{ width: 15, height: 15, color: "#85A6E9", flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        <span style={{ fontSize: 12, color: "#7B8299", flexShrink: 0 }}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                        <button
                          type="button"
                          aria-label={`${f.name} entfernen`}
                          onClick={(e) => { e.stopPropagation(); removePendingFile(i); }}
                          style={{ color: "#7B8299", background: "none", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                      style={{
                        fontSize: 13, fontWeight: 500, color: "#ABAEBB",
                        background: "rgba(133,166,233,0.08)", border: "1px solid rgba(133,166,233,0.18)",
                        padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      + Weitere Dateien
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); runAnalysis(); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: "linear-gradient(90deg,#4fd1ff,#38bdf8 55%,#2862D7)",
                        color: "#fff", padding: "9px 20px", borderRadius: 10,
                        fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                        fontFamily: "inherit", boxShadow: "0 4px 16px rgba(40,98,215,0.35)",
                      }}
                    >
                      <svg style={{ width: 14, height: 14 }} fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      Analyse starten
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ width: 60, height: 60, background: "rgba(40,98,215,0.12)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                    <svg style={{ width: 30, height: 30, color: "#85A6E9" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>Pläne hochladen</p>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "#85A6E9", margin: "0 0 4px" }}>{selectedPlanType}</p>
                  <p style={{ fontSize: 13, color: "#7B8299", margin: 0 }}>
                    Alle Dateien des Plansatzes zusammen · PDF oder Bild · Drag & Drop oder klicken
                  </p>
                </div>
              )}
            </div>
            )}
            {error && (
              <div style={{ marginTop: 12, fontSize: 13, color: "#F87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12, padding: "10px 16px", textAlign: "center" }}>
                {error}
              </div>
            )}
            {info && (
              <div style={{ marginTop: 12, fontSize: 13, color: "#ABAEBB", background: "rgba(133,166,233,0.08)", border: "1px solid rgba(133,166,233,0.18)", borderRadius: 12, padding: "10px 16px", textAlign: "center" }}>
                {info}
              </div>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        ) : (() => {
          const vIdx = typeAnalyses.findIndex((a) => a.id === selectedAnalysis.id);
          const vNr  = typeAnalyses.length - vIdx;
          const isRunningVersion = selectedAnalysis.status === "running";
          const persistedNote = selectedAnalysis.preflight ? preflightNoteText(selectedAnalysis.preflight) : null;
          const sessionNote = !selectedAnalysis.preflight && !isRunningVersion && !lockingRun && !uploading ? preflightNote : null;
          return (
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              {/* PDF Viewer */}
              <div style={{ flex: "1 1 480px", minWidth: 320, position: "sticky", top: 20 }}>
                <div style={{ ...CARD, height: 720, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(133,166,233,0.1)", display: "flex", alignItems: "center", gap: 8 }}>
                    <svg style={{ width: 14, height: 14, color: "#7B8299", flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#ABAEBB", flexShrink: 0 }}>Plan-Vorschau</span>
                    {selectedAnalysis.files.length > 1 && (
                      <select
                        aria-label="Datei für die Vorschau"
                        value={Math.min(previewIdx, selectedAnalysis.files.length - 1)}
                        onChange={(e) => setPreviewIdx(Number(e.target.value))}
                        style={{
                          marginLeft: "auto", minWidth: 0, maxWidth: "70%", fontSize: 12, color: "#fff",
                          background: "rgba(23,37,64,0.8)", border: "1px solid rgba(133,166,233,0.25)",
                          borderRadius: 8, padding: "4px 8px", fontFamily: "inherit",
                        }}
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
                      style={{ flex: 1, width: "100%", border: "none", background: "#0E111B" }}
                    />
                  ) : (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <p style={{ fontSize: 13, color: "#7B8299", textAlign: "center", padding: "0 24px" }}>
                        Keine Vorschau verfügbar für diesen Plan.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Results */}
              <div style={{ flex: "1 1 420px", minWidth: 320, display: "flex", flexDirection: "column", gap: 18 }}>
              {uploading && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(40,98,215,0.1)", border: "1px solid rgba(133,166,233,0.25)", borderRadius: 12, padding: "10px 14px" }}>
                  <div style={{ width: 16, height: 16, border: "2px solid #2862D7", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite", flexShrink: 0 }} />
                  <p style={{ flex: 1, fontSize: 12.5, color: "#ABAEBB", margin: 0 }}>{preflightLabel ?? "Eine neue Analyse läuft im Hintergrund…"}</p>
                  {skipPreflightButton}
                  <button
                    type="button"
                    onClick={cancelAnalysis}
                    disabled={cancelling}
                    style={{ fontSize: 12, fontWeight: 600, color: "#F87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", padding: "5px 12px", borderRadius: 8, cursor: cancelling ? "wait" : "pointer", fontFamily: "inherit", opacity: cancelling ? 0.6 : 1 }}
                  >
                    {cancelling ? "Wird abgebrochen…" : "Abbrechen"}
                  </button>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
                />
              )}
              {error && (
                <p role="alert" style={{ fontSize: 13, color: "#F87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12, padding: "10px 14px", margin: 0 }}>{error}</p>
              )}
              {info && (
                <p role="status" style={{ fontSize: 13, color: "#ABAEBB", background: "rgba(133,166,233,0.08)", border: "1px solid rgba(133,166,233,0.18)", borderRadius: 12, padding: "10px 14px", margin: 0 }}>{info}</p>
              )}
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#7B8299", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
                    {selectedPlanType} · V{vNr}
                  </p>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: 0 }}>
                    {new Date(selectedAnalysis.created_at).toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                  </h3>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  {!isRunningVersion && (
                  <>
                  <button
                    onClick={() => exportPdf(selectedAnalysis)}
                    title="Prüfbericht als PDF (Druckansicht)"
                    style={SECONDARY_BTN}
                    onMouseEnter={secondaryHoverIn}
                    onMouseLeave={secondaryHoverOut}
                  >
                    <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Bericht (PDF)
                  </button>
                  <button
                    onClick={() => downloadReportCsv(reportMeta(selectedAnalysis), selectedAnalysis.items)}
                    title="Mängelliste als CSV (Excel)"
                    style={SECONDARY_BTN}
                    onMouseEnter={secondaryHoverIn}
                    onMouseLeave={secondaryHoverOut}
                  >
                    <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 4v16M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
                    </svg>
                    CSV
                  </button>
                  </>
                  )}
                  <button
                    onClick={() => setSelectedAnalysis(null)}
                    disabled={!!lockingRun}
                    title={lockingRun ? RUN_LOCK_HINT : undefined}
                    style={lockingRun ? { ...SECONDARY_BTN, opacity: 0.5, cursor: "not-allowed" } : SECONDARY_BTN}
                    onMouseEnter={lockingRun ? undefined : secondaryHoverIn}
                    onMouseLeave={lockingRun ? undefined : secondaryHoverOut}
                  >
                    <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Neue Version
                  </button>
                </div>
              </div>

              {selectedAnalysis.status !== "done" && selectedAnalysis.id !== activeRun?.id && (
                <div style={{ background: `${(STATUS_BADGE[selectedAnalysis.status] ?? STATUS_BADGE.error).color}12`, border: `1px solid ${(STATUS_BADGE[selectedAnalysis.status] ?? STATUS_BADGE.error).color}40`, borderRadius: 12, padding: "12px 16px" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: (STATUS_BADGE[selectedAnalysis.status] ?? STATUS_BADGE.error).color, margin: 0 }}>
                    {selectedAnalysis.status === "running"
                      ? "Diese Analyse läuft noch — die Liste aktualisiert sich automatisch."
                      : "Diese Analyse ist fehlgeschlagen. Es liegen keine Prüfergebnisse vor."}
                  </p>
                  {selectedAnalysis.errorMessage && (
                    <p style={{ fontSize: 12, color: "#ABAEBB", margin: "6px 0 0" }}>{selectedAnalysis.errorMessage}</p>
                  )}
                </div>
              )}

              {!isRunningVersion && (persistedNote || sessionNote) && (
                <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 12, padding: "10px 14px" }}>
                  <p style={{ flex: 1, fontSize: 12.5, color: "#FBBF24", margin: 0, lineHeight: 1.45 }}>{persistedNote || sessionNote}</p>
                  {!persistedNote && (
                    <button type="button" aria-label="Hinweis schliessen" onClick={() => setPreflightNote(null)} style={{ color: "#7B8299", background: "none", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                  )}
                </div>
              )}

              {selectedAnalysis.snapshots?.oereb_snapshot?.fetched_at && (
                <p style={{ fontSize: 12, color: selectedAnalysis.snapshots.oereb_snapshot.stale ? "#FBBF24" : "#7B8299", margin: 0, lineHeight: 1.45 }}>
                  ÖREB-Stand: {formatDate(selectedAnalysis.snapshots.oereb_snapshot.fetched_at) ?? "unbekannt"}
                  {selectedAnalysis.snapshots.oereb_snapshot.stale ? ". Die Aktualisierung war fehlgeschlagen, geprüft wurde dieser ältere Stand." : ""}
                </p>
              )}

              {autoPartsWarning(selectedAnalysis.autoParts) && (
                <div role="alert" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 12, padding: "12px 16px" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#FBBF24", margin: "0 0 4px" }}>Ergebnis unvollständig</p>
                  <p style={{ fontSize: 12, color: "#ABAEBB", margin: 0, lineHeight: 1.5 }}>{autoPartsWarning(selectedAnalysis.autoParts)} {safetyLimitHint(selectedAnalysis.autoParts)}</p>
                </div>
              )}

              {selectedAnalysis.status === "done" && selectedAnalysis.failedNorms.length > 0 && (
                <div style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 12, padding: "12px 16px" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#FBBF24", margin: "0 0 6px" }}>
                    Ergebnis unvollständig — {selectedAnalysis.failedNorms.length === 1 ? "eine Norm konnte" : `${selectedAnalysis.failedNorms.length} Normen konnten`} nicht geprüft werden:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#ABAEBB", lineHeight: 1.6 }}>
                    {selectedAnalysis.failedNorms.map((f, i) => (
                      <li key={i}><span style={{ color: "#fff" }}>{f.norm_title}</span> — {f.error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedAnalysis.status === "done" && selectedAnalysis.consolidationFailed && (
                <p role="status" style={{ fontSize: 12.5, color: "#FBBF24", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 12, padding: "10px 14px", margin: 0, lineHeight: 1.45 }}>
                  Doppelte Prüfpunkte konnten nicht zusammengeführt werden. Dieselbe Feststellung kann deshalb mehrfach erscheinen.
                </p>
              )}

              {!isRunningVersion && (
              <>
              {/* Stat tiles */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {(["fail", "warn", "ok"] as const).map((s) => {
                  const cfg = S[s];
                  const isActive = detailFilter === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setDetailFilter(detailFilter === s ? "all" : s)}
                      style={{
                        background: cfg.bg, border: `1px solid ${isActive ? cfg.color : cfg.border}`,
                        borderRadius: 14, padding: "16px", textAlign: "left", cursor: "pointer",
                        fontFamily: "inherit", transition: "all .15s",
                        outline: isActive ? `2px solid ${cfg.color}40` : "none",
                        outlineOffset: 2,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
                        <p style={{ fontSize: 10, fontWeight: 700, color: cfg.color, textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>{cfg.title}</p>
                      </div>
                      <p style={{ fontSize: 30, fontWeight: 800, color: cfg.color, margin: "0 0 2px" }}>{counts![s]}</p>
                      <p style={{ fontSize: 11, color: cfg.color, opacity: 0.7, margin: 0 }}>{counts![s] === 1 ? "Prüfpunkt" : "Prüfpunkte"}</p>
                    </button>
                  );
                })}
              </div>

              {/* Filter pills */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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

              {/* Result list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filteredItems.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#7B8299", textAlign: "center", padding: "40px 0" }}>
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
  );
}
