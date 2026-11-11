/** Prüft die Grundstücksangaben aus Requests. Rein. Ungültiges wird verworfen, nicht gemeldet. */
import { isOerebSupportedCanton } from "../oereb/cantons";

// Schweiz: CH + 12 Ziffern; Liechtenstein: LI + 11 Ziffern (live geprüft 11.11.2026).
const EGRID_RE = /^(CH\d{12}|LI\d{11})$/;
const E_MIN = 2_480_000;
const E_MAX = 2_840_000;
const N_MIN = 1_070_000;
const N_MAX = 1_300_000;

export function isValidEgrid(value: unknown): value is string {
  return typeof value === "string" && EGRID_RE.test(value);
}

export function isValidLv95(e: unknown, n: unknown): boolean {
  return (
    typeof e === "number" && typeof n === "number" &&
    Number.isFinite(e) && Number.isFinite(n) &&
    e >= E_MIN && e <= E_MAX && n >= N_MIN && n <= N_MAX
  );
}

export interface ParcelIdentity {
  egrid?: string;
  lv95_e?: number;
  lv95_n?: number;
}

export const PARCEL_IDENTITY_COLUMNS = ["egrid", "lv95_e", "lv95_n", "bfs_number"] as const;

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function parseParcelIdentity(body: {
  egrid?: unknown;
  lv95_e?: unknown;
  lv95_n?: unknown;
}): ParcelIdentity {
  const out: ParcelIdentity = {};
  const egrid = typeof body.egrid === "string" ? body.egrid.trim().toUpperCase() : body.egrid;
  if (isValidEgrid(egrid)) out.egrid = egrid;
  const e = asNumber(body.lv95_e);
  const n = asNumber(body.lv95_n);
  if (isValidLv95(e, n)) {
    out.lv95_e = e;
    out.lv95_n = n;
  }
  // bfs_number bewusst nicht: Sie kommt nur aus dem amtlichen Auszug (enrichProject), nie vom Client.
  return out;
}

/**
 * Standort aus einem Request. Der Kanton muss ein echtes Kürzel sein oder fehlen: Er bestimmt, welcher
 * ÖREB-Dienst gefragt wird. Sonst bleibt der Standort frei, Freitext-Projekte sind erlaubt.
 */
export function parseProjectLocation(value: unknown): { location: Record<string, unknown> } | { error: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { error: "Ungültiger Standort" };
  const location = { ...(value as Record<string, unknown>) };
  const canton = location.canton;
  if (canton === undefined || canton === null || canton === "") return { location };
  if (typeof canton !== "string" || !isOerebSupportedCanton(canton)) return { error: "Ungültiger Kanton" };
  location.canton = canton.trim().toUpperCase();
  return { location };
}

/** Fehlt eine dieser Spalten (Migration nicht eingespielt), meldet PostgREST ihren Namen. */
export function mentionsParcelIdentityColumn(message: string | undefined): boolean {
  return PARCEL_IDENTITY_COLUMNS.some((c) => (message ?? "").includes(c));
}
