import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, unauthorized, forbidden, ok, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const CSV_CHUNK = 1000;
const CSV_MAX = 10000;
const MAX_Q = 80;
const MAX_FIELD = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const ACTION_RE = /^[a-z0-9_]{1,64}$/i;

type Admin = ReturnType<typeof createAdminClient>;

interface Filters {
  org: string | null;
  action: string | null;
  actor: string | null;
  q: string | null;
  from: string | null;
  toValue: string | null;
  toInclusive: boolean;
}

interface Cursor {
  createdAt: string;
  id: string;
}

interface AuditRow {
  id: string;
  org_id: string | null;
  actor_id: string | null;
  actor_email: string;
  action: string;
  target_id: string | null;
  target_email: string | null;
  meta: unknown;
  created_at: string;
}

type ParseResult<T> = { value: T } | { error: string };

function clean(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f*]/g, " ").trim();
}

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, m => `\\${m}`);
}

function quoteOrValue(raw: string): string {
  return `"${raw.replace(/[\\"]/g, m => `\\${m}`)}"`;
}

function parseDate(raw: string, isTo: boolean): { iso: string; inclusive: boolean } | null {
  if (DATE_RE.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null;
    if (isTo) d.setUTCDate(d.getUTCDate() + 1);
    return { iso: d.toISOString(), inclusive: !isTo };
  }
  const ms = Date.parse(raw);
  if (raw.length > 40 || Number.isNaN(ms)) return null;
  return { iso: new Date(ms).toISOString(), inclusive: true };
}

function parseFilters(sp: URLSearchParams): ParseResult<Filters> {
  const f: Filters = { org: null, action: null, actor: null, q: null, from: null, toValue: null, toInclusive: true };

  const org = (sp.get("org") ?? "").trim();
  if (org) {
    if (org !== "none" && !UUID_RE.test(org)) return { error: "Ungültige Organisation" };
    f.org = org;
  }

  const action = (sp.get("action") ?? "").trim();
  if (action) {
    if (!ACTION_RE.test(action)) return { error: "Ungültige Aktion" };
    f.action = action;
  }

  const actor = clean(sp.get("actor") ?? "");
  if (actor) {
    if (actor.length > MAX_FIELD) return { error: "Akteur ist zu lang" };
    f.actor = actor;
  }

  const q = clean(sp.get("q") ?? "");
  if (q) {
    if (q.length > MAX_Q) return { error: `Suchbegriff darf höchstens ${MAX_Q} Zeichen lang sein` };
    f.q = q;
  }

  const from = (sp.get("from") ?? "").trim();
  if (from) {
    const p = parseDate(from, false);
    if (!p) return { error: "Ungültiges Von-Datum" };
    f.from = p.iso;
  }

  const to = (sp.get("to") ?? "").trim();
  if (to) {
    const p = parseDate(to, true);
    if (!p) return { error: "Ungültiges Bis-Datum" };
    f.toValue = p.iso;
    f.toInclusive = p.inclusive;
  }

  if (f.from && f.toValue && f.from > f.toValue) return { error: "Von-Datum liegt nach dem Bis-Datum" };
  return { value: f };
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id]), "utf8").toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  if (raw.length > 200) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed as unknown[];
    if (typeof createdAt !== "string" || typeof id !== "string") return null;
    if (!TS_RE.test(createdAt) || !UUID_RE.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

async function fetchPage(
  admin: Admin,
  f: Filters,
  cursor: Cursor | null,
  count: number,
): Promise<{ rows: AuditRow[]; error: string | null }> {
  let query = admin
    .from("audit_log")
    .select("id, org_id, actor_id, actor_email, action, target_id, target_email, meta, created_at");

  if (f.org === "none") query = query.is("org_id", null);
  else if (f.org) query = query.eq("org_id", f.org);
  if (f.action) query = query.eq("action", f.action);
  if (f.actor) query = query.ilike("actor_email", `%${escapeLike(f.actor)}%`);
  if (f.from) query = query.gte("created_at", f.from);
  if (f.toValue) query = f.toInclusive ? query.lte("created_at", f.toValue) : query.lt("created_at", f.toValue);
  if (f.q) {
    const v = quoteOrValue(`*${escapeLike(f.q)}*`);
    query = query.or(`actor_email.ilike.${v},target_email.ilike.${v},action.ilike.${v}`);
  }
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(count);

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AuditRow[], error: null };
}

