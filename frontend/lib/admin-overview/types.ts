export interface TrendValue {
  value: number;
  prev: number;
  changePct: number | null;
}

export interface OverviewCurrency {
  code: "USD" | "CHF";
  usdToChf: number | null;
}

export interface OverviewKpis {
  analyses30d: TrendValue;
  activeOrgs: TrendValue;
  activeUsers: { value: number };
  cost: { valueUsd: number; prevUsd: number; changePct: number | null; monthLabel: string };
}

export interface OverviewSeriesPoint {
  date: string;
  count: number;
}

export interface OverviewBudget {
  usedUsd: number;
  budgetUsd: number;
  percent: number | null;
  orgsWithBudget: number;
}

export type OverviewAnalysisStatus = "running" | "done" | "error" | "cancelled";

export interface OverviewLatestAnalysis {
  id: string;
  projectName: string;
  orgName: string;
  status: OverviewAnalysisStatus | string;
  createdAt: string;
  findings: number | null;
}

export interface OverviewData {
  generatedAt: string;
  currency: OverviewCurrency;
  kpis: OverviewKpis;
  series: OverviewSeriesPoint[];
  budget: OverviewBudget;
  latest: OverviewLatestAnalysis[];
  unavailable?: string[];
  truncated?: boolean;
}
