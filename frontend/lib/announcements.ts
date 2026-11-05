export const ANNOUNCEMENT_TYPES = ["info", "warning", "maintenance", "critical"] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];
export type AnnouncementState = "scheduled" | "live" | "expired" | "disabled";

export const TITLE_MAX = 120;
export const MESSAGE_MAX = 1000;

export interface Announcement {
  id: string;
  orgId: string | null;
  orgName: string | null;
  title: string;
  message: string;
  type: AnnouncementType;
  startsAt: string;
  endsAt: string | null;
  dismissible: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdByEmail: string | null;
  state: AnnouncementState;
}

export interface PublicAnnouncement {
  id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  dismissible: boolean;
  endsAt: string | null;
  updatedAt: string;
}

export interface AnnouncementRow {
  id: string;
  org_id: string | null;
  title: string;
  message: string;
  type: string;
  starts_at: string;
  ends_at: string | null;
  dismissible: boolean;
  active: boolean;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export const ANNOUNCEMENT_COLUMNS =
  "id, org_id, title, message, type, starts_at, ends_at, dismissible, active, created_by_email, created_at, updated_at";

export interface AnnouncementInput {
  title?: string;
  message?: string;
  type?: AnnouncementType;
  orgId?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  dismissible?: boolean;
  active?: boolean;
}

export type ValidationResult = { value: AnnouncementInput } | { error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const SEVERITY: Record<string, number> = { critical: 0, maintenance: 1, warning: 2, info: 3 };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function orgVisibilityFilter(userOrgId: unknown): string {
  return isUuid(userOrgId) ? `org_id.is.null,org_id.eq.${userOrgId}` : "org_id.is.null";
}

function toTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function deriveState(
  row: { active: boolean; startsAt: string | Date; endsAt: string | Date | null },
  now: Date = new Date(),
): AnnouncementState {
  if (!row.active) return "disabled";
  const t = now.getTime();
  if (toTime(row.startsAt) > t) return "scheduled";
  if (row.endsAt !== null && toTime(row.endsAt) <= t) return "expired";
  return "live";
}

export function isVisibleTo(
  row: { orgId: string | null; active: boolean; startsAt: string | Date; endsAt: string | Date | null },
  userOrgId: string | null,
  now: Date = new Date(),
): boolean {
  if (deriveState(row, now) !== "live") return false;
  return row.orgId === null || (userOrgId !== null && row.orgId === userOrgId);
}

export function compareBySeverity(
  a: { type: string; startsAt: string },
  b: { type: string; startsAt: string },
): number {
  const diff = (SEVERITY[a.type] ?? 99) - (SEVERITY[b.type] ?? 99);
  if (diff !== 0) return diff;
  return toTime(b.startsAt) - toTime(a.startsAt);
}

function parseDate(value: unknown, label: string): { value: string } | { error: string } {
  if (typeof value !== "string" || !ISO_RE.test(value.trim()) || Number.isNaN(Date.parse(value.trim()))) {
    return { error: `${label} ist kein gültiges ISO-Datum.` };
  }
  return { value: new Date(value.trim()).toISOString() };
}

const INVISIBLE_RE = /[\s\u00AD\u115F\u1160\u200B-\u200D\u2060\u2800\u3164\uFEFF\uFFA0\u202A-\u202E\u2066-\u2069]/g;
const CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/;
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/;
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/;
export const MESSAGE_MAX_LINES = 10;

function parseText(
  value: unknown,
  label: string,
  max: number,
  multiline = false,
): { value: string } | { error: string } {
  if (typeof value !== "string") return { error: `${label} ist erforderlich.` };
  const text = (multiline ? value.replace(/\r\n/g, "\n") : value).trim();
  if (text.replace(INVISIBLE_RE, "").length === 0) {
    return { error: `${label} darf nicht leer sein und nicht nur aus Leer- oder unsichtbaren Zeichen bestehen.` };
  }
  if (text.length > max) return { error: `${label} darf höchstens ${max} Zeichen lang sein.` };
  if (CONTROL_RE.test(text)) return { error: `${label} enthält unzulässige Steuerzeichen.` };
  if (BIDI_RE.test(text)) return { error: `${label} enthält unzulässige Steuerzeichen zur Textrichtung.` };
  if (ZERO_WIDTH_RE.test(text)) return { error: `${label} enthält unsichtbare Zeichen mit Breite null.` };
  if (/[<>]/.test(text)) return { error: `${label} darf keine HTML-Zeichen (< oder >) enthalten.` };
  if (multiline) {
    if (text.split("\n").length > MESSAGE_MAX_LINES) {
      return { error: `${label} darf höchstens ${MESSAGE_MAX_LINES} Zeilen lang sein.` };
    }
  } else if (text.includes("\n")) {
    return { error: `${label} muss einzeilig sein.` };
  }
  return { value: text };
}

export function validateInput(body: unknown, partial = false): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Ungültiger Request-Body." };
  }
  const b = body as Record<string, unknown>;
  const out: AnnouncementInput = {};

  if (!partial || b.title !== undefined) {
    const r = parseText(b.title, "Titel", TITLE_MAX);
    if ("error" in r) return r;
    out.title = r.value;
  }
  if (!partial || b.message !== undefined) {
    const r = parseText(b.message, "Nachricht", MESSAGE_MAX, true);
    if ("error" in r) return r;
    out.message = r.value;
  }
  if (!partial || b.type !== undefined) {
    if (typeof b.type !== "string" || !(ANNOUNCEMENT_TYPES as readonly string[]).includes(b.type)) {
      return { error: `Typ muss einer von ${ANNOUNCEMENT_TYPES.join(", ")} sein.` };
    }
    out.type = b.type as AnnouncementType;
  }
  if (b.orgId !== undefined) {
    if (b.orgId !== null && !isUuid(b.orgId)) return { error: "orgId ist keine gültige UUID." };
    out.orgId = b.orgId;
  } else if (!partial) {
    out.orgId = null;
  }
  if (b.startsAt !== undefined && b.startsAt !== null) {
    const r = parseDate(b.startsAt, "Startzeit");
    if ("error" in r) return r;
    out.startsAt = r.value;
  } else if (partial && b.startsAt === null) {
    return { error: "Startzeit darf nicht leer sein." };
  }
  if (b.endsAt !== undefined) {
    if (b.endsAt === null) {
      out.endsAt = null;
    } else {
      const r = parseDate(b.endsAt, "Endzeit");
      if ("error" in r) return r;
      out.endsAt = r.value;
    }
  }
  for (const key of ["dismissible", "active"] as const) {
    if (b[key] !== undefined) {
      if (typeof b[key] !== "boolean") return { error: `${key} muss true oder false sein.` };
      out[key] = b[key] as boolean;
    }
  }
  if (out.startsAt && out.endsAt && Date.parse(out.endsAt) <= Date.parse(out.startsAt)) {
    return { error: "Die Endzeit muss nach der Startzeit liegen." };
  }
  if (partial && Object.keys(out).length === 0) return { error: "Keine Änderungen übergeben." };
  return { value: out };
}

export function rowToAnnouncement(
  row: AnnouncementRow,
  orgName: string | null,
  now: Date = new Date(),
): Announcement {
  return {
    id: row.id,
    orgId: row.org_id,
    orgName,
    title: row.title,
    message: row.message,
    type: row.type as AnnouncementType,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dismissible: row.dismissible,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByEmail: row.created_by_email,
    state: deriveState({ active: row.active, startsAt: row.starts_at, endsAt: row.ends_at }, now),
  };
}
