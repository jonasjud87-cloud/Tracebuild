import type { NormSupersession } from "@/lib/geoadmin/contract";

export type StandardsTab = "company" | "own" | "legal";

export interface StandardsTabDef {
  id: StandardsTab;
  label: string;
  hint: string;
}

export const STANDARDS_TABS: StandardsTabDef[] = [
  { id: "company", label: "Unternehmensnormen", hint: "Eigene Richtlinien und Standards Ihres Unternehmens" },
  { id: "own", label: "Eigene Fassungen", hint: "Von Ihnen hochgeladene Gesetze und Reglemente" },
  { id: "legal", label: "Gesetzliche Grundlagen", hint: "Von TraceBuild gepflegte Normen" },
];

export const DEFAULT_STANDARDS_TAB: StandardsTab = "company";

export interface CompanyFields {
  approval_status?: string | null;
  version_no?: number | null;
  priority?: string | null;
  scope_mode?: string | null;
  scope_cantons?: string[] | null;
  scope_project_ids?: string[] | null;
  supersedes_norm_id?: string | null;
  archived_at?: string | null;
  approved_by_email?: string | null;
  approved_at?: string | null;
}

export interface Standard extends Partial<NormSupersession>, CompanyFields {
  id: string;
  title?: string;
  domain: string;
  layer: number;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
  category: string;
  source_url: string | null;
  zone?: string | null;
  pdf_url?: string | null;
  org_id: string | null;
  created_at?: string | null;
}

export interface FileEntry {
  ids: string[];
  title?: string;
  jurisdiction_name: string | null;
  jurisdiction_type: string;
  category: string;
  source_url: string | null;
  zone: string | null;
  pdf_url: string | null;
  global: boolean;
  createdAt: string | null;
  supersession: NormSupersession | null;
  company: CompanyInfo | null;
}

export interface VersionRef {
  id: string;
  versionNo: number;
  approvedAt: string | null;
  approvedByEmail: string | null;
  createdAt: string | null;
}

export interface CompanyInfo {
  status: "draft" | "approved";
  versionNo: number;
  priority: string;
  scopeMode: string;
  scopeCantons: string[];
  scopeProjectIds: string[];
  supersedesId: string | null;
  archived: boolean;
  approvedAt: string | null;
  approvedByEmail: string | null;
  history: VersionRef[];
}

export const COMPANY_TYPE = "org";

export function supersessionFrom(st: Standard): NormSupersession | null {
  if (!st.org_id || !st.version_hint) return null;
  return {
    version_hint: st.version_hint,
    org_authoritative: st.org_authoritative === true,
    superseded_similarity: st.superseded_similarity ?? null,
    superseded_at: st.superseded_at ?? null,
    official: st.official ?? null,
  };
}

function displayName(st: Standard): string | null {
  if (st.jurisdiction_name) return st.jurisdiction_name;
  if (st.jurisdiction_type === "national") return "Bund";
  if (st.jurisdiction_type === COMPANY_TYPE) return "Unternehmen";
  return null;
}

function companyInfoOf(st: Standard): CompanyInfo | null {
  if (st.org_id === null || st.jurisdiction_type !== COMPANY_TYPE || st.version_no == null) return null;
  return {
    status: st.approval_status === "draft" ? "draft" : "approved",
    versionNo: st.version_no,
    priority: st.priority ?? "advisory",
    scopeMode: st.scope_mode ?? "all",
    scopeCantons: st.scope_cantons ?? [],
    scopeProjectIds: st.scope_project_ids ?? [],
    supersedesId: st.supersedes_norm_id ?? null,
    archived: !!st.archived_at,
    approvedAt: st.approved_at ?? null,
    approvedByEmail: st.approved_by_email ?? null,
    history: [],
  };
}

function attachHistory(entries: FileEntry[]): FileEntry[] {
  const byId = new Map<string, FileEntry>();
  entries.forEach((en) => {
    if (en.company) byId.set(en.ids[0], en);
  });
  const claimed = new Set<string>();
  entries.forEach((en) => {
    if (!en.company || en.company.archived) return;
    let prev = en.company.supersedesId ? byId.get(en.company.supersedesId) : undefined;
    const guard = new Set<string>([en.ids[0]]);
    while (prev && prev.company && !guard.has(prev.ids[0])) {
      guard.add(prev.ids[0]);
      claimed.add(prev.ids[0]);
      en.company.history.push({
        id: prev.ids[0],
        versionNo: prev.company.versionNo,
        approvedAt: prev.company.approvedAt,
        approvedByEmail: prev.company.approvedByEmail,
        createdAt: prev.createdAt,
      });
      prev = prev.company.supersedesId ? byId.get(prev.company.supersedesId) : undefined;
    }
  });
  return entries.filter((en) => !claimed.has(en.ids[0]));
}

export function buildEntries(standards: Standard[]): FileEntry[] {
  const entries: FileEntry[] = [];
  const seen = new Map<string, FileEntry>();
  for (const st of standards) {
    const versioned = st.org_id !== null && st.jurisdiction_type === COMPANY_TYPE && st.version_no != null;
    const key = versioned ? `company||${st.id}` : `${st.org_id ?? "global"}||${st.source_url ?? st.id}||${st.jurisdiction_name ?? ""}||${st.category}`;
    const existing = seen.get(key);
    if (existing) {
      existing.ids.push(st.id);
      if (!existing.pdf_url && st.pdf_url) existing.pdf_url = st.pdf_url;
      if (!existing.supersession) existing.supersession = supersessionFrom(st);
      continue;
    }
    const entry: FileEntry = {
      ids: [st.id],
      title: st.title,
      jurisdiction_name: displayName(st),
      jurisdiction_type: st.jurisdiction_type,
      category: st.category,
      source_url: st.source_url,
      zone: st.zone ?? null,
      pdf_url: st.pdf_url ?? null,
      global: st.org_id === null,
      createdAt: st.created_at ?? null,
      supersession: supersessionFrom(st),
      company: companyInfoOf(st),
    };
    seen.set(key, entry);
    entries.push(entry);
  }
  return attachHistory(entries);
}

export function entryTab(entry: FileEntry): StandardsTab {
  if (entry.global) return "legal";
  return entry.jurisdiction_type === COMPANY_TYPE ? "company" : "own";
}

export function splitByTab(entries: FileEntry[]): Record<StandardsTab, FileEntry[]> {
  const out: Record<StandardsTab, FileEntry[]> = { company: [], own: [], legal: [] };
  for (const entry of entries) out[entryTab(entry)].push(entry);
  return out;
}

export function matchesQuery(entry: FileEntry, needle: string): boolean {
  if (!needle) return true;
  return [entry.title, entry.source_url, entry.category, entry.jurisdiction_name].some((v) => v?.toLowerCase().includes(needle));
}
