export type NormProvider = "fedlex" | "sg";

export type StoredSourceStatus = "unchecked" | "current" | "update_available" | "error";

export type SourceViewStatus = "current" | "update_available" | "missing" | "error" | "unchecked" | "disabled";

export interface NormSourceRow {
  id: string;
  label: string;
  provider: NormProvider;
  identifier: string;
  norm_id: string | null;
  jurisdiction_type: "national" | "cantonal";
  jurisdiction_name: string | null;
  category: string;
  enabled: boolean;
  applied_version: string | null;
  applied_label: string | null;
  remote_version: string | null;
  remote_label: string | null;
  ignored_version: string | null;
  status: StoredSourceStatus;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface DraftDiff {
  added: number;
  removed: number;
  samplesAdded: string[];
  samplesRemoved: string[];
  note?: string;
  extractor?: number;
}

export interface NormDraftRow {
  id: string;
  source_id: string;
  norm_id: string | null;
  remote_version: string;
  remote_label: string;
  new_chars: number;
  old_chars: number;
  similarity: number | null;
  diff: DraftDiff;
  status: "draft" | "approved" | "rejected" | "superseded";
  created_at: string;
}

export interface RemoteVersion {
  version: string;
  label: string;
  title: string | null;
  fetchText: () => Promise<string>;
}

export interface SourceView {
  id: string;
  label: string;
  provider: NormProvider;
  identifier: string;
  jurisdictionType: "national" | "cantonal";
  jurisdictionName: string | null;
  enabled: boolean;
  normId: string | null;
  normTitle: string | null;
  status: SourceViewStatus;
  appliedLabel: string | null;
  remoteLabel: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  draftId: string | null;
}

export interface NormWatchSummary {
  total: number;
  current: number;
  updateAvailable: number;
  missing: number;
  error: number;
  unchecked: number;
  disabled: number;
  lastCheckedAt: string | null;
  stale: boolean;
}

export interface NormWatchOverview {
  sources: SourceView[];
  summary: NormWatchSummary;
}

export interface DraftDetail {
  id: string;
  sourceId: string;
  label: string;
  normId: string | null;
  normTitle: string | null;
  remoteLabel: string;
  appliedLabel: string | null;
  newChars: number;
  oldChars: number;
  similarity: number | null;
  diff: DraftDiff;
  status: "draft" | "approved" | "rejected" | "superseded";
  createdAt: string;
}

export interface CheckOutcome {
  sourceId: string;
  label: string;
  result: "current" | "draft_created" | "draft_exists" | "adopted" | "ignored" | "error";
  message?: string;
}

export interface CheckSummary {
  checked: number;
  skipped: number;
  draftsCreated: number;
  adopted: number;
  errors: number;
  outcomes: CheckOutcome[];
}
