import {
  DEFAULT_LIMIT,
  EXPENSIVE_DEFAULT_USD,
  EXPENSIVE_WINDOW_MS,
  FAILED_WINDOW_MS,
  MAX_LIMIT,
  MAX_MIN_COST_USD,
  VIEWS,
} from "./constants";
import type { AnalysisView } from "./types";

export interface Cursor {
  createdAt: string;
  id: string;
}

export interface ListParams {
  view: AnalysisView;
  org: string | null;
  from: string | null;
  to: string | null;
  minCost: number | null;
  limit: number;
  cursor: Cursor | null;
}

export type ParseResult = { ok: true; value: ListParams } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id]), "utf8").toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed as unknown[];
    if (typeof createdAt !== "string" || !TIMESTAMP_RE.test(createdAt)) return null;
    if (!isUuid(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function parseIso(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === "") return { ok: true, value: null };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, value: new Date(ms).toISOString() };
}

export function parseListParams(sp: URLSearchParams, now: Date): ParseResult {
  const viewRaw = sp.get("view") ?? "all";
  if (!(VIEWS as readonly string[]).includes(viewRaw)) return { ok: false, error: "Ungültiger Wert für view" };
  const view = viewRaw as AnalysisView;

  const orgRaw = sp.get("org");
  if (orgRaw && !isUuid(orgRaw)) return { ok: false, error: "Ungültige Organisations-ID" };

  const from = parseIso(sp.get("from"));
  if (!from.ok) return { ok: false, error: "Ungültiges Datum für from" };
  const to = parseIso(sp.get("to"));
  if (!to.ok) return { ok: false, error: "Ungültiges Datum für to" };
  if (from.value && to.value && from.value > to.value) return { ok: false, error: "from liegt nach to" };

  let minCost: number | null = null;
  const minRaw = sp.get("minCost");
  if (minRaw !== null && minRaw !== "") {
    const n = Number(minRaw);
    if (!Number.isFinite(n) || n < 0 || n > MAX_MIN_COST_USD) return { ok: false, error: "Ungültiger Wert für minCost" };
    minCost = n;
  } else if (view === "expensive") {
    minCost = EXPENSIVE_DEFAULT_USD;
  }

  let limit = DEFAULT_LIMIT;
  const limitRaw = sp.get("limit");
  if (limitRaw !== null && limitRaw !== "") {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Ungültiger Wert für limit" };
    limit = Math.min(n, MAX_LIMIT);
  }

  let cursor: Cursor | null = null;
  const cursorRaw = sp.get("cursor");
  if (cursorRaw) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) return { ok: false, error: "Ungültiger Cursor" };
  }

  let fromValue = from.value;
  if (!fromValue && !sp.has("from")) {
    if (view === "failed") fromValue = new Date(now.getTime() - FAILED_WINDOW_MS).toISOString();
    if (view === "expensive") fromValue = new Date(now.getTime() - EXPENSIVE_WINDOW_MS).toISOString();
  }

  return { ok: true, value: { view, org: orgRaw || null, from: fromValue, to: to.value, minCost, limit, cursor } };
}
