import type { VIEWS } from "./constants";

export type AnalysisView = (typeof VIEWS)[number];

export interface AnalysisRow {
  id: string;
  status: string;
  orphaned: boolean;
  orgId: string | null;
  orgName: string;
  projectId: string | null;
  projectName: string;
  documentId: string | null;
  docType: string | null;
  createdAt: string;
  durationMs: number | null;
  costUsd: number | null;
  costChf: number | null;
  errorText: string | null;
  runId: string | null;
  /** Letztes Lebenszeichen einer Analyse in Etappen. Fehlt bei älteren Analysen. */
  lastActivityAt: string | null;
  stageCount: number | null;
}

export interface AnalysesSummary {
  running: number;
  orphaned: number;
  failed24h: number;
  expensive30d: number;
  costToday: number;
  cost30d: number;
  costTodayChf: number;
  cost30dChf: number;
  costTruncated: boolean;
}

export interface OrgOption {
  id: string;
  name: string;
}

export interface AnalysesListResponse {
  items: AnalysisRow[];
  nextCursor: string | null;
  view: AnalysisView;
  currency: "CHF";
  usdToChf: number;
  thresholds: { expensiveUsd: number; expensiveChf: number; orphanMinutes: number };
  appliedFilters: { org: string | null; from: string | null; to: string | null; minCost: number | null };
  summary: AnalysesSummary | null;
  orgs: OrgOption[] | null;
}

export interface CancelResponse {
  id: string;
  outcome: "cancelled" | "timed_out";
  status: "cancelled" | "error";
}
