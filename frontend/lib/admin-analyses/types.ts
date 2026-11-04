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
  errorText: string | null;
  runId: string | null;
}

export interface AnalysesSummary {
  running: number;
  orphaned: number;
  failed24h: number;
  expensive30d: number;
  costToday: number;
  cost30d: number;
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
  thresholds: { expensiveUsd: number; orphanMinutes: number };
  appliedFilters: { org: string | null; from: string | null; to: string | null; minCost: number | null };
  summary: AnalysesSummary | null;
  orgs: OrgOption[] | null;
}

export interface CancelResponse {
  id: string;
  outcome: "cancelled" | "timed_out";
  status: "cancelled" | "error";
}
