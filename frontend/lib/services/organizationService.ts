import type { Organization } from "@/components/admin/types";
import type { OrgFormData } from "@/components/admin/OrgModal";

interface ApiOrg {
  id:             string;
  name:           string;
  slug:           string;
  description:    string | null;
  status:         string;
  plan:           string;
  ownerName:      string | null;
  ownerEmail:     string | null;
  userLimit:      number | null;
  projectLimit:   number | null;
  storageLimitGb: number | null;
  monthlyBudget:  number | null;
  createdAt:      string;
  updatedAt:      string;
  closedAt:       string | null;
  archivedAt:     string | null;
  isDefault:      boolean;
  userCount?:     number | null;
  projectCount?:  number | null;
  storageGB?:     number | null;
}

function mapOrg(raw: ApiOrg): Organization {
  return {
    id:            raw.id,
    name:          raw.name,
    planTier:      raw.plan           as Organization["planTier"],
    status:        raw.status         as Organization["status"],
    createdAt:     raw.createdAt,
    isDefault:     raw.isDefault,
    description:   raw.description    ?? undefined,
    owner:         raw.ownerName      ?? undefined,
    ownerEmail:    raw.ownerEmail     ?? undefined,
    userCount:     raw.userCount      ?? undefined,
    projectCount:  raw.projectCount   ?? undefined,
    userLimit:     raw.userLimit      ?? undefined,
    projectLimit:  raw.projectLimit   ?? undefined,
    storageGB:     raw.storageGB      ?? undefined,
    storageLimitGb: raw.storageLimitGb ?? undefined,
    monthlyBudget: raw.monthlyBudget  ?? undefined,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  const json = await res.json() as { data: T; error: string | null };
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.data;
}

export const organizationService = {
  async list(): Promise<Organization[]> {
    const res = await fetch("/api/organizations");
    const data = await handleResponse<ApiOrg[]>(res);
    return data.map(mapOrg);
  },

  async get(id: string): Promise<Organization> {
    const res = await fetch(`/api/organizations/${id}`);
    const data = await handleResponse<ApiOrg>(res);
    return mapOrg(data);
  },

  async create(form: OrgFormData, isDefault = false): Promise<Organization> {
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:           form.name,
        description:    form.description    || null,
        plan:           form.planTier,
        status:         form.status,
        ownerName:      form.owner          || null,
        ownerEmail:     form.ownerEmail     || null,
        userLimit:      form.userLimit,
        projectLimit:   form.projectLimit,
        storageLimitGb: form.storageLimit,
        monthlyBudget:  form.monthlyBudget,
        isDefault,
      }),
    });
    const data = await handleResponse<ApiOrg>(res);
    return mapOrg(data);
  },

  async update(id: string, form: OrgFormData): Promise<Organization> {
    const res = await fetch(`/api/organizations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:           form.name,
        description:    form.description    || null,
        plan:           form.planTier,
        status:         form.status,
        ownerName:      form.owner          || null,
        ownerEmail:     form.ownerEmail     || null,
        userLimit:      form.userLimit,
        projectLimit:   form.projectLimit,
        storageLimitGb: form.storageLimit,
        monthlyBudget:  form.monthlyBudget,
      }),
    });
    const data = await handleResponse<ApiOrg>(res);
    return mapOrg(data);
  },

  async changeStatus(id: string, status: Organization["status"]): Promise<Organization> {
    const res = await fetch(`/api/organizations/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await handleResponse<ApiOrg>(res);
    return mapOrg(data);
  },

  async softDelete(id: string): Promise<void> {
    const res = await fetch(`/api/organizations/${id}`, { method: "DELETE" });
    await handleResponse<null>(res);
  },
};
