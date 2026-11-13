export const CANTONS = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR",
  "JU", "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG",
  "TI", "UR", "VD", "VS", "ZG", "ZH", "FL",
];

export const JURISDICTIONS = [
  { value: "national", label: "Bund" },
  { value: "cantonal", label: "Kanton" },
  { value: "municipal", label: "Gemeinde" },
] as const;

export const NORMS_PAGE_SIZE = 200;

export interface AdminNorm {
  id: string;
  title?: string;
  domain: string;
  layer: number;
  jurisdiction_type: string;
  jurisdiction_name: string | null;
  category: string;
  source_url: string | null;
  zone: string | null;
  org_id: string | null;
  org_name: string | null;
  promoted_from_org_id: string | null;
  promoted_from_org_name: string | null;
  created_at?: string;
  pdf_url?: string | null;
}

export const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-[#151414] bg-white border border-[#8c8b8e] placeholder:text-[#6e6e73] focus:outline-none focus:ring-2 focus:ring-[#cbbfae]/55 focus:border-[#151414] transition-colors";