async function loadOrgNames(admin: Admin, rows: AuditRow[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(rows.map(r => r.org_id).filter((v): v is string => !!v)));
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("organizations").select("id, name").in("id", ids.slice(i, i + 100));
    for (const o of data ?? []) names.set(o.id as string, o.name as string);
  }
  return names;
}

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function isEmptyMeta(meta: unknown): boolean {
  return !meta || (typeof meta === "object" && Object.keys(meta as object).length === 0);
}

async function buildCsv(admin: Admin, f: Filters): Promise<{ body: string; truncated: boolean } | { error: string }> {
  const all: AuditRow[] = [];
  let cursor: Cursor | null = null;
  let truncated = false;

  while (all.length <= CSV_MAX) {
    const want = Math.min(CSV_CHUNK, CSV_MAX + 1 - all.length);
    const { rows, error } = await fetchPage(admin, f, cursor, want);
    if (error) return { error };
    all.push(...rows);
    if (rows.length < want) break;
    const last = rows[rows.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };
  }

  if (all.length > CSV_MAX) {
    all.length = CSV_MAX;
    truncated = true;
  }

  const names = await loadOrgNames(admin, all);
  const header = ["Zeit", "Akteur", "Aktion", "Ziel", "Organisation", "Organisation-ID", "Ziel-ID", "Details"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of all) {
    lines.push(
      [
        r.created_at,
        r.actor_email,
        r.action,
        r.target_email,
        r.org_id ? names.get(r.org_id) ?? "" : "Plattform",
        r.org_id,
        r.target_id,
        isEmptyMeta(r.meta) ? "" : r.meta,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return { body: `﻿${lines.join("\r\n")}\r\n`, truncated };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    if (user.role !== "super_admin") return forbidden();

    const sp = req.nextUrl.searchParams;
    const parsed = parseFilters(sp);
    if ("error" in parsed) return err(parsed.error, 400);
    const filters = parsed.value;

    const admin = createAdminClient();

    const format = sp.get("format");
    if (format !== null && format !== "csv" && format !== "json") return err("Ungültiges Format", 400);

    if (format === "csv") {
      const result = await buildCsv(admin, filters);
      if ("error" in result) return err(result.error, 500);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      return new NextResponse(result.body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
          "Cache-Control": "no-store",
          "X-Export-Truncated": result.truncated ? "true" : "false",
        },
      });
    }

    let limit = DEFAULT_LIMIT;
    const limitRaw = sp.get("limit");
    if (limitRaw !== null && limitRaw !== "") {
      if (!/^\d{1,4}$/.test(limitRaw)) return err("Ungültiges Limit", 400);
      limit = Math.min(Math.max(parseInt(limitRaw, 10), 1), MAX_LIMIT);
    }

    let cursor: Cursor | null = null;
    const cursorRaw = sp.get("cursor");
    if (cursorRaw) {
      cursor = decodeCursor(cursorRaw);
      if (!cursor) return err("Ungültiger Cursor", 400);
    }

    const { rows, error } = await fetchPage(admin, filters, cursor, limit + 1);
    if (error) return err(error, 500);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const names = await loadOrgNames(admin, page);
    const last = page[page.length - 1];

    return ok({
      items: page.map(r => ({
        id: r.id,
        orgId: r.org_id,
        orgName: r.org_id ? names.get(r.org_id) ?? null : null,
        actorId: r.actor_id,
        actorEmail: r.actor_email,
        action: r.action,
        targetId: r.target_id,
        targetEmail: r.target_email,
        meta: r.meta ?? {},
        createdAt: r.created_at,
      })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    });
  } catch {
    return err("Audit-Log konnte nicht geladen werden", 500);
  }
}
